import * as satellite from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';
import type {
  FragmentationMode,
  FragmentationSummary,
  FragmentSpreadPoint,
} from '../types/debriswatch.ts';
import {
  eciStateToKepler,
  EARTH_RADIUS_KM,
  propagateKeplerJ2Eci,
  type KeplerElements,
} from '../utils/orbitMath.ts';

interface SimulateRequest {
  type: 'simulate';
  runId: number;
  parentNoradId: number;
  parentName: string;
  parentOmm: OMMJsonObject;
  breakupTimeMs: number;
  fragmentCount: number;
  deltaVSigmaMS: number;
  mode: FragmentationMode;
  proximityThresholdKm: number;
  trackedRecords: Array<{ noradId: number; perigeeKm: number; apogeeKm: number; omm: OMMJsonObject }>;
}

interface StepRequest {
  type: 'step';
  simTimeMs: number;
}

let activeFragments: KeplerElements[] = [];
let breakupEpochMs = 0;

function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

self.onmessage = (event: MessageEvent<SimulateRequest | StepRequest>) => {
  const msg = event.data;

  if (msg.type === 'simulate') {
    const satrec = satellite.json2satrec(msg.parentOmm);
    if (!satrec || satrec.error !== 0) {
      self.postMessage({
        type: 'error',
        runId: msg.runId,
        message: 'Unable to compile parent object TLE/OMM for breakup.',
      });
      return;
    }

    const breakupDate = new Date(msg.breakupTimeMs);
    const pv = satellite.propagate(satrec, breakupDate);
    if (
      !pv ||
      !pv.position ||
      typeof pv.position === 'boolean' ||
      !pv.velocity ||
      typeof pv.velocity === 'boolean'
    ) {
      self.postMessage({
        type: 'error',
        runId: msg.runId,
        message: 'Failed to propagate parent state vector at breakup epoch.',
      });
      return;
    }

    const r0 = pv.position; // km
    const v0 = pv.velocity; // km/s
    const vMag = Math.hypot(v0.x, v0.y, v0.z) || 7.5;
    const sigmaKmS = msg.deltaVSigmaMS / 1000;

    // Velocity unit vector (prograde) and orthogonal unit vectors for directional breakup mode
    const tHat = { x: v0.x / vMag, y: v0.y / vMag, z: v0.z / vMag };
    const rMag = Math.hypot(r0.x, r0.y, r0.z) || 6800;
    const rHat = { x: r0.x / rMag, y: r0.y / rMag, z: r0.z / rMag };
    const nHat = {
      x: rHat.y * tHat.z - rHat.z * tHat.y,
      y: rHat.z * tHat.x - rHat.x * tHat.z,
      z: rHat.x * tHat.y - rHat.y * tHat.x,
    };

    const fragments: KeplerElements[] = [];
    const maxCount = Math.min(Math.max(msg.fragmentCount, 20), 1500);

    for (let i = 0; i < maxCount; i++) {
      let dvx = 0;
      let dvy = 0;
      let dvz = 0;

      if (msg.mode === 'isotropic') {
        dvx = gaussianRandom() * sigmaKmS;
        dvy = gaussianRandom() * sigmaKmS;
        dvz = gaussianRandom() * sigmaKmS;
      } else {
        // Directional debris cone along velocity/anti-velocity jet with narrower cross-track scatter
        const along = (Math.abs(gaussianRandom()) * 1.45 + 0.15) * sigmaKmS * (i % 3 === 0 ? -1 : 1);
        const radial = gaussianRandom() * sigmaKmS * 0.35;
        const normal = gaussianRandom() * sigmaKmS * 0.35;
        dvx = tHat.x * along + rHat.x * radial + nHat.x * normal;
        dvy = tHat.y * along + rHat.y * radial + nHat.y * normal;
        dvz = tHat.z * along + rHat.z * radial + nHat.z * normal;
      }

      const kep = eciStateToKepler(r0, {
        x: v0.x + dvx,
        y: v0.y + dvy,
        z: v0.z + dvz,
      });
      if (kep) {
        fragments.push(kep);
      }
    }

    activeFragments = fragments;
    breakupEpochMs = msg.breakupTimeMs;

    // Estimate parent period & compute 5-orbit cloud spread curve (0 to 4 orbits)
    const parentPeriodMin = 1440 / (Number(msg.parentOmm.MEAN_MOTION) || 15);
    const parentPeriodSec = Math.min(parentPeriodMin, 1440) * 60;
    const spreadSeries: FragmentSpreadPoint[] = [];

    let cloudMinAltKm = Infinity;
    let cloudMaxAltKm = 0;

    for (let orbitIdx = 0; orbitIdx <= 4; orbitIdx += 0.5) {
      const dtSec = orbitIdx * parentPeriodSec;
      const alts: number[] = [];
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      const pts: Array<{ x: number; y: number; z: number }> = [];

      for (let k = 0; k < fragments.length; k++) {
        const p = propagateKeplerJ2Eci(fragments[k], dtSec);
        const alt = Math.hypot(p.x, p.y, p.z) - EARTH_RADIUS_KM;
        alts.push(alt);
        if (alt < cloudMinAltKm) cloudMinAltKm = alt;
        if (alt > cloudMaxAltKm) cloudMaxAltKm = alt;
        sumX += p.x;
        sumY += p.y;
        sumZ += p.z;
        pts.push(p);
      }

      const n = Math.max(1, pts.length);
      const cx = sumX / n;
      const cy = sumY / n;
      const cz = sumZ / n;

      let minAlt = Infinity;
      let maxAlt = -Infinity;
      let maxChordKm = 0;
      for (let k = 0; k < pts.length; k++) {
        if (alts[k] < minAlt) minAlt = alts[k];
        if (alts[k] > maxAlt) maxAlt = alts[k];
        const d = Math.hypot(pts[k].x - cx, pts[k].y - cy, pts[k].z - cz);
        if (d > maxChordKm) maxChordKm = d;
      }

      spreadSeries.push({
        elapsedHours: Number((dtSec / 3600).toFixed(2)),
        orbitNumber: orbitIdx,
        altSpreadKm: Number((maxAlt - minAlt).toFixed(1)),
        alongTrackSpreadKm: Number((maxChordKm * 2).toFixed(1)),
        minAltKm: Number(minAlt.toFixed(1)),
        maxAltKm: Number(maxAlt.toFixed(1)),
      });
    }

    // Screen how many existing tracked objects enter within proximityThresholdKm of cloud over next 24h
    const proxKm = Math.max(5, msg.proximityThresholdKm);
    const bandLow = cloudMinAltKm - proxKm - 30;
    const bandHigh = cloudMaxAltKm + proxKm + 30;
    const bandCandidates = msg.trackedRecords.filter(
      (r) => r.noradId !== msg.parentNoradId && r.apogeeKm >= bandLow && r.perigeeKm <= bandHigh
    );

    const sampleFragStep = Math.max(1, Math.floor(fragments.length / 45));
    const sampledFragments = fragments.filter((_, idx) => idx % sampleFragStep === 0);
    const checkOffsetsMin = [30, 90, 180, 360, 720, 1080, 1440];
    const exposedNorads = new Set<number>();

    // Precompute sampled fragment positions at check times
    const fragSnapshots = checkOffsetsMin.map((min) =>
      sampledFragments.map((f) => propagateKeplerJ2Eci(f, min * 60))
    );

    for (const rec of bandCandidates) {
      let satrecCand: satellite.SatRec;
      try {
        satrecCand = satellite.json2satrec(rec.omm);
        if (!satrecCand || satrecCand.error !== 0) continue;
      } catch {
        continue;
      }

      let hit = false;
      for (let tIdx = 0; tIdx < checkOffsetsMin.length && !hit; tIdx++) {
        const d = new Date(breakupEpochMs + checkOffsetsMin[tIdx] * 60_000);
        const pvC = satellite.propagate(satrecCand, d);
        if (!pvC || !pvC.position || typeof pvC.position === 'boolean') continue;
        const pos = pvC.position;
        const cloudPts = fragSnapshots[tIdx];
        for (let fIdx = 0; fIdx < cloudPts.length; fIdx++) {
          const fp = cloudPts[fIdx];
          const dist = Math.hypot(pos.x - fp.x, pos.y - fp.y, pos.z - fp.z);
          if (dist <= proxKm) {
            exposedNorads.add(rec.noradId);
            hit = true;
            break;
          }
        }
      }
    }

    const summary: FragmentationSummary = {
      parentNoradId: msg.parentNoradId,
      parentName: msg.parentName,
      breakupTimeMs: msg.breakupTimeMs,
      fragmentCount: fragments.length,
      deltaVSigmaMS: msg.deltaVSigmaMS,
      mode: msg.mode,
      proximityThresholdKm: proxKm,
      trackedObjectsInProximity24h: exposedNorads.size,
      spreadSeries,
    };

    self.postMessage({
      type: 'simulated',
      runId: msg.runId,
      summary,
    });
    return;
  }

  if (msg.type === 'step') {
    if (activeFragments.length === 0) {
      const empty = new Float32Array(0);
      (self as unknown as { postMessage: (data: unknown, transfer: Transferable[]) => void }).postMessage(
        { type: 'cloud', count: 0, buffer: empty.buffer },
        [empty.buffer]
      );
      return;
    }

    const deltaSec = (msg.simTimeMs - breakupEpochMs) / 1000;
    const count = activeFragments.length;
    const out = new Float32Array(count * 3);

    if (deltaSec < 0) {
      // Before breakup event: hide cloud points at NaN
      out.fill(Number.NaN);
    } else {
      const gmst = satellite.gstime(new Date(msg.simTimeMs));
      for (let i = 0; i < count; i++) {
        const eci = propagateKeplerJ2Eci(activeFragments[i], deltaSec);
        const ecf = satellite.eciToEcf(eci, gmst);
        out[i * 3] = ecf.x * 1000;
        out[i * 3 + 1] = ecf.y * 1000;
        out[i * 3 + 2] = ecf.z * 1000;
      }
    }

    (self as unknown as { postMessage: (data: unknown, transfer: Transferable[]) => void }).postMessage(
      {
        type: 'cloud',
        count,
        buffer: out.buffer,
      },
      [out.buffer]
    );
  }
};
