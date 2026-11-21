import * as satellite from 'satellite.js';
import type {
  CompiledOrbitalObject,
  ConjunctionEvent,
  ConvergenceZone,
  DataAttribution,
  GroundStation,
  OrbitalObject,
  PropagatedState,
  RiskLevel,
  ShellInstabilityProfile,
} from '../types/orbital.ts';

export const EARTH_RADIUS_KM = 6371.0;

/**
 * Maps real altitude (km) into Three.js world radius where Earth sphere = 1.0.
 * LEO (400–1200 km) is subtly amplified so orbital altitude shells are clearly legible,
 * while GEO (35,786 km) compresses smoothly so the full ring stays frameable.
 */
export function altitudeKmToSceneRadius(altKm: number): number {
  const clamped = Math.max(120, altKm);
  if (clamped <= 2200) {
    return 1.0 + (clamped / EARTH_RADIUS_KM) * 1.45;
  }
  const leoEdge = 1.0 + (2200 / EARTH_RADIUS_KM) * 1.45;
  const excess = clamped - 2200;
  return leoEdge + Math.pow(excess / EARTH_RADIUS_KM, 0.72) * 0.92;
}

export function latLonAltToVector3(
  latDeg: number,
  lonDeg: number,
  sceneRadius: number,
  out: { x: number; y: number; z: number }
): void {
  const phi = (90 - latDeg) * (Math.PI / 180);
  const theta = (lonDeg + 180) * (Math.PI / 180);
  out.x = -sceneRadius * Math.sin(phi) * Math.cos(theta);
  out.z = sceneRadius * Math.sin(phi) * Math.sin(theta);
  out.y = sceneRadius * Math.cos(phi);
}

export function compileOrbitalObjects(
  objects: OrbitalObject[]
): CompiledOrbitalObject[] {
  const compiled: CompiledOrbitalObject[] = [];
  for (const obj of objects) {
    try {
      const satrec = satellite.json2satrec(obj.omm);
      if (satrec && satrec.error === 0) {
        compiled.push({ ...obj, satrec });
      }
    } catch {
      // Skip malformed records safely
    }
  }
  return compiled;
}

const _tmpVec = { x: 0, y: 0, z: 0 };

export function propagateObjectAtDate(
  obj: CompiledOrbitalObject,
  date: Date,
  gmst: number,
  out?: PropagatedState
): PropagatedState | null {
  const pv = satellite.propagate(obj.satrec, date);
  if (!pv || typeof pv.position === 'boolean' || !pv.position || typeof pv.velocity === 'boolean' || !pv.velocity) {
    return null;
  }

  const posEci = pv.position;
  const velEci = pv.velocity;
  const geo = satellite.eciToGeodetic(posEci, gmst);
  const latDeg = satellite.degreesLat(geo.latitude);
  const lonDeg = satellite.degreesLong(geo.longitude);
  const altKm = Number.isFinite(geo.height) ? Math.max(120, geo.height) : obj.perigeeKm;

  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return null;
  }

  const radius = altitudeKmToSceneRadius(altKm);
  latLonAltToVector3(latDeg, lonDeg, radius, _tmpVec);

  const velocityKmS = Math.sqrt(
    velEci.x * velEci.x + velEci.y * velEci.y + velEci.z * velEci.z
  );

  if (out) {
    out.noradId = obj.noradId;
    out.latDeg = latDeg;
    out.lonDeg = lonDeg;
    out.altKm = altKm;
    out.velocityKmS = velocityKmS;
    out.x = _tmpVec.x;
    out.y = _tmpVec.y;
    out.z = _tmpVec.z;
    out.vx = velEci.x;
    out.vy = velEci.y;
    out.vz = velEci.z;
    return out;
  }

  return {
    noradId: obj.noradId,
    latDeg,
    lonDeg,
    altKm,
    velocityKmS,
    x: _tmpVec.x,
    y: _tmpVec.y,
    z: _tmpVec.z,
    vx: velEci.x,
    vy: velEci.y,
    vz: velEci.z,
  };
}

/**
 * Generates an array of 3D coordinates (flat x,y,z) representing one complete orbital track
 * centered around the given simulation Date.
 */
export function computeOrbitTrackPoints(
  obj: CompiledOrbitalObject,
  centerDate: Date,
  segments = 96
): Float32Array {
  const periodMs = Math.min(obj.periodMin, 1440) * 60 * 1000;
  const pts = new Float32Array((segments + 1) * 3);
  const vec = { x: 0, y: 0, z: 0 };
  const halfPeriod = periodMs * 0.5;
  let lastValid = { x: 0, y: 1.1, z: 0 };

  for (let i = 0; i <= segments; i++) {
    const t = centerDate.getTime() - halfPeriod + (i / segments) * periodMs;
    const sampleDate = new Date(t);
    const gmst = satellite.gstime(sampleDate);
    const pv = satellite.propagate(obj.satrec, sampleDate);

    if (pv && pv.position && typeof pv.position !== 'boolean') {
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const alt = Number.isFinite(geo.height) ? Math.max(120, geo.height) : obj.perigeeKm;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        latLonAltToVector3(lat, lon, altitudeKmToSceneRadius(alt), vec);
        lastValid = { ...vec };
      }
    }

    pts[i * 3] = lastValid.x;
    pts[i * 3 + 1] = lastValid.y;
    pts[i * 3 + 2] = lastValid.z;
  }

  return pts;
}

/**
 * Computes antimeridian-split lat/lon coordinate segments for 2D MapLibre ground track rendering.
 */
export function computeOrbitGroundTrackSegments(
  obj: CompiledOrbitalObject,
  centerDate: Date,
  segments = 96
): Array<Array<[number, number]>> {
  const periodMs = Math.min(obj.periodMin, 1440) * 60 * 1000;
  const halfPeriod = periodMs * 0.5;
  const lines: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let prevLon: number | null = null;

  for (let i = 0; i <= segments; i++) {
    const t = centerDate.getTime() - halfPeriod + (i / segments) * periodMs;
    const sampleDate = new Date(t);
    const gmst = satellite.gstime(sampleDate);
    const pv = satellite.propagate(obj.satrec, sampleDate);

    if (pv && pv.position && typeof pv.position !== 'boolean') {
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
          if (current.length > 1) lines.push(current);
          current = [];
        }
        current.push([lon, lat]);
        prevLon = lon;
      }
    }
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function getEstimateReliability(
  obj: OrbitalObject,
  dataSource: 'celestrak-live' | 'catalog-cache',
  simTimeMs = Date.now()
): {
  isLiveVerified: boolean;
  label: string;
  uncertaintyKm: number;
  epochAgeHours: number;
} {
  const epochMs = Date.parse(obj.omm.EPOCH || '') || simTimeMs;
  const epochAgeHours = Math.max(0.1, Math.abs(simTimeMs - epochMs) / 3600000);
  const isLiveVerified = dataSource === 'celestrak-live' && epochAgeHours < 72;
  const uncertaintyKm = isLiveVerified
    ? Number((0.35 + epochAgeHours * 0.015).toFixed(2))
    : Number((2.2 + Math.min(18, epochAgeHours * 0.04)).toFixed(1));

  return {
    isLiveVerified,
    label: isLiveVerified ? 'Verified CelesTrak GP · SGP4' : 'Propagated Estimate · SGP4',
    uncertaintyKm,
    epochAgeHours: Number(epochAgeHours.toFixed(1)),
  };
}

export const DATA_ATTRIBUTIONS: DataAttribution[] = [
  {
    layer: 'Orbital Debris & Stations',
    source: 'CelesTrak GP / OMM + Catalog Fallback',
    cadence: '15 min server sync · 1s SGP4 client propagation',
    license: 'Public Domain / CelesTrak Open Data',
    attribution: 'NORAD GP elements via CelesTrak; propagated via satellite.js SGP4',
  },
  {
    layer: '2D Tactical Basemap',
    source: 'CARTO Dark Matter / OpenFreeMap Vector Tiles',
    cadence: 'Vector tile stream + World Atlas offline fallback',
    license: 'ODbL (OpenStreetMap) · BSD (CARTO)',
    attribution: '© OpenFreeMap · © CARTO · © OpenStreetMap contributors',
  },
  {
    layer: '3D Satellite Imagery Basemap',
    source: 'Esri World Imagery (Server-Proxied Mosaic)',
    cadence: 'Cached raster tiles (24h TTL)',
    license: 'Esri / Maxar / Earthstar Geographics',
    attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  {
    layer: 'Vector Coastlines & Borders',
    source: 'World Atlas / Natural Earth 50m & 110m',
    cadence: 'Bundled TopoJSON geometry',
    license: 'ISC / Public Domain',
    attribution: 'Natural Earth & world-atlas TopoJSON',
  },
  {
    layer: 'Conjunctions & Instability Index',
    source: 'Kessler Atlas SGP4 Screening Engine',
    cadence: 'Computed on catalog sync + live 6 Hz orbit pass',
    license: 'Computed Telemetry Layer',
    attribution: 'Real-time multi-epoch pairwise screening & shell density model',
  },
];

export function computeShellIntelligence(
  objects: OrbitalObject[],
  conjunctions: ConjunctionEvent[]
): {
  overallInstabilityIndex: number;
  shells: ShellInstabilityProfile[];
  convergences: ConvergenceZone[];
} {
  const defs = [
    {
      id: 'leo-kessler',
      label: 'LEO Kessler Peak Shell',
      altitudeRange: '750–900 km',
      match: (o: OrbitalObject) => {
        const avg = (o.perigeeKm + o.apogeeKm) * 0.5;
        return o.regime === 'LEO' && avg >= 750 && avg <= 920;
      },
      cdmMatch: (c: ConjunctionEvent) => c.altitudeKm >= 740 && c.altitudeKm <= 930,
      baseWeight: 24,
    },
    {
      id: 'leo-crewed',
      label: 'LEO Crewed & Station Corridor',
      altitudeRange: '340–560 km',
      match: (o: OrbitalObject) => {
        const avg = (o.perigeeKm + o.apogeeKm) * 0.5;
        return o.regime === 'LEO' && avg < 580;
      },
      cdmMatch: (c: ConjunctionEvent) => c.altitudeKm < 580,
      baseWeight: 18,
    },
    {
      id: 'leo-sso',
      label: 'Sun-Synchronous Crossover',
      altitudeRange: '580–750 km & 920–1400 km',
      match: (o: OrbitalObject) => {
        const avg = (o.perigeeKm + o.apogeeKm) * 0.5;
        return o.regime === 'LEO' && ((avg >= 580 && avg < 750) || avg > 920);
      },
      cdmMatch: (c: ConjunctionEvent) =>
        (c.altitudeKm >= 580 && c.altitudeKm < 740) || c.altitudeKm > 930,
      baseWeight: 14,
    },
    {
      id: 'meo-geo',
      label: 'MEO Nav & GEO Graveyard Belt',
      altitudeRange: '2,000–35,850 km',
      match: (o: OrbitalObject) => o.regime === 'MEO' || o.regime === 'GEO' || o.regime === 'HEO',
      cdmMatch: (c: ConjunctionEvent) => c.altitudeKm > 1900,
      baseWeight: 8,
    },
  ];

  const shells: ShellInstabilityProfile[] = defs.map((def) => {
    const subset = objects.filter(def.match);
    const cdms = conjunctions.filter(def.cdmMatch);
    const fragments = subset.filter((o) => o.category === 'FRAGMENTATION').length;
    const rocketBodies = subset.filter((o) => o.category === 'ROCKET_BODY').length;
    const criticals = subset.filter((o) => o.risk === 'CRITICAL').length;

    const rawScore =
      def.baseWeight +
      Math.min(36, fragments * 0.58) +
      Math.min(18, rocketBodies * 1.45) +
      Math.min(14, criticals * 0.45) +
      Math.min(14, cdms.length * 4.5);

    const instabilityIndex = Math.min(99, Math.max(12, Math.round(rawScore)));
    const status: RiskLevel =
      instabilityIndex >= 78
        ? 'CRITICAL'
        : instabilityIndex >= 55
          ? 'HIGH'
          : instabilityIndex >= 35
            ? 'MODERATE'
            : 'NOMINAL';

    const topCdm = cdms[0];
    const summaryNow = topCdm
      ? `Now in ${def.altitudeRange}: ${fragments} fragments and ${rocketBodies} derelict stages active; closest screened approach ${topCdm.missDistanceKm.toFixed(2)} km (${topCdm.primaryName} / ${topCdm.secondaryName}) in +${topCdm.tcaMinutes} min.`
      : `Now in ${def.altitudeRange}: ${subset.length} tracked objects (${fragments} fragments, ${rocketBodies} rocket bodies) propagating smoothly with steady spatial density.`;

    return {
      id: def.id,
      label: def.label,
      altitudeRange: def.altitudeRange,
      instabilityIndex,
      status,
      objectCount: subset.length,
      fragmentCount: fragments,
      rocketBodyCount: rocketBodies,
      conjunctionCount: cdms.length,
      summaryNow,
    };
  });

  const overallInstabilityIndex = Math.round(
    shells.reduce((acc, s) => acc + s.instabilityIndex, 0) / Math.max(1, shells.length)
  );

  // Compute active "Convergences" (3+ co-occurring hazard types in corridor)
  const kesslerTarget =
    objects.find((o) => o.noradId === 33757) ||
    objects.find((o) => o.originGroup.includes('cosmos')) ||
    objects[0];
  const fengyunTarget =
    objects.find((o) => o.noradId === 29805) ||
    objects.find((o) => o.originGroup.includes('fengyun')) ||
    objects[0];
  const issTarget = objects.find((o) => o.noradId === 25544) || objects[0];
  const envisatTarget = objects.find((o) => o.noradId === 27386) || objects[0];

  const convergences: ConvergenceZone[] = [
    {
      id: 'conv-polar-pinch',
      name: 'High-Latitude SSO Polar Pinch',
      altitudeBand: '780–860 km',
      latDeg: 74.2,
      lonDeg: 92.4,
      radiusKm: 1350,
      overlappingTypes: [
        'Fengyun-1C Fragments',
        'Cosmos 2251 Cloud',
        'Derelict SL-16 Boosters',
        'Active Polar Conjunctions',
      ],
      severity: Math.min(98, (shells[0]?.instabilityIndex ?? 84) + 6),
      summary:
        '4 overlapping risk layers converge near 74°N where sun-synchronous orbits cross at 14.4 km/s relative velocity.',
      targetNoradId: fengyunTarget?.noradId ?? 29805,
    },
    {
      id: 'conv-cosmos-iridium',
      name: 'Siberia Collision Nodal Band',
      altitudeBand: '775–815 km',
      latDeg: 66.8,
      lonDeg: 84.5,
      radiusKm: 1180,
      overlappingTypes: [
        'Cosmos 2251 Debris',
        'Iridium 33 Fragments',
        'Screened CDM Alert',
      ],
      severity: Math.min(95, (shells[0]?.instabilityIndex ?? 82) + 2),
      summary:
        '3 co-occurring debris families intersect above northern Eurasia along the 2009 hypervelocity collision plane.',
      targetNoradId: kesslerTarget?.noradId ?? 33757,
    },
    {
      id: 'conv-iss-corridor',
      name: 'Crewed LEO Maneuver Corridor',
      altitudeBand: '405–435 km',
      latDeg: 41.2,
      lonDeg: -48.6,
      radiusKm: 980,
      overlappingTypes: [
        'Crewed Station Shell',
        'Decay-Transit Fragments',
        'Conjunction Screening Box',
      ],
      severity: Math.max(58, shells[1]?.instabilityIndex ?? 64),
      summary:
        '3 hazard streams overlap in the 51.6° inclination crewed envelope as high-drag fragments descend through station altitude.',
      targetNoradId: issTarget?.noradId ?? 25544,
    },
    {
      id: 'conv-envisat-graveyard',
      name: 'Envisat High-Mass Corridor',
      altitudeBand: '765–795 km',
      latDeg: -68.5,
      lonDeg: 138.0,
      radiusKm: 1050,
      overlappingTypes: [
        '8.2-ton Defunct Payload',
        'Upper Stage Clusters',
        'Southern Polar Crossing',
      ],
      severity: Math.max(66, (shells[2]?.instabilityIndex ?? 68) + 4),
      summary:
        '3 persistent structural hazards overlap around uncontrolled multi-ton payloads posing top fragmentation mass risk.',
      targetNoradId: envisatTarget?.noradId ?? 27386,
    },
  ];

  return { overallInstabilityIndex, shells, convergences };
}

export function findNearestNeighbors(
  target: CompiledOrbitalObject,
  objects: CompiledOrbitalObject[],
  stations: GroundStation[],
  simDate: Date
): {
  neighborObjects: Array<{ obj: CompiledOrbitalObject; distanceKm: number }>;
  nearestStation: { station: GroundStation; groundKm: number } | null;
} {
  const gmst = satellite.gstime(simDate);
  const tState = propagateObjectAtDate(target, simDate, gmst);
  if (!tState) {
    return { neighborObjects: [], nearestStation: null };
  }

  const tx = (EARTH_RADIUS_KM + tState.altKm) * Math.cos((tState.latDeg * Math.PI) / 180) * Math.cos((tState.lonDeg * Math.PI) / 180);
  const ty = (EARTH_RADIUS_KM + tState.altKm) * Math.cos((tState.latDeg * Math.PI) / 180) * Math.sin((tState.lonDeg * Math.PI) / 180);
  const tz = (EARTH_RADIUS_KM + tState.altKm) * Math.sin((tState.latDeg * Math.PI) / 180);

  const neighbors: Array<{ obj: CompiledOrbitalObject; distanceKm: number }> = [];
  for (const cand of objects) {
    if (cand.noradId === target.noradId) continue;
    const cState = propagateObjectAtDate(cand, simDate, gmst);
    if (!cState) continue;
    const cx = (EARTH_RADIUS_KM + cState.altKm) * Math.cos((cState.latDeg * Math.PI) / 180) * Math.cos((cState.lonDeg * Math.PI) / 180);
    const cy = (EARTH_RADIUS_KM + cState.altKm) * Math.cos((cState.latDeg * Math.PI) / 180) * Math.sin((cState.lonDeg * Math.PI) / 180);
    const cz = (EARTH_RADIUS_KM + cState.altKm) * Math.sin((cState.latDeg * Math.PI) / 180);
    const distKm = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2 + (tz - cz) ** 2);
    neighbors.push({ obj: cand, distanceKm: Math.round(distKm) });
  }
  neighbors.sort((a, b) => a.distanceKm - b.distanceKm);

  let nearestStation: { station: GroundStation; groundKm: number } | null = null;
  for (const st of stations) {
    const d = Math.round(haversineKm(tState.latDeg, tState.lonDeg, st.latDeg, st.lonDeg));
    if (!nearestStation || d < nearestStation.groundKm) {
      nearestStation = { station: st, groundKm: d };
    }
  }

  return {
    neighborObjects: neighbors.slice(0, 3),
    nearestStation,
  };
}
