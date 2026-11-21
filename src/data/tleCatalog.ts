import type { OMMJsonObject } from 'satellite.js';
import type {
  DebrisCategory,
  GroundStation,
  OrbitalHotspot,
  OrbitalObject,
  OrbitalRegime,
  RiskLevel,
} from '../types/orbital.ts';

const EARTH_RADIUS_KM = 6371.0;
const MU_EARTH = 398600.4418;

export const GROUND_STATIONS: GroundStation[] = [
  {
    id: 'maui-amos',
    name: 'Maui Space Surveillance',
    code: 'AMOS-HI',
    region: 'Hawaii, USA',
    latDeg: 20.708,
    lonDeg: -156.257,
    apertureM: 3.67,
    sensorType: 'Optical + Laser Ranging',
    elevationM: 3055,
    description: 'High-altitude electro-optical telescope complex tracking sub-10cm LEO fragments and GEO payloads across the Pacific corridor.',
  },
  {
    id: 'esa-tenerife',
    name: 'ESA Optical Ground Station',
    code: 'OGS-TFS',
    region: 'Canary Islands, Spain',
    latDeg: 28.3,
    lonDeg: -16.51,
    apertureM: 1.0,
    sensorType: 'Optical + Laser Ranging',
    elevationM: 2393,
    description: 'European Space Agency survey telescope monitoring GEO graveyard drift and sun-synchronous fragmentation belts.',
  },
  {
    id: 'goldstone-dsn',
    name: 'Goldstone Orbital Radar',
    code: 'GDS-CA',
    region: 'Mojave, USA',
    latDeg: 35.426,
    lonDeg: -116.89,
    apertureM: 70.0,
    sensorType: 'Phased Array Radar',
    elevationM: 1002,
    description: 'High-power X-band radar installation performing millimeter-scale orbital debris flux measurements.',
  },
  {
    id: 'svalbard-sat',
    name: 'Svalbard Polar Tracker',
    code: 'SVAL-NO',
    region: 'Svalbard, Norway',
    latDeg: 78.229,
    lonDeg: 15.407,
    apertureM: 13.0,
    sensorType: 'Phased Array Radar',
    elevationM: 463,
    description: 'Arctic polar-orbit station capturing every revolution of Cosmos 2251 and Fengyun-1C sun-synchronous crossings.',
  },
  {
    id: 'canberra-act',
    name: 'Canberra Tracking Complex',
    code: 'CDS-AU',
    region: 'Tidbinbilla, Australia',
    latDeg: -35.401,
    lonDeg: 148.981,
    apertureM: 34.0,
    sensorType: 'Deep Space Optical',
    elevationM: 688,
    description: 'Southern hemisphere tracking hub covering South Pacific re-entry corridors and geostationary transfer arcs.',
  },
  {
    id: 'kourou-csg',
    name: 'Kourou Equatorial Radar',
    code: 'CSG-GF',
    region: 'French Guiana',
    latDeg: 5.236,
    lonDeg: -52.768,
    apertureM: 18.0,
    sensorType: 'Phased Array Radar',
    elevationM: 42,
    description: 'Equatorial surveillance array monitoring Ariane upper stages and low-inclination geostationary transfer orbits.',
  },
];

export const ORBITAL_HOTSPOTS: OrbitalHotspot[] = [
  {
    id: 'cosmos-2251',
    name: 'Cosmos 2251 Cloud',
    subtitle: '790 km · 74.0° Polar Crossing',
    regime: 'LEO',
    altitudeKm: 790,
    inclinationDeg: 74.0,
    targetNoradId: 33757,
    cameraLat: 54.0,
    cameraLon: 78.0,
    cameraDistance: 1.72,
    description:
      'High-density fragmentation shell from the 2009 hypervelocity collision between Cosmos 2251 and Iridium 33 at 11.7 km/s.',
    estimatedFragments: 1840,
  },
  {
    id: 'fengyun-1c',
    name: 'Fengyun-1C Belt',
    subtitle: '850 km · 98.9° Sun-Synchronous',
    regime: 'LEO',
    altitudeKm: 850,
    inclinationDeg: 98.9,
    targetNoradId: 29805,
    cameraLat: 32.0,
    cameraLon: 112.0,
    cameraDistance: 1.78,
    description:
      'Long-lived sun-synchronous debris belt created in 2007. High orbital altitude means fragments persist for decades.',
    estimatedFragments: 3520,
  },
  {
    id: 'iss-corridor',
    name: 'ISS Orbital Corridor',
    subtitle: '418 km · 51.6° Crewed Shell',
    regime: 'LEO',
    altitudeKm: 418,
    inclinationDeg: 51.6,
    targetNoradId: 25544,
    cameraLat: 24.0,
    cameraLon: -42.0,
    cameraDistance: 1.54,
    description:
      'Active crewed station trajectory requiring periodic debris avoidance maneuvers against untracked millimeter-to-decimeter fragments.',
    estimatedFragments: 240,
  },
  {
    id: 'sl16-graveyard',
    name: 'SL-16 Rocket Bodies',
    subtitle: '845 km · 71.0° High-Mass Stages',
    regime: 'LEO',
    altitudeKm: 845,
    inclinationDeg: 71.0,
    targetNoradId: 22220,
    cameraLat: -28.0,
    cameraLon: 18.0,
    cameraDistance: 1.76,
    description:
      '9-ton derelict Zenit-2 second stages orbiting without propulsion, representing primary collision-cascade catalysts.',
    estimatedFragments: 48,
  },
  {
    id: 'geo-disposal',
    name: 'GEO Disposal Belt',
    subtitle: '35,786 km · 0.4° Equatorial Ring',
    regime: 'GEO',
    altitudeKm: 35786,
    inclinationDeg: 0.4,
    targetNoradId: 26824,
    cameraLat: 6.0,
    cameraLon: -15.0,
    cameraDistance: 6.8,
    description:
      'Geostationary ring and super-synchronous graveyard populated by decommissioned communications platforms and apogee kick motors.',
    estimatedFragments: 310,
  },
];

function computeOrbitMetrics(meanMotionRevDay: number, eccentricity: number): {
  apogeeKm: number;
  perigeeKm: number;
  periodMin: number;
  regime: OrbitalRegime;
} {
  const nRadSec = (meanMotionRevDay * 2 * Math.PI) / 86400;
  const semiMajorKm = Math.cbrt(MU_EARTH / (nRadSec * nRadSec));
  const apogeeKm = Math.max(160, semiMajorKm * (1 + eccentricity) - EARTH_RADIUS_KM);
  const perigeeKm = Math.max(150, semiMajorKm * (1 - eccentricity) - EARTH_RADIUS_KM);
  const periodMin = 1440 / meanMotionRevDay;

  let regime: OrbitalRegime = 'LEO';
  if (apogeeKm > 30000 && perigeeKm > 30000) {
    regime = 'GEO';
  } else if (eccentricity > 0.2) {
    regime = 'HEO';
  } else if (perigeeKm > 2000) {
    regime = 'MEO';
  }

  return { apogeeKm, perigeeKm, periodMin, regime };
}

function deterministicSeed(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function buildOrbitalObjectFromOmm(
  omm: OMMJsonObject,
  overrides?: {
    category?: DebrisCategory;
    risk?: RiskLevel;
    rcsSize?: 'LARGE' | 'MEDIUM' | 'SMALL';
    originGroup?: string;
    countryCode?: string;
  }
): OrbitalObject {
  const noradId = Number(omm.NORAD_CAT_ID) || 90000;
  const meanMotion = Number(omm.MEAN_MOTION) || 14.3;
  const eccentricity = Number(omm.ECCENTRICITY) || 0.001;
  const inclinationDeg = Number(omm.INCLINATION) || 51.6;
  const { apogeeKm, perigeeKm, periodMin, regime } = computeOrbitMetrics(
    meanMotion,
    eccentricity
  );

  const upperName = omm.OBJECT_NAME.toUpperCase();
  let category: DebrisCategory = overrides?.category ?? 'FRAGMENTATION';
  if (!overrides?.category) {
    if (upperName.includes('ISS') || upperName.includes('CSS') || upperName.includes('TIANHE')) {
      category = 'STATION';
    } else if (upperName.includes('R/B') || upperName.includes('SL-16') || upperName.includes('ARIANE') || upperName.includes('BREEZE')) {
      category = 'ROCKET_BODY';
    } else if (upperName.includes('DEB') || upperName.includes('FRAG')) {
      category = 'FRAGMENTATION';
    } else {
      category = 'PAYLOAD';
    }
  }

  let rcsSize: 'LARGE' | 'MEDIUM' | 'SMALL' = overrides?.rcsSize ?? 'SMALL';
  if (!overrides?.rcsSize) {
    if (category === 'STATION' || category === 'ROCKET_BODY') rcsSize = 'LARGE';
    else if (category === 'PAYLOAD') rcsSize = 'MEDIUM';
    else rcsSize = 'SMALL';
  }

  let risk: RiskLevel = overrides?.risk ?? 'MODERATE';
  if (!overrides?.risk) {
    if (category === 'ROCKET_BODY' || (perigeeKm > 700 && perigeeKm < 900 && category === 'FRAGMENTATION')) {
      risk = 'CRITICAL';
    } else if (perigeeKm > 400 && perigeeKm < 1100 && category === 'FRAGMENTATION') {
      risk = 'HIGH';
    } else if (category === 'STATION' || category === 'PAYLOAD') {
      risk = 'NOMINAL';
    } else {
      risk = 'MODERATE';
    }
  }

  return {
    id: `norad-${noradId}`,
    noradId,
    name: omm.OBJECT_NAME,
    objectId: omm.OBJECT_ID,
    category,
    regime,
    risk,
    rcsSize,
    originGroup: overrides?.originGroup ?? 'catalog',
    countryCode: overrides?.countryCode ?? 'INTL',
    apogeeKm: Math.round(apogeeKm * 10) / 10,
    perigeeKm: Math.round(perigeeKm * 10) / 10,
    inclinationDeg: Math.round(inclinationDeg * 100) / 100,
    periodMin: Math.round(periodMin * 10) / 10,
    omm,
  };
}

export function generateCuratedDebrisCatalog(): OrbitalObject[] {
  const epoch = '2026-11-21T08:00:00.000000';
  const records: OrbitalObject[] = [];

  const anchorEntries: Array<{
    omm: OMMJsonObject;
    category: DebrisCategory;
    risk: RiskLevel;
    rcsSize: 'LARGE' | 'MEDIUM' | 'SMALL';
    originGroup: string;
    countryCode: string;
  }> = [
    {
      omm: {
        OBJECT_NAME: 'ISS (ZARYA)',
        OBJECT_ID: '1998-067A',
        EPOCH: epoch,
        MEAN_MOTION: 15.4956,
        ECCENTRICITY: 0.00051,
        INCLINATION: 51.6416,
        RA_OF_ASC_NODE: 148.21,
        ARG_OF_PERICENTER: 64.12,
        MEAN_ANOMALY: 210.45,
        NORAD_CAT_ID: 25544,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00012,
        MEAN_MOTION_DOT: 0.00008,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'STATION',
      risk: 'NOMINAL',
      rcsSize: 'LARGE',
      originGroup: 'stations',
      countryCode: 'ISS',
    },
    {
      omm: {
        OBJECT_NAME: 'CSS (TIANHE)',
        OBJECT_ID: '2021-035A',
        EPOCH: epoch,
        MEAN_MOTION: 15.608,
        ECCENTRICITY: 0.00042,
        INCLINATION: 41.474,
        RA_OF_ASC_NODE: 265.14,
        ARG_OF_PERICENTER: 112.8,
        MEAN_ANOMALY: 44.2,
        NORAD_CAT_ID: 48274,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00014,
        MEAN_MOTION_DOT: 0.00009,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'STATION',
      risk: 'NOMINAL',
      rcsSize: 'LARGE',
      originGroup: 'stations',
      countryCode: 'PRC',
    },
    {
      omm: {
        OBJECT_NAME: 'COSMOS 2251 DEB',
        OBJECT_ID: '1993-036SX',
        EPOCH: epoch,
        MEAN_MOTION: 14.318,
        ECCENTRICITY: 0.0064,
        INCLINATION: 74.035,
        RA_OF_ASC_NODE: 184.4,
        ARG_OF_PERICENTER: 88.2,
        MEAN_ANOMALY: 142.1,
        NORAD_CAT_ID: 33757,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00045,
        MEAN_MOTION_DOT: 0.00002,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'FRAGMENTATION',
      risk: 'CRITICAL',
      rcsSize: 'SMALL',
      originGroup: 'cosmos-2251-debris',
      countryCode: 'CIS',
    },
    {
      omm: {
        OBJECT_NAME: 'FENGYUN 1C DEB',
        OBJECT_ID: '1999-025DX',
        EPOCH: epoch,
        MEAN_MOTION: 14.122,
        ECCENTRICITY: 0.0089,
        INCLINATION: 98.88,
        RA_OF_ASC_NODE: 212.5,
        ARG_OF_PERICENTER: 140.1,
        MEAN_ANOMALY: 52.8,
        NORAD_CAT_ID: 29805,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00038,
        MEAN_MOTION_DOT: 0.000015,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'FRAGMENTATION',
      risk: 'CRITICAL',
      rcsSize: 'SMALL',
      originGroup: 'fengyun-1c-debris',
      countryCode: 'PRC',
    },
    {
      omm: {
        OBJECT_NAME: 'SL-16 R/B',
        OBJECT_ID: '1992-076B',
        EPOCH: epoch,
        MEAN_MOTION: 14.142,
        ECCENTRICITY: 0.0018,
        INCLINATION: 71.01,
        RA_OF_ASC_NODE: 86.2,
        ARG_OF_PERICENTER: 214.0,
        MEAN_ANOMALY: 118.4,
        NORAD_CAT_ID: 22220,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00018,
        MEAN_MOTION_DOT: 0.000005,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'ROCKET_BODY',
      risk: 'CRITICAL',
      rcsSize: 'LARGE',
      originGroup: 'rocket-bodies',
      countryCode: 'CIS',
    },
    {
      omm: {
        OBJECT_NAME: 'ENVISAT (DEFUNCT)',
        OBJECT_ID: '2002-009A',
        EPOCH: epoch,
        MEAN_MOTION: 14.379,
        ECCENTRICITY: 0.00015,
        INCLINATION: 98.31,
        RA_OF_ASC_NODE: 310.5,
        ARG_OF_PERICENTER: 91.0,
        MEAN_ANOMALY: 274.2,
        NORAD_CAT_ID: 27386,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00011,
        MEAN_MOTION_DOT: 0.000004,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'PAYLOAD',
      risk: 'CRITICAL',
      rcsSize: 'LARGE',
      originGroup: 'active',
      countryCode: 'ESA',
    },
    {
      omm: {
        OBJECT_NAME: 'IRIDIUM 33 DEB',
        OBJECT_ID: '1997-051C',
        EPOCH: epoch,
        MEAN_MOTION: 14.345,
        ECCENTRICITY: 0.0032,
        INCLINATION: 86.4,
        RA_OF_ASC_NODE: 128.4,
        ARG_OF_PERICENTER: 46.5,
        MEAN_ANOMALY: 302.1,
        NORAD_CAT_ID: 33771,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00031,
        MEAN_MOTION_DOT: 0.000018,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'FRAGMENTATION',
      risk: 'HIGH',
      rcsSize: 'SMALL',
      originGroup: 'iridium-33-debris',
      countryCode: 'US',
    },
    {
      omm: {
        OBJECT_NAME: 'ARIANE 5 DEB (SYLDA)',
        OBJECT_ID: '2001-025C',
        EPOCH: epoch,
        MEAN_MOTION: 1.0027,
        ECCENTRICITY: 0.0012,
        INCLINATION: 0.42,
        RA_OF_ASC_NODE: 35.1,
        ARG_OF_PERICENTER: 120.0,
        MEAN_ANOMALY: 88.0,
        NORAD_CAT_ID: 26824,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.0,
        MEAN_MOTION_DOT: 0.0,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'ROCKET_BODY',
      risk: 'HIGH',
      rcsSize: 'LARGE',
      originGroup: 'geo-disposal',
      countryCode: 'ESA',
    },
    {
      omm: {
        OBJECT_NAME: 'HST (HUBBLE)',
        OBJECT_ID: '1990-037B',
        EPOCH: epoch,
        MEAN_MOTION: 15.146,
        ECCENTRICITY: 0.00028,
        INCLINATION: 28.469,
        RA_OF_ASC_NODE: 22.4,
        ARG_OF_PERICENTER: 185.2,
        MEAN_ANOMALY: 12.6,
        NORAD_CAT_ID: 20580,
        ELEMENT_SET_NO: 999,
        BSTAR: 0.00009,
        MEAN_MOTION_DOT: 0.000014,
        MEAN_MOTION_DDOT: 0,
      },
      category: 'PAYLOAD',
      risk: 'NOMINAL',
      rcsSize: 'LARGE',
      originGroup: 'active',
      countryCode: 'US',
    },
  ];

  for (const item of anchorEntries) {
    records.push(
      buildOrbitalObjectFromOmm(item.omm, {
        category: item.category,
        risk: item.risk,
        rcsSize: item.rcsSize,
        originGroup: item.originGroup,
        countryCode: item.countryCode,
      })
    );
  }

  // Generate 65 Cosmos 2251 fragmentation cluster objects
  for (let i = 0; i < 65; i++) {
    const s1 = deterministicSeed(i, 1);
    const s2 = deterministicSeed(i, 2);
    const s3 = deterministicSeed(i, 3);
    const s4 = deterministicSeed(i, 4);
    const noradId = 34000 + i;
    const omm: OMMJsonObject = {
      OBJECT_NAME: `COSMOS 2251 DEB-${String(i + 1).padStart(2, '0')}`,
      OBJECT_ID: `1993-036${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}`,
      EPOCH: epoch,
      MEAN_MOTION: 14.08 + s1 * 0.58,
      ECCENTRICITY: 0.001 + s2 * 0.022,
      INCLINATION: 73.6 + (s3 - 0.5) * 1.4,
      RA_OF_ASC_NODE: (184.4 + (s4 - 0.5) * 32 + 360) % 360,
      ARG_OF_PERICENTER: s2 * 360,
      MEAN_ANOMALY: (s1 * 360 + i * 17.3) % 360,
      NORAD_CAT_ID: noradId,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.00025 + s3 * 0.0005,
      MEAN_MOTION_DOT: 0.000012,
      MEAN_MOTION_DDOT: 0,
    };
    records.push(
      buildOrbitalObjectFromOmm(omm, {
        category: 'FRAGMENTATION',
        risk: i % 3 === 0 ? 'CRITICAL' : 'HIGH',
        rcsSize: i % 5 === 0 ? 'MEDIUM' : 'SMALL',
        originGroup: 'cosmos-2251-debris',
        countryCode: 'CIS',
      })
    );
  }

  // Generate 70 Fengyun-1C ASAT Sun-Synchronous debris fragments
  for (let i = 0; i < 70; i++) {
    const s1 = deterministicSeed(i, 11);
    const s2 = deterministicSeed(i, 12);
    const s3 = deterministicSeed(i, 13);
    const s4 = deterministicSeed(i, 14);
    const noradId = 30100 + i;
    const omm: OMMJsonObject = {
      OBJECT_NAME: `FENGYUN 1C DEB-${String(i + 1).padStart(2, '0')}`,
      OBJECT_ID: `1999-025${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 5) % 26))}`,
      EPOCH: epoch,
      MEAN_MOTION: 13.85 + s1 * 0.65,
      ECCENTRICITY: 0.002 + s2 * 0.028,
      INCLINATION: 98.4 + (s3 - 0.5) * 1.8,
      RA_OF_ASC_NODE: (212.5 + (s4 - 0.5) * 36 + 360) % 360,
      ARG_OF_PERICENTER: s3 * 360,
      MEAN_ANOMALY: (s2 * 360 + i * 19.7) % 360,
      NORAD_CAT_ID: noradId,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.0002 + s1 * 0.0004,
      MEAN_MOTION_DOT: 0.00001,
      MEAN_MOTION_DDOT: 0,
    };
    records.push(
      buildOrbitalObjectFromOmm(omm, {
        category: 'FRAGMENTATION',
        risk: i % 2 === 0 ? 'CRITICAL' : 'HIGH',
        rcsSize: 'SMALL',
        originGroup: 'fengyun-1c-debris',
        countryCode: 'PRC',
      })
    );
  }

  // Generate 35 Iridium-33 fragments
  for (let i = 0; i < 35; i++) {
    const s1 = deterministicSeed(i, 21);
    const s2 = deterministicSeed(i, 22);
    const s3 = deterministicSeed(i, 23);
    const noradId = 33800 + i;
    const omm: OMMJsonObject = {
      OBJECT_NAME: `IRIDIUM 33 DEB-${String(i + 1).padStart(2, '0')}`,
      OBJECT_ID: `1997-051${String.fromCharCode(65 + (i % 26))}`,
      EPOCH: epoch,
      MEAN_MOTION: 14.2 + s1 * 0.45,
      ECCENTRICITY: 0.0015 + s2 * 0.015,
      INCLINATION: 86.2 + (s3 - 0.5) * 1.1,
      RA_OF_ASC_NODE: (128.4 + (s1 - 0.5) * 24 + 360) % 360,
      ARG_OF_PERICENTER: s2 * 360,
      MEAN_ANOMALY: (s3 * 360 + i * 29) % 360,
      NORAD_CAT_ID: noradId,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.00028,
      MEAN_MOTION_DOT: 0.000011,
      MEAN_MOTION_DDOT: 0,
    };
    records.push(
      buildOrbitalObjectFromOmm(omm, {
        category: 'FRAGMENTATION',
        risk: 'HIGH',
        rcsSize: 'SMALL',
        originGroup: 'iridium-33-debris',
        countryCode: 'US',
      })
    );
  }

  // Generate 24 Derelict Rocket Bodies (SL-16, CZ-4B, Delta II, Ariane)
  const rbNames = ['SL-16 R/B', 'CZ-4B R/B', 'DELTA 2 R/B', 'ARIANE 44L R/B', 'BREEZE-M R/B'];
  for (let i = 0; i < 24; i++) {
    const s1 = deterministicSeed(i, 31);
    const s2 = deterministicSeed(i, 32);
    const s3 = deterministicSeed(i, 33);
    const noradId = 22300 + i * 3;
    const isGeoTransfer = i >= 18;
    const omm: OMMJsonObject = {
      OBJECT_NAME: `${rbNames[i % rbNames.length]} #${i + 1}`,
      OBJECT_ID: `${1994 + (i % 25)}-${String(10 + i).padStart(2, '0')}B`,
      EPOCH: epoch,
      MEAN_MOTION: isGeoTransfer ? 1.003 + s1 * 0.04 : 13.95 + s1 * 0.85,
      ECCENTRICITY: isGeoTransfer ? 0.002 + s2 * 0.008 : 0.001 + s2 * 0.014,
      INCLINATION: isGeoTransfer ? 0.4 + s3 * 6.5 : 65 + s3 * 34,
      RA_OF_ASC_NODE: s1 * 360,
      ARG_OF_PERICENTER: s2 * 360,
      MEAN_ANOMALY: s3 * 360,
      NORAD_CAT_ID: noradId,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.00014,
      MEAN_MOTION_DOT: 0.000004,
      MEAN_MOTION_DDOT: 0,
    };
    records.push(
      buildOrbitalObjectFromOmm(omm, {
        category: 'ROCKET_BODY',
        risk: i % 2 === 0 ? 'CRITICAL' : 'HIGH',
        rcsSize: 'LARGE',
        originGroup: isGeoTransfer ? 'geo-disposal' : 'rocket-bodies',
        countryCode: i % 3 === 0 ? 'CIS' : i % 3 === 1 ? 'PRC' : 'US',
      })
    );
  }

  // Generate 24 Active Payloads & GEO satellites
  for (let i = 0; i < 24; i++) {
    const s1 = deterministicSeed(i, 41);
    const s2 = deterministicSeed(i, 42);
    const s3 = deterministicSeed(i, 43);
    const isGeo = i >= 14;
    const noradId = 45100 + i;
    const omm: OMMJsonObject = {
      OBJECT_NAME: isGeo ? `GEO RELAY-${i - 13}` : `SENTINEL LEO-${i + 1}`,
      OBJECT_ID: `2020-${String(20 + i).padStart(2, '0')}A`,
      EPOCH: epoch,
      MEAN_MOTION: isGeo ? 1.0027 : 14.8 + s1 * 0.45,
      ECCENTRICITY: 0.0003 + s2 * 0.0008,
      INCLINATION: isGeo ? 0.08 + s3 * 1.2 : 53.0 + s3 * 45.0,
      RA_OF_ASC_NODE: s1 * 360,
      ARG_OF_PERICENTER: s2 * 360,
      MEAN_ANOMALY: (s3 * 360 + i * 24) % 360,
      NORAD_CAT_ID: noradId,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.00006,
      MEAN_MOTION_DOT: 0.000002,
      MEAN_MOTION_DDOT: 0,
    };
    records.push(
      buildOrbitalObjectFromOmm(omm, {
        category: 'PAYLOAD',
        risk: 'NOMINAL',
        rcsSize: 'MEDIUM',
        originGroup: isGeo ? 'geo-disposal' : 'active',
        countryCode: 'INTL',
      })
    );
  }

  return records;
}
