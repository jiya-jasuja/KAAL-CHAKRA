import * as satellite from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';

export const MU_EARTH_KM3_S2 = 398600.4418;
export const EARTH_RADIUS_KM = 6378.137;
export const J2_EARTH = 1.08262668e-3;
export const TWO_PI = Math.PI * 2;

export interface KeplerElements {
  aKm: number;
  e: number;
  iRad: number;
  raanRad: number;
  argpRad: number;
  m0Rad: number;
  nRadSec: number;
}

export function deriveOrbitalMetrics(omm: OMMJsonObject): {
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
  epochAgeHours: number;
} {
  const meanMotionRevDay = Number(omm.MEAN_MOTION) || 15.0;
  const ecc = Math.min(0.95, Math.max(0, Number(omm.ECCENTRICITY) || 0));
  const periodMin = 1440 / meanMotionRevDay;
  const nRadSec = (meanMotionRevDay * TWO_PI) / 86400;
  const aKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadSec * nRadSec));
  const apogeeKm = Math.max(100, aKm * (1 + ecc) - 6371.0);
  const perigeeKm = Math.max(100, aKm * (1 - ecc) - 6371.0);
  const epochMs = Date.parse(String(omm.EPOCH || ''));
  const epochAgeHours = Number.isFinite(epochMs)
    ? Math.max(0, (Date.now() - epochMs) / 3600_000)
    : 24;

  return {
    periodMin: Number(periodMin.toFixed(1)),
    apogeeKm: Number(apogeeKm.toFixed(1)),
    perigeeKm: Number(perigeeKm.toFixed(1)),
    epochAgeHours: Number(epochAgeHours.toFixed(1)),
  };
}

export const EARTH_OMEGA_RAD_S = 7.2921150e-5;

/**
 * Computes future ECI -> ECEF orbit polyline points (in meters) for one full orbital period.
 */
export function computeNextPeriodOrbitCartesianMeters(
  omm: OMMJsonObject,
  startTimeMs: number,
  periodMin: number,
  segments = 108
): number[] {
  const satrec = satellite.json2satrec(omm);
  if (!satrec || satrec.error !== 0) return [];
  const durationMs = Math.min(periodMin, 1440) * 60_000;
  const coords: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const d = new Date(startTimeMs + (i / segments) * durationMs);
    const pv = satellite.propagate(satrec, d);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
    const gmst = satellite.gstime(d);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    coords.push(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
  }
  return coords;
}

/**
 * Computes antimeridian-split 2D ground track segments ([lon, lat][]) for MapLibre vector rendering.
 */
export function computeVectorGroundTrackSegments(
  omm: OMMJsonObject,
  startTimeMs: number,
  periodMin: number,
  segments = 96
): Array<Array<[number, number]>> {
  const satrec = satellite.json2satrec(omm);
  if (!satrec || satrec.error !== 0) return [];
  const durationMs = Math.min(periodMin, 1440) * 60_000;
  const out: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let prevLon: number | null = null;

  for (let i = 0; i <= segments; i++) {
    const d = new Date(startTimeMs + (i / segments) * durationMs);
    const pv = satellite.propagate(satrec, d);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
    const gmst = satellite.gstime(d);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      if (current.length > 1) out.push(current);
      current = [];
    }
    current.push([lon, lat]);
    prevLon = lon;
  }
  if (current.length > 1) out.push(current);
  return out;
}

/**
 * Computes full SGP4 state vectors (ECI, ECEF, RTN triad, angular momentum, flight-path angle, heading).
 */
export function computeStateVectorReport(
  noradId: number,
  omm: OMMJsonObject,
  timeMs: number
) {
  try {
    const satrec = satellite.json2satrec(omm);
    if (!satrec || satrec.error !== 0) return null;
    const d = new Date(timeMs);
    const pv = satellite.propagate(satrec, d);
    if (
      !pv ||
      !pv.position ||
      typeof pv.position === 'boolean' ||
      !pv.velocity ||
      typeof pv.velocity === 'boolean'
    ) {
      return null;
    }

    const rEci = pv.position;
    const vEci = pv.velocity;
    const gmst = satellite.gstime(d);
    const rEcf = satellite.eciToEcf(rEci, gmst);
    const vEciInEcf = satellite.eciToEcf(vEci, gmst);

    // Transport theorem: v_ECEF = R_z(GMST) * v_ECI - omega_earth x r_ECEF
    const vEcef = {
      x: vEciInEcf.x + EARTH_OMEGA_RAD_S * rEcf.y,
      y: vEciInEcf.y - EARTH_OMEGA_RAD_S * rEcf.x,
      z: vEciInEcf.z,
    };

    const geo = satellite.eciToGeodetic(rEci, gmst);
    const latDeg = satellite.degreesLat(geo.latitude);
    const lonDeg = satellite.degreesLong(geo.longitude);
    const altKm = Number.isFinite(geo.height) ? geo.height : 400;

    const rMag = Math.hypot(rEci.x, rEci.y, rEci.z) || 1;
    const vMag = Math.hypot(vEci.x, vEci.y, vEci.z) || 1;
    const ecefSpeedKmS = Math.hypot(vEcef.x, vEcef.y, vEcef.z);

    // Specific angular momentum h = r x v (in ECI) and ECEF orientation
    const hEci = {
      x: rEci.y * vEci.z - rEci.z * vEci.y,
      y: rEci.z * vEci.x - rEci.x * vEci.z,
      z: rEci.x * vEci.y - rEci.y * vEci.x,
    };
    const hMag = Math.hypot(hEci.x, hEci.y, hEci.z) || 1;

    const rvDot = rEci.x * vEci.x + rEci.y * vEci.y + rEci.z * vEci.z;
    const sinGamma = Math.max(-1, Math.min(1, rvDot / (rMag * vMag)));
    const flightPathAngleDeg = (Math.asin(sinGamma) * 180) / Math.PI;

    // Local East-North-Up heading azimuth of ECEF ground velocity
    const latRad = geo.latitude;
    const lonRad = geo.longitude;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinLon = Math.sin(lonRad);
    const cosLon = Math.cos(lonRad);

    const vEast = -sinLon * vEcef.x + cosLon * vEcef.y;
    const vNorth =
      -sinLat * cosLon * vEcef.x - sinLat * sinLon * vEcef.y + cosLat * vEcef.z;
    const headingDeg = ((Math.atan2(vEast, vNorth) * 180) / Math.PI + 360) % 360;

    // RTN orthonormal basis in ECEF
    const rEcfMag = Math.hypot(rEcf.x, rEcf.y, rEcf.z) || 1;
    const radial = {
      x: rEcf.x / rEcfMag,
      y: rEcf.y / rEcfMag,
      z: rEcf.z / rEcfMag,
    };
    const hEcfRaw = {
      x: rEcf.y * vEcef.z - rEcf.z * vEcef.y,
      y: rEcf.z * vEcef.x - rEcf.x * vEcef.z,
      z: rEcf.x * vEcef.y - rEcf.y * vEcef.x,
    };
    const hEcfMag = Math.hypot(hEcfRaw.x, hEcfRaw.y, hEcfRaw.z) || 1;
    const normal = {
      x: hEcfRaw.x / hEcfMag,
      y: hEcfRaw.y / hEcfMag,
      z: hEcfRaw.z / hEcfMag,
    };
    const transverse = {
      x: normal.y * radial.z - normal.z * radial.y,
      y: normal.z * radial.x - normal.x * radial.z,
      z: normal.x * radial.y - normal.y * radial.x,
    };

    const specificEnergyKm2S2 = 0.5 * vMag * vMag - MU_EARTH_KM3_S2 / rMag;
    const semiMajorAxisKm =
      specificEnergyKm2S2 < -1e-4 ? -MU_EARTH_KM3_S2 / (2 * specificEnergyKm2S2) : rMag;

    return {
      noradId,
      epochUtc: d.toISOString(),
      rEciKm: { x: rEci.x, y: rEci.y, z: rEci.z },
      vEciKmS: { x: vEci.x, y: vEci.y, z: vEci.z },
      rEcefKm: { x: rEcf.x, y: rEcf.y, z: rEcf.z },
      vEcefKmS: vEcef,
      latDeg,
      lonDeg,
      altKm,
      speedKmS: vMag,
      ecefSpeedKmS,
      flightPathAngleDeg,
      headingDeg,
      angularMomentumKm2S: hEci,
      angularMomentumMag: hMag,
      specificEnergyKm2S2,
      semiMajorAxisKm,
      rtnEcef: { radial, transverse, normal },
    };
  } catch {
    return null;
  }
}

/**
 * Converts ECI position (km) & velocity (km/s) into classical Keplerian elements.
 */
export function eciStateToKepler(
  r: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number }
): KeplerElements | null {
  const rMag = Math.hypot(r.x, r.y, r.z);
  const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (rMag < 6400) return null;

  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  const hz = r.x * v.y - r.y * v.x;
  const hMag = Math.hypot(hx, hy, hz);
  if (hMag < 1e-6) return null;

  const nx = -hy;
  const ny = hx;
  const nMag = Math.hypot(nx, ny);

  const rvDot = r.x * v.x + r.y * v.y + r.z * v.z;
  const coeffR = v2 - MU_EARTH_KM3_S2 / rMag;
  const ex = (coeffR * r.x - rvDot * v.x) / MU_EARTH_KM3_S2;
  const ey = (coeffR * r.y - rvDot * v.y) / MU_EARTH_KM3_S2;
  const ez = (coeffR * r.z - rvDot * v.z) / MU_EARTH_KM3_S2;
  const e = Math.min(0.85, Math.hypot(ex, ey, ez));

  const energy = v2 * 0.5 - MU_EARTH_KM3_S2 / rMag;
  if (energy >= -1e-4) return null; // hyperbolic escape excluded
  const aKm = -MU_EARTH_KM3_S2 / (2 * energy);
  if (!Number.isFinite(aKm) || aKm < 6500) return null;

  const iRad = Math.acos(Math.max(-1, Math.min(1, hz / hMag)));

  let raanRad = 0;
  if (nMag > 1e-6) {
    raanRad = Math.acos(Math.max(-1, Math.min(1, nx / nMag)));
    if (ny < 0) raanRad = TWO_PI - raanRad;
  }

  let argpRad = 0;
  if (nMag > 1e-6 && e > 1e-6) {
    const dotNE = (nx * ex + ny * ey) / (nMag * e);
    argpRad = Math.acos(Math.max(-1, Math.min(1, dotNE)));
    if (ez < 0) argpRad = TWO_PI - argpRad;
  } else if (e > 1e-6) {
    argpRad = Math.atan2(ey, ex);
  }

  let nuRad = 0;
  if (e > 1e-6) {
    const dotER = (ex * r.x + ey * r.y + ez * r.z) / (e * rMag);
    nuRad = Math.acos(Math.max(-1, Math.min(1, dotER)));
    if (rvDot < 0) nuRad = TWO_PI - nuRad;
  } else if (nMag > 1e-6) {
    const dotNR = (nx * r.x + ny * r.y) / (nMag * rMag);
    nuRad = Math.acos(Math.max(-1, Math.min(1, dotNR)));
    if (r.z < 0) nuRad = TWO_PI - nuRad;
  }

  const E =
    2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nuRad / 2), Math.sqrt(1 + e) * Math.cos(nuRad / 2));
  const m0Rad = (E - e * Math.sin(E) + TWO_PI) % TWO_PI;
  const nRadSec = Math.sqrt(MU_EARTH_KM3_S2 / (aKm * aKm * aKm));

  return { aKm, e, iRad, raanRad, argpRad, m0Rad, nRadSec };
}

/**
 * Propagates classical Keplerian elements with secular J2 perturbations
 * to ECI (km) at deltaSec seconds after epoch.
 */
export function propagateKeplerJ2Eci(
  el: KeplerElements,
  deltaSec: number
): { x: number; y: number; z: number } {
  const p = el.aKm * (1 - el.e * el.e);
  const reOverP2 = (EARTH_RADIUS_KM / Math.max(6400, p)) ** 2;
  const cosI = Math.cos(el.iRad);
  const sinI = Math.sin(el.iRad);

  const raanDot = -1.5 * J2_EARTH * el.nRadSec * reOverP2 * cosI;
  const argpDot = 0.75 * J2_EARTH * el.nRadSec * reOverP2 * (5 * cosI * cosI - 1);
  const mDot =
    el.nRadSec +
    0.75 * J2_EARTH * el.nRadSec * reOverP2 * Math.sqrt(1 - el.e * el.e) * (3 * cosI * cosI - 1);

  const raan = el.raanRad + raanDot * deltaSec;
  const argp = el.argpRad + argpDot * deltaSec;
  const M = (el.m0Rad + mDot * deltaSec) % TWO_PI;

  // Solve Kepler equation M = E - e sin(E) (5 Newton-Raphson iterations)
  let E = M;
  for (let k = 0; k < 5; k++) {
    E = E - (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  }

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const rOrb = el.aKm * (1 - el.e * cosE);
  const xOrb = el.aKm * (cosE - el.e);
  const yOrb = el.aKm * Math.sqrt(1 - el.e * el.e) * sinE;
  void rOrb;

  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosW = Math.cos(argp);
  const sinW = Math.sin(argp);

  const px = cosO * cosW - sinO * sinW * cosI;
  const py = sinO * cosW + cosO * sinW * cosI;
  const pz = sinW * sinI;

  const qx = -cosO * sinW - sinO * cosW * cosI;
  const qy = -sinO * sinW + cosO * cosW * cosI;
  const qz = cosW * sinI;

  return {
    x: px * xOrb + qx * yOrb,
    y: py * xOrb + qy * yOrb,
    z: pz * xOrb + qz * yOrb,
  };
}
