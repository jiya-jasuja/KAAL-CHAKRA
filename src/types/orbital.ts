import type { OMMJsonObject, SatRec } from 'satellite.js';

export type DebrisCategory =
  | 'FRAGMENTATION'
  | 'ROCKET_BODY'
  | 'PAYLOAD'
  | 'STATION';

export type OrbitalRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'NOMINAL';

export type ViewportDimension = '3d' | '2d';

export type GlobeBasemapStyle = 'dark-vector' | 'esri-satellite';

export interface OrbitalObject {
  id: string;
  noradId: number;
  name: string;
  objectId: string;
  category: DebrisCategory;
  regime: OrbitalRegime;
  risk: RiskLevel;
  rcsSize: 'LARGE' | 'MEDIUM' | 'SMALL';
  originGroup: string;
  countryCode: string;
  apogeeKm: number;
  perigeeKm: number;
  inclinationDeg: number;
  periodMin: number;
  omm: OMMJsonObject;
}

export interface CompiledOrbitalObject extends OrbitalObject {
  satrec: SatRec;
}

export interface PropagatedState {
  noradId: number;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  velocityKmS: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface OrbitalHotspot {
  id: string;
  name: string;
  subtitle: string;
  regime: OrbitalRegime;
  altitudeKm: number;
  inclinationDeg: number;
  targetNoradId: number;
  cameraLat: number;
  cameraLon: number;
  cameraDistance: number;
  description: string;
  estimatedFragments: number;
}

export interface GroundStation {
  id: string;
  name: string;
  code: string;
  region: string;
  latDeg: number;
  lonDeg: number;
  apertureM: number;
  sensorType: 'Optical + Laser Ranging' | 'Phased Array Radar' | 'Deep Space Optical';
  elevationM: number;
  description: string;
}

export interface LayerVisibility {
  fragmentation: boolean;
  rocketBodies: boolean;
  payloads: boolean;
  conjunctionArcs: boolean;
  groundStations: boolean;
  kesslerBands: boolean;
  shells: boolean;
  orbitTrack: boolean;
}

export interface ConjunctionEvent {
  id: string;
  primaryNoradId: number;
  primaryName: string;
  secondaryNoradId: number;
  secondaryName: string;
  missDistanceKm: number;
  relativeVelocityKmS: number;
  tcaMinutes: number;
  probability: number;
  altitudeKm: number;
  risk: RiskLevel;
}

export interface OrbitalApiResponse {
  source: 'celestrak-live' | 'catalog-cache';
  fetchedAt: string;
  count: number;
  group: string;
  objects: OrbitalObject[];
}

export interface ShellInstabilityProfile {
  id: string;
  label: string;
  altitudeRange: string;
  instabilityIndex: number;
  status: RiskLevel;
  objectCount: number;
  fragmentCount: number;
  rocketBodyCount: number;
  conjunctionCount: number;
  summaryNow: string;
}

export interface ConvergenceZone {
  id: string;
  name: string;
  altitudeBand: string;
  latDeg: number;
  lonDeg: number;
  radiusKm: number;
  overlappingTypes: string[];
  severity: number;
  summary: string;
  targetNoradId: number;
}

export interface DataAttribution {
  layer: string;
  source: string;
  cadence: string;
  license: string;
  attribution: string;
}

export interface ComputedIntelResponse {
  generatedAt: string;
  source: 'celestrak-live' | 'catalog-cache';
  overallInstabilityIndex: number;
  shells: ShellInstabilityProfile[];
  convergences: ConvergenceZone[];
  attributions: DataAttribution[];
}
