import * as satellite from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';
import type { ConjunctionCandidate, ObjectClass } from '../types/debriswatch.ts';

interface ScreenInputObject {
  noradId: number;
  name: string;
  objectClass: ObjectClass;
  perigeeKm: number;
  apogeeKm: number;
  omm: OMMJsonObject;
}

type ScreenRequest = {
  type: 'screen';
  runId: number;
  primaryNoradId: number;
  startTimeMs: number;
  windowHours: number;
  thresholdKm: number;
  objects: ScreenInputObject[];
};

self.onmessage = (event: MessageEvent<ScreenRequest>) => {
  const req = event.data;
  if (req.type !== 'screen') return;

  const primary = req.objects.find((o) => o.noradId === req.primaryNoradId);
  if (!primary) {
    self.postMessage({
      type: 'error',
      runId: req.runId,
      message: 'Primary satellite not found in catalog.',
    });
    return;
  }

  let primarySatrec: satellite.SatRec;
  try {
    primarySatrec = satellite.json2satrec(primary.omm);
    if (!primarySatrec || primarySatrec.error !== 0) {
      throw new Error('Invalid primary TLE/OMM record');
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      runId: req.runId,
      message: err instanceof Error ? err.message : 'Primary SGP4 compilation failed',
    });
    return;
  }

  // Stage 1: Coarse perigee/apogee altitude-band overlap filter
  const bandPadKm = Math.max(45, req.thresholdKm + 30);
  const pMin = primary.perigeeKm - bandPadKm;
  const pMax = primary.apogeeKm + bandPadKm;

  const candidates: Array<{ obj: ScreenInputObject; satrec: satellite.SatRec }> = [];
  for (const obj of req.objects) {
    if (obj.noradId === primary.noradId) continue;
    if (obj.apogeeKm < pMin || obj.perigeeKm > pMax) continue;
    try {
      const satrec = satellite.json2satrec(obj.omm);
      if (satrec && satrec.error === 0) {
        candidates.push({ obj, satrec });
      }
    } catch {
      // skip invalid record
    }
  }

  const windowSec = Math.max(1800, req.windowHours * 3600);
  const coarseStepSec = 30;
  const coarseSteps = Math.floor(windowSec / coarseStepSec);
  const coarseGateKm = Math.max(240, req.thresholdKm + 230); // ~30s * 15 km/s / 2

  // Precompute primary ECI positions along coarse timeline
  const primaryPositions = new Array<{ x: number; y: number; z: number } | null>(coarseSteps + 1);
  for (let s = 0; s <= coarseSteps; s++) {
    const d = new Date(req.startTimeMs + s * coarseStepSec * 1000);
    const pv = satellite.propagate(primarySatrec, d);
    if (pv && pv.position && typeof pv.position !== 'boolean') {
      primaryPositions[s] = pv.position;
    } else {
      primaryPositions[s] = null;
    }
  }

  // Stage 2: Coarse 30s sweep + Stage 3: 0.5s fine search around candidate windows
  const results: ConjunctionCandidate[] = [];
  const totalCand = Math.max(1, candidates.length);
  let lastProgressPct = -1;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const { obj, satrec } = candidates[cIdx];

    const pct = Math.round(((cIdx + 1) / totalCand) * 100);
    if (pct !== lastProgressPct && (pct % 3 === 0 || cIdx === candidates.length - 1)) {
      lastProgressPct = pct;
      self.postMessage({
        type: 'progress',
        runId: req.runId,
        progress: pct,
        screenedCount: cIdx + 1,
        candidateCount: candidates.length,
      });
    }

    // Track coarse minima
    let bestCoarseDist = Infinity;
    let bestCoarseStep = -1;
    const coarseAlerts: number[] = [];

    for (let s = 0; s <= coarseSteps; s++) {
      const pPos = primaryPositions[s];
      if (!pPos) continue;
      const d = new Date(req.startTimeMs + s * coarseStepSec * 1000);
      const pv = satellite.propagate(satrec, d);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const dx = pPos.x - pv.position.x;
      const dy = pPos.y - pv.position.y;
      const dz = pPos.z - pv.position.z;
      const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distKm <= coarseGateKm) {
        if (distKm < bestCoarseDist) {
          bestCoarseDist = distKm;
          bestCoarseStep = s;
        }
        // Only record well-separated local minima per pair
        if (
          coarseAlerts.length === 0 ||
          s - coarseAlerts[coarseAlerts.length - 1] > 20
        ) {
          coarseAlerts.push(s);
        }
      }
    }

    if (bestCoarseStep < 0) continue;

    // Fine 0.5s search around the closest approach window(s) (take tightest overall for this pair)
    let minFineDist = Infinity;
    let minFineTimeMs = req.startTimeMs;
    let minRelVel = 0;

    for (const anchorStep of coarseAlerts.slice(0, 3)) {
      const anchorMs = req.startTimeMs + anchorStep * coarseStepSec * 1000;
      const startFineMs = Math.max(req.startTimeMs, anchorMs - 34_000);
      const endFineMs = Math.min(req.startTimeMs + windowSec * 1000, anchorMs + 34_000);

      for (let tMs = startFineMs; tMs <= endFineMs; tMs += 500) {
        const dt = new Date(tMs);
        const pvP = satellite.propagate(primarySatrec, dt);
        const pvS = satellite.propagate(satrec, dt);
        if (
          !pvP ||
          !pvP.position ||
          typeof pvP.position === 'boolean' ||
          !pvP.velocity ||
          typeof pvP.velocity === 'boolean' ||
          !pvS ||
          !pvS.position ||
          typeof pvS.position === 'boolean' ||
          !pvS.velocity ||
          typeof pvS.velocity === 'boolean'
        ) {
          continue;
        }

        const dx = pvP.position.x - pvS.position.x;
        const dy = pvP.position.y - pvS.position.y;
        const dz = pvP.position.z - pvS.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < minFineDist) {
          minFineDist = dist;
          minFineTimeMs = tMs;
          minRelVel = Math.hypot(
            pvP.velocity.x - pvS.velocity.x,
            pvP.velocity.y - pvS.velocity.y,
            pvP.velocity.z - pvS.velocity.z
          );
        }
      }
    }

    if (minFineDist <= req.thresholdKm) {
      const risk: 'HIGH' | 'MEDIUM' | 'LOW' =
        minFineDist < 1.0 ? 'HIGH' : minFineDist < 5.0 ? 'MEDIUM' : 'LOW';
      results.push({
        id: `conj-${primary.noradId}-${obj.noradId}-${Math.round(minFineTimeMs)}`,
        primaryNoradId: primary.noradId,
        primaryName: primary.name,
        secondaryNoradId: obj.noradId,
        secondaryName: obj.name,
        secondaryClass: obj.objectClass,
        tcaUtcMs: minFineTimeMs,
        missDistanceKm: Number(minFineDist.toFixed(3)),
        relativeVelocityKmS: Number(minRelVel.toFixed(2)),
        risk,
      });
    }
  }

  results.sort((a, b) => a.missDistanceKm - b.missDistanceKm);

  self.postMessage({
    type: 'result',
    runId: req.runId,
    candidateCount: candidates.length,
    results: results.slice(0, 150),
  });
};
