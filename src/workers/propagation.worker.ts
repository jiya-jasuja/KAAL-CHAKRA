import * as satellite from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';

interface WorkerRecord {
  noradId: number;
  satrec: satellite.SatRec | null;
}

type InitMessage = {
  type: 'init';
  records: Array<{ noradId: number; omm: OMMJsonObject }>;
};

type StepMessage = {
  type: 'step';
  simTimeMs: number;
};

let compiled: WorkerRecord[] = [];

self.onmessage = (event: MessageEvent<InitMessage | StepMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    const next: WorkerRecord[] = [];
    for (const rec of msg.records) {
      let satrec: satellite.SatRec | null = null;
      try {
        const parsed = satellite.json2satrec(rec.omm);
        if (parsed && parsed.error === 0) {
          satrec = parsed;
        }
      } catch {
        satrec = null;
      }
      next.push({ noradId: rec.noradId, satrec });
    }
    compiled = next;
    self.postMessage({
      type: 'ready',
      count: compiled.length,
      noradIds: compiled.map((c) => c.noradId),
    });
    return;
  }

  if (msg.type === 'step') {
    const count = compiled.length;
    const stride = 10; // ecefX, ecefY, ecefZ, latDeg, lonDeg, altKm, speedKmS, vxEcefKmS, vyEcefKmS, vzEcefKmS
    const EARTH_OMEGA_RAD_S = 7.2921150e-5;
    const out = new Float32Array(count * stride);
    const simDate = new Date(msg.simTimeMs);
    const gmst = satellite.gstime(simDate);

    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const satrec = compiled[i].satrec;
      if (!satrec) {
        out[base] = Number.NaN;
        continue;
      }
      const pv = satellite.propagate(satrec, simDate);
      if (
        !pv ||
        typeof pv.position === 'boolean' ||
        !pv.position ||
        typeof pv.velocity === 'boolean' ||
        !pv.velocity
      ) {
        out[base] = Number.NaN;
        continue;
      }

      const posEci = pv.position;
      const velEci = pv.velocity;
      const ecf = satellite.eciToEcf(posEci, gmst);
      const velRot = satellite.eciToEcf(velEci, gmst);
      const vxEcef = velRot.x + EARTH_OMEGA_RAD_S * ecf.y;
      const vyEcef = velRot.y - EARTH_OMEGA_RAD_S * ecf.x;
      const vzEcef = velRot.z;
      const geo = satellite.eciToGeodetic(posEci, gmst);

      const latDeg = satellite.degreesLat(geo.latitude);
      const lonDeg = satellite.degreesLong(geo.longitude);
      const altKm = Number.isFinite(geo.height) ? geo.height : 400;
      const speedKmS = Math.hypot(velEci.x, velEci.y, velEci.z);

      if (!Number.isFinite(ecf.x) || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
        out[base] = Number.NaN;
        continue;
      }

      out[base] = ecf.x * 1000;
      out[base + 1] = ecf.y * 1000;
      out[base + 2] = ecf.z * 1000;
      out[base + 3] = latDeg;
      out[base + 4] = lonDeg;
      out[base + 5] = altKm;
      out[base + 6] = speedKmS;
      out[base + 7] = vxEcef;
      out[base + 8] = vyEcef;
      out[base + 9] = vzEcef;
    }

    (self as unknown as { postMessage: (data: unknown, transfer: Transferable[]) => void }).postMessage(
      {
        type: 'positions',
        simTimeMs: msg.simTimeMs,
        count,
        stride,
        buffer: out.buffer,
      },
      [out.buffer]
    );
  }
};
