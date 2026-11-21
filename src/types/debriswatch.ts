import type { OMMJsonObject } from 'satellite.js';

export type CelesTrakGroup =
  | 'stations'
  | 'active'
  | 'resource'
  | 'weather'
  | 'cosmos-1408-debris'
  | 'fengyun-1c-debris'
  | 'iridium-33-debris'
  | 'cosmos-2251-debris';

export const CELESTRAK_GROUPS: ReadonlyArray<{
  id: CelesTrakGroup;
  label: string;
  isDebris: boolean;
}> = [
  { id: 'stations', label: 'Space Stations', isDebris: false },
  { id: 'resource', label: 'Earth Observation', isDebris: false },
  { id: 'weather', label: 'Weather Satellites', isDebris: false },
  { id: 'active', label: 'Active Constellations', isDebris: false },
  { id: 'cosmos-1408-debris', label: 'Cosmos 1408 Debris', isDebris: true },
  { id: 'fengyun-1c-debris', label: 'Fengyun-1C Debris', isDebris: true },
  { id: 'iridium-33-debris', label: 'Iridium 33 Debris', isDebris: true },
  { id: 'cosmos-2251-debris', label: 'Cosmos 2251 Debris', isDebris: true },
];

export type ObjectClass = 'DEBRIS' | 'ACTIVE' | 'EO' | 'STATION';

export type AltitudeBand = 'LEO' | 'MEO' | 'GEO';

export type DataStatus = 'LIVE DATA' | 'CACHED DATA' | 'SAMPLE DATA';

export type BaseImageryMode = 'gibs-blue-marble' | 'osm-dark' | 'gibs-night';

export interface CatalogObject {
  noradId: number;
  name: string;
  objectId: string;
  group: CelesTrakGroup;
  objectClass: ObjectClass;
  altitudeBand: AltitudeBand;
  epochIso: string;
  epochAgeHours: number;
  inclinationDeg: number;
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
  eccentricity: number;
  omm: OMMJsonObject;
  dataStatus: DataStatus;
}

export interface LiveTelemetrySnapshot {
  noradId: number;
  ecefX: number;
  ecefY: number;
  ecefZ: number;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
  vxEcefKmS: number;
  vyEcefKmS: number;
  vzEcefKmS: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface StateVectorReport {
  noradId: number;
  epochUtc: string;
  rEciKm: Vector3;
  vEciKmS: Vector3;
  rEcefKm: Vector3;
  vEcefKmS: Vector3;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
  ecefSpeedKmS: number;
  flightPathAngleDeg: number;
  headingDeg: number;
  angularMomentumKm2S: Vector3;
  angularMomentumMag: number;
  specificEnergyKm2S2: number;
  semiMajorAxisKm: number;
  rtnEcef: {
    radial: Vector3;
    transverse: Vector3;
    normal: Vector3;
  };
}

export interface ConjunctionCandidate {
  id: string;
  primaryNoradId: number;
  primaryName: string;
  secondaryNoradId: number;
  secondaryName: string;
  secondaryClass: ObjectClass;
  tcaUtcMs: number;
  missDistanceKm: number;
  relativeVelocityKmS: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
}

export type FragmentationMode = 'isotropic' | 'directional';

export interface FragmentSpreadPoint {
  elapsedHours: number;
  orbitNumber: number;
  altSpreadKm: number;
  alongTrackSpreadKm: number;
  minAltKm: number;
  maxAltKm: number;
}

export interface FragmentationSummary {
  parentNoradId: number;
  parentName: string;
  breakupTimeMs: number;
  fragmentCount: number;
  deltaVSigmaMS: number;
  mode: FragmentationMode;
  proximityThresholdKm: number;
  trackedObjectsInProximity24h: number;
  spreadSeries: FragmentSpreadPoint[];
}

export interface RegionBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface OverflightPass {
  noradId: number;
  name: string;
  objectClass: ObjectClass;
  group: CelesTrakGroup;
  aosUtcMs: number;
  losUtcMs: number;
  durationSec: number;
  maxElevationDeg: number;
}

export interface BriefingPayload {
  simUtc: string;
  dataStatus: DataStatus;
  totalTracked: number;
  countsByClass: Record<ObjectClass, number>;
  countsByBand: Record<AltitudeBand, number>;
  mostCrowdedShell: { label: string; count: number };
  topConjunctions: Array<{
    primary: string;
    secondary: string;
    tcaUtc: string;
    missDistanceKm: number;
    relativeVelocityKmS: number;
    risk: string;
  }>;
  fragmentation: FragmentationSummary | null;
  regionOverflight: {
    regionName: string;
    eoPassCount48h: number;
    debrisPassCount48h: number;
  } | null;
}
