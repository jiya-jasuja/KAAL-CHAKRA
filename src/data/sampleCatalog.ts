import type { OMMJsonObject } from 'satellite.js';
import type { CelesTrakGroup } from '../types/debriswatch.ts';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function makeRecentEpoch(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 3600_000);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.000000`
  );
}

function makeOmm(opts: {
  name: string;
  objectId: string;
  noradId: number;
  meanMotion: number;
  ecc: number;
  inc: number;
  raan: number;
  argp: number;
  ma: number;
  bstar?: number;
  hoursAgo?: number;
}): OMMJsonObject {
  return {
    OBJECT_NAME: opts.name,
    OBJECT_ID: opts.objectId,
    EPOCH: makeRecentEpoch(opts.hoursAgo ?? 8),
    MEAN_MOTION: opts.meanMotion,
    ECCENTRICITY: opts.ecc,
    INCLINATION: opts.inc,
    RA_OF_ASC_NODE: ((opts.raan % 360) + 360) % 360,
    ARG_OF_PERICENTER: ((opts.argp % 360) + 360) % 360,
    MEAN_ANOMALY: ((opts.ma % 360) + 360) % 360,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: opts.noradId,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 45200,
    BSTAR: opts.bstar ?? 0.00018,
    MEAN_MOTION_DOT: 0.00004,
    MEAN_MOTION_DDOT: 0,
  };
}

export interface BundledSampleRecord {
  group: CelesTrakGroup;
  omm: OMMJsonObject;
}

export function getBundledSampleCatalog(): BundledSampleRecord[] {
  const list: BundledSampleRecord[] = [
    // Space Stations
    {
      group: 'stations',
      omm: makeOmm({
        name: 'ISS (ZARYA)',
        objectId: '1998-067A',
        noradId: 25544,
        meanMotion: 15.4981,
        ecc: 0.00048,
        inc: 51.6416,
        raan: 42.1,
        argp: 112.4,
        ma: 248.2,
        bstar: 0.00014,
      }),
    },
    {
      group: 'stations',
      omm: makeOmm({
        name: 'CSS (TIANHE)',
        objectId: '2021-035A',
        noradId: 48274,
        meanMotion: 15.6054,
        ecc: 0.00039,
        inc: 41.474,
        raan: 168.5,
        argp: 72.1,
        ma: 194.6,
        bstar: 0.00016,
      }),
    },
    // Earth Observation (resource)
    {
      group: 'resource',
      omm: makeOmm({
        name: 'SENTINEL-2A',
        objectId: '2015-028A',
        noradId: 40697,
        meanMotion: 14.3081,
        ecc: 0.00014,
        inc: 98.568,
        raan: 145.2,
        argp: 90.0,
        ma: 34.5,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'SENTINEL-2B',
        objectId: '2017-013A',
        noradId: 42063,
        meanMotion: 14.3081,
        ecc: 0.00013,
        inc: 98.569,
        raan: 145.2,
        argp: 90.0,
        ma: 214.5,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'LANDSAT 8',
        objectId: '2013-008A',
        noradId: 39084,
        meanMotion: 14.5712,
        ecc: 0.00012,
        inc: 98.21,
        raan: 131.4,
        argp: 92.4,
        ma: 112.8,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'LANDSAT 9',
        objectId: '2021-088A',
        noradId: 49260,
        meanMotion: 14.5711,
        ecc: 0.00013,
        inc: 98.22,
        raan: 131.4,
        argp: 91.2,
        ma: 292.8,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'TERRA',
        objectId: '1999-068A',
        noradId: 25994,
        meanMotion: 14.5934,
        ecc: 0.00015,
        inc: 98.18,
        raan: 122.0,
        argp: 88.0,
        ma: 155.0,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'AQUA',
        objectId: '2002-022A',
        noradId: 27424,
        meanMotion: 14.571,
        ecc: 0.00018,
        inc: 98.2,
        raan: 174.5,
        argp: 94.0,
        ma: 62.4,
      }),
    },
    {
      group: 'resource',
      omm: makeOmm({
        name: 'ENVISAT',
        objectId: '2002-009A',
        noradId: 27386,
        meanMotion: 14.3712,
        ecc: 0.00016,
        inc: 98.31,
        raan: 118.4,
        argp: 72.1,
        ma: 162.8,
      }),
    },
    // Weather
    {
      group: 'weather',
      omm: makeOmm({
        name: 'NOAA 20 (JPSS-1)',
        objectId: '2017-073A',
        noradId: 43013,
        meanMotion: 14.1964,
        ecc: 0.00017,
        inc: 98.74,
        raan: 168.4,
        argp: 90.4,
        ma: 18.2,
      }),
    },
    {
      group: 'weather',
      omm: makeOmm({
        name: 'NOAA 19',
        objectId: '2009-005A',
        noradId: 33591,
        meanMotion: 14.1242,
        ecc: 0.0014,
        inc: 99.14,
        raan: 215.2,
        argp: 102.0,
        ma: 245.1,
      }),
    },
    {
      group: 'weather',
      omm: makeOmm({
        name: 'METOP-B',
        objectId: '2012-049A',
        noradId: 38771,
        meanMotion: 14.215,
        ecc: 0.00019,
        inc: 98.68,
        raan: 108.5,
        argp: 86.0,
        ma: 82.6,
      }),
    },
    {
      group: 'weather',
      omm: makeOmm({
        name: 'GOES 16',
        objectId: '2016-071A',
        noradId: 41866,
        meanMotion: 1.0027,
        ecc: 0.00011,
        inc: 0.04,
        raan: 85.0,
        argp: 120.0,
        ma: 142.0,
      }),
    },
    // Active LEO / MEO / GEO
    {
      group: 'active',
      omm: makeOmm({
        name: 'HST (HUBBLE)',
        objectId: '1990-037B',
        noradId: 20580,
        meanMotion: 15.1462,
        ecc: 0.00028,
        inc: 28.47,
        raan: 94.0,
        argp: 200.0,
        ma: 140.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'STARLINK-1007',
        objectId: '2019-074A',
        noradId: 44713,
        meanMotion: 15.0639,
        ecc: 0.00014,
        inc: 53.05,
        raan: 112.4,
        argp: 89.1,
        ma: 44.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'STARLINK-31240',
        objectId: '2024-022C',
        noradId: 58922,
        meanMotion: 15.118,
        ecc: 0.00013,
        inc: 53.16,
        raan: 214.0,
        argp: 94.0,
        ma: 288.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'ONEWEB-0124',
        objectId: '2021-011B',
        noradId: 47789,
        meanMotion: 13.151,
        ecc: 0.0002,
        inc: 87.9,
        raan: 52.0,
        argp: 90.0,
        ma: 185.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'GPS BIIR-2 (PRN 13)',
        objectId: '1997-035A',
        noradId: 24876,
        meanMotion: 2.0056,
        ecc: 0.0062,
        inc: 55.4,
        raan: 142.0,
        argp: 48.0,
        ma: 215.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'GALILEO 11 (FOC FM8)',
        objectId: '2015-079B',
        noradId: 41175,
        meanMotion: 1.7047,
        ecc: 0.0003,
        inc: 56.1,
        raan: 262.0,
        argp: 15.0,
        ma: 96.0,
      }),
    },
    {
      group: 'active',
      omm: makeOmm({
        name: 'INTELSAT 901',
        objectId: '2001-024A',
        noradId: 26824,
        meanMotion: 1.0027,
        ecc: 0.00025,
        inc: 1.85,
        raan: 48.0,
        argp: 150.0,
        ma: 22.0,
      }),
    },
  ];

  // Add deterministic debris fragments across the 4 requested debris groups (bringing total to ~56)
  const addDebrisCloud = (
    group: CelesTrakGroup,
    prefix: string,
    baseNorad: number,
    baseMm: number,
    baseInc: number,
    baseRaan: number,
    count: number
  ) => {
    for (let i = 0; i < count; i++) {
      const s1 = Math.sin(i * 12.9898 + baseNorad) * 43758.5453;
      const r1 = s1 - Math.floor(s1);
      const s2 = Math.sin(i * 78.233 + baseNorad) * 19283.112;
      const r2 = s2 - Math.floor(s2);
      list.push({
        group,
        omm: makeOmm({
          name: `${prefix} DEB`,
          objectId: `2009-DEB-${baseNorad + i}`,
          noradId: baseNorad + i,
          meanMotion: baseMm + (r1 - 0.5) * 0.42,
          ecc: 0.0018 + r2 * 0.016,
          inc: baseInc + (r2 - 0.5) * 1.4,
          raan: baseRaan + (r1 - 0.5) * 18,
          argp: (i * 41) % 360,
          ma: (i * 39.5 + r2 * 25) % 360,
          bstar: 0.0005 + r1 * 0.0012,
        }),
      });
    }
  };

  addDebrisCloud('cosmos-1408-debris', 'COSMOS 1408', 49900, 15.31, 82.56, 38.0, 9);
  addDebrisCloud('fengyun-1c-debris', 'FENGYUN 1C', 29800, 14.18, 98.89, 144.8, 10);
  addDebrisCloud('iridium-33-debris', 'IRIDIUM 33', 33770, 14.33, 86.39, 121.0, 8);
  addDebrisCloud('cosmos-2251-debris', 'COSMOS 2251', 33756, 14.31, 74.04, 18.2, 9);

  return list;
}
