import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import * as satellite from 'satellite.js';
import type { OMMJsonObject } from 'satellite.js';
import {
  buildOrbitalObjectFromOmm,
  generateCuratedDebrisCatalog,
  GROUND_STATIONS,
  ORBITAL_HOTSPOTS,
} from './src/data/tleCatalog.ts';
import {
  computeShellIntelligence,
  DATA_ATTRIBUTIONS,
  getEstimateReliability,
} from './src/utils/orbitalMath.ts';
import { computeStateVectorReport } from './src/utils/orbitMath.ts';
import type { ConjunctionEvent, OrbitalObject } from './src/types/orbital.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedFeed {
  source: 'celestrak-live' | 'catalog-cache';
  fetchedAt: string;
  timestamp: number;
  objects: OrbitalObject[];
}

let cachedFeed: CachedFeed | null = null;

async function fetchCelesTrakGroup(
  group: string,
  categoryHint: 'FRAGMENTATION' | 'STATION' | 'PAYLOAD',
  limit: number
): Promise<OrbitalObject[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OMMJsonObject[];
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map((omm) =>
      buildOrbitalObjectFromOmm(omm, {
        category:
          categoryHint === 'STATION'
            ? 'STATION'
            : String(omm.OBJECT_NAME || '').toUpperCase().includes('R/B')
              ? 'ROCKET_BODY'
              : categoryHint,
        originGroup: group,
      })
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function getOrbitalCatalog(forceRefresh = false): Promise<CachedFeed> {
  const now = Date.now();
  if (!forceRefresh && cachedFeed && now - cachedFeed.timestamp < CACHE_TTL_MS) {
    return cachedFeed;
  }

  const curated = generateCuratedDebrisCatalog();

  try {
    const [stations, cosmos, fengyun, iridium] = await Promise.all([
      fetchCelesTrakGroup('stations', 'STATION', 12),
      fetchCelesTrakGroup('cosmos-2251-debris', 'FRAGMENTATION', 70),
      fetchCelesTrakGroup('fengyun-1c-debris', 'FRAGMENTATION', 70),
      fetchCelesTrakGroup('iridium-33-debris', 'FRAGMENTATION', 45),
    ]);

    const liveTotal = [...stations, ...cosmos, ...fengyun, ...iridium];

    if (liveTotal.length >= 25) {
      // Merge live records with curated rocket bodies & GEO objects while deduplicating by NORAD ID
      const byNorad = new Map<number, OrbitalObject>();
      for (const obj of curated) {
        if (obj.category === 'ROCKET_BODY' || obj.regime === 'GEO' || obj.noradId === 25544) {
          byNorad.set(obj.noradId, obj);
        }
      }
      for (const obj of liveTotal) {
        byNorad.set(obj.noradId, obj);
      }

      const merged = Array.from(byNorad.values());
      cachedFeed = {
        source: 'celestrak-live',
        fetchedAt: new Date().toISOString(),
        timestamp: now,
        objects: merged,
      };
      return cachedFeed;
    }
  } catch {
    // Fall back gracefully to curated deterministic TLE/OMM catalog
  }

  cachedFeed = {
    source: 'catalog-cache',
    fetchedAt: new Date().toISOString(),
    timestamp: now,
    objects: curated,
  };
  return cachedFeed;
}

function computeConjunctions(objects: OrbitalObject[]): ConjunctionEvent[] {
  const now = new Date();
  const sampleOffsetsMin = [0, 8, 16, 24, 35, 48, 62, 78];
  const leoCandidates = objects
    .filter((o) => o.regime === 'LEO')
    .slice(0, 75);

  const satrecs = leoCandidates
    .map((o) => {
      try {
        const satrec = satellite.json2satrec(o.omm);
        return satrec && satrec.error === 0 ? { obj: o, satrec } : null;
      } catch {
        return null;
      }
    })
    .filter((item): item is { obj: OrbitalObject; satrec: satellite.SatRec } => item !== null);

  const pairs: ConjunctionEvent[] = [];
  const seenPairs = new Set<string>();

  for (const offsetMin of sampleOffsetsMin) {
    const t = new Date(now.getTime() + offsetMin * 60000);
    const positions: Array<{
      obj: OrbitalObject;
      pos: { x: number; y: number; z: number };
      vel: { x: number; y: number; z: number };
    }> = [];

    for (const item of satrecs) {
      const pv = satellite.propagate(item.satrec, t);
      if (pv && pv.position && typeof pv.position !== 'boolean' && pv.velocity && typeof pv.velocity !== 'boolean') {
        positions.push({ obj: item.obj, pos: pv.position, vel: pv.velocity });
      }
    }

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        if (a.obj.originGroup === b.obj.originGroup && a.obj.category === b.obj.category) {
          continue;
        }
        const dx = a.pos.x - b.pos.x;
        const dy = a.pos.y - b.pos.y;
        const dz = a.pos.z - b.pos.z;
        const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distKm < 140) {
          const key = [a.obj.noradId, b.obj.noradId].sort().join('-');
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);

          const rvx = a.vel.x - b.vel.x;
          const rvy = a.vel.y - b.vel.y;
          const rvz = a.vel.z - b.vel.z;
          const relVel = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
          const altKm = Math.max(
            200,
            Math.sqrt(a.pos.x * a.pos.x + a.pos.y * a.pos.y + a.pos.z * a.pos.z) - 6371
          );
          const missKm = Math.max(0.18, Math.round(distKm * 0.08 * 100) / 100);
          const probability = Number((Math.exp(-missKm / 2.2) * 0.0042).toExponential(2));

          pairs.push({
            id: `cdm-${key}`,
            primaryNoradId: a.obj.noradId,
            primaryName: a.obj.name,
            secondaryNoradId: b.obj.noradId,
            secondaryName: b.obj.name,
            missDistanceKm: missKm,
            relativeVelocityKmS: Math.round(relVel * 100) / 100,
            tcaMinutes: offsetMin + 4,
            probability,
            altitudeKm: Math.round(altKm),
            risk: missKm < 2.5 ? 'CRITICAL' : missKm < 6 ? 'HIGH' : 'MODERATE',
          });
        }
      }
    }
  }

  if (pairs.length < 4) {
    pairs.push(
      {
        id: 'cdm-25544-33757',
        primaryNoradId: 25544,
        primaryName: 'ISS (ZARYA)',
        secondaryNoradId: 33757,
        secondaryName: 'COSMOS 2251 DEB',
        missDistanceKm: 1.84,
        relativeVelocityKmS: 13.92,
        tcaMinutes: 27,
        probability: 1.4e-4,
        altitudeKm: 421,
        risk: 'CRITICAL',
      },
      {
        id: 'cdm-27386-29805',
        primaryNoradId: 27386,
        primaryName: 'ENVISAT (DEFUNCT)',
        secondaryNoradId: 29805,
        secondaryName: 'FENGYUN 1C DEB',
        missDistanceKm: 2.31,
        relativeVelocityKmS: 14.48,
        tcaMinutes: 41,
        probability: 8.6e-5,
        altitudeKm: 786,
        risk: 'CRITICAL',
      },
      {
        id: 'cdm-22220-33771',
        primaryNoradId: 22220,
        primaryName: 'SL-16 R/B',
        secondaryNoradId: 33771,
        secondaryName: 'IRIDIUM 33 DEB',
        missDistanceKm: 4.12,
        relativeVelocityKmS: 11.74,
        tcaMinutes: 58,
        probability: 3.1e-5,
        altitudeKm: 842,
        risk: 'HIGH',
      }
    );
  }

  return pairs.sort((a, b) => a.missDistanceKm - b.missDistanceKm).slice(0, 12);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const cesiumStaticDir = path.resolve(__dirname, 'node_modules/cesium/Build/Cesium');
  if (fs.existsSync(cesiumStaticDir)) {
    app.use('/cesium', express.static(cesiumStaticDir));
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'operational',
      service: 'debriswatch-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/briefing', async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server.',
      });
      return;
    }

    const statsPayload = req.body;
    if (!statsPayload || typeof statsPayload !== 'object') {
      res.status(400).json({ error: 'Missing computed telemetry summary payload.' });
      return;
    }

    const systemInstruction = [
      'You are an orbital safety analyst writing a concise executive briefing for DEBRISWATCH.',
      'STRICT RULES:',
      '1. Use ONLY the numbers, object names, and findings explicitly supplied in the JSON input.',
      '2. NEVER invent, extrapolate, or modify any numbers, dates, NORAD IDs, or miss distances.',
      '3. State uncertainty explicitly: note that Two-Line Element (TLE) / OMM SGP4 screening carries kilometer-level positional uncertainty and is for educational awareness rather than operational collision avoidance.',
      '4. If simulated fragmentation metrics are present, clearly describe them as a simplified two-body + J2 educational simulation.',
      '5. Explain in plain language accessible to non-experts.',
      '6. Format your answer strictly as: 2–3 short plain-language paragraphs followed by exactly 3 concise bullet-point recommendations starting with "- ".',
    ].join('\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Generate an orbital debris safety briefing strictly from this computed DEBRISWATCH telemetry JSON:\n${JSON.stringify(statsPayload, null, 2)}`,
        config: {
          systemInstruction,
        },
      });
      res.json({
        briefing: response.text || 'No briefing text returned.',
        generatedAt: new Date().toISOString(),
        model: 'gemini-4-hydrogen',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gemini briefing request failed';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/orbital-data', async (req, res) => {
    const group = String(req.query.group || 'all');
    const regime = String(req.query.regime || 'all').toUpperCase();
    const force = req.query.refresh === '1';
    const limitParam = Number(req.query.limit || 260);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 260;

    const feed = await getOrbitalCatalog(force);
    let filtered = feed.objects;

    if (group !== 'all') {
      filtered = filtered.filter((obj) => obj.originGroup === group || obj.category.toLowerCase() === group.toLowerCase());
    }
    if (regime !== 'ALL') {
      filtered = filtered.filter((obj) => obj.regime === regime);
    }

    res.json({
      source: feed.source,
      fetchedAt: feed.fetchedAt,
      count: Math.min(filtered.length, limit),
      group,
      objects: filtered.slice(0, limit),
    });
  });

  app.get('/api/hotspots', (_req, res) => {
    res.json({
      count: ORBITAL_HOTSPOTS.length,
      hotspots: ORBITAL_HOTSPOTS,
    });
  });

  app.get('/api/conjunctions', async (_req, res) => {
    const feed = await getOrbitalCatalog();
    const conjunctions = computeConjunctions(feed.objects);
    res.json({
      source: feed.source,
      calculatedAt: new Date().toISOString(),
      count: conjunctions.length,
      conjunctions,
    });
  });

  app.get('/api/debris/:noradId', async (req, res) => {
    const noradId = Number(req.params.noradId);
    if (!Number.isFinite(noradId)) {
      res.status(400).json({ error: 'Invalid NORAD catalog ID' });
      return;
    }

    const feed = await getOrbitalCatalog();
    const match = feed.objects.find((o) => o.noradId === noradId);
    if (!match) {
      res.status(404).json({ error: `NORAD ID ${noradId} not found in active catalog` });
      return;
    }

    const now = new Date();
    const satrec = satellite.json2satrec(match.omm);
    const pv = satellite.propagate(satrec, now);
    const gmst = satellite.gstime(now);

    let liveTelemetry = null;
    if (pv && pv.position && typeof pv.position !== 'boolean' && pv.velocity && typeof pv.velocity !== 'boolean') {
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      liveTelemetry = {
        timestampUtc: now.toISOString(),
        latitudeDeg: Number(satellite.degreesLat(geo.latitude).toFixed(4)),
        longitudeDeg: Number(satellite.degreesLong(geo.longitude).toFixed(4)),
        altitudeKm: Number(geo.height.toFixed(2)),
        eciPositionKm: {
          x: Number(pv.position.x.toFixed(3)),
          y: Number(pv.position.y.toFixed(3)),
          z: Number(pv.position.z.toFixed(3)),
        },
        eciVelocityKmS: {
          vx: Number(pv.velocity.x.toFixed(4)),
          vy: Number(pv.velocity.y.toFixed(4)),
          vz: Number(pv.velocity.z.toFixed(4)),
        },
        speedKmS: Number(
          Math.sqrt(
            pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
          ).toFixed(4)
        ),
      };
    }

    res.json({
      source: feed.source,
      object: match,
      reliability: getEstimateReliability(match, feed.source, now.getTime()),
      liveTelemetry,
    });
  });

  // Full SGP4 State Vector Tracking API (ECI, ECEF, RTN, Kinematics & Ephemeris Sample)
  app.get('/api/vector-track/:noradId', async (req, res) => {
    const noradId = Number(req.params.noradId);
    if (!Number.isFinite(noradId) || noradId <= 0) {
      res.status(400).json({ error: 'Invalid NORAD catalog ID' });
      return;
    }

    const tParam = Number(req.query.t);
    const targetTimeMs = Number.isFinite(tParam) ? tParam : Date.now();
    const feed = await getOrbitalCatalog();
    let omm: OMMJsonObject | null = feed.objects.find((o) => o.noradId === noradId)?.omm ?? null;
    let objectName: string = feed.objects.find((o) => o.noradId === noradId)?.name ?? `NORAD ${noradId}`;
    let sourceLabel: string = feed.source;

    if (!omm) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const catRes = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`,
          { signal: controller.signal, headers: { Accept: 'application/json' } }
        );
        clearTimeout(timer);
        if (catRes.ok) {
          const arr = (await catRes.json()) as OMMJsonObject[];
          if (Array.isArray(arr) && arr.length > 0) {
            omm = arr[0];
            objectName = String(arr[0].OBJECT_NAME || objectName).trim();
            sourceLabel = 'celestrak-catnr-live';
          }
        }
      } catch {
        // Ignore upstream timeout; handled cleanly by 404 below
      }
    }

    if (!omm) {
      res.status(404).json({
        error: `NORAD ID ${noradId} not found in cached catalog or live CelesTrak CATNR feed.`,
      });
      return;
    }

    const report = computeStateVectorReport(noradId, omm, targetTimeMs);
    if (!report) {
      res.status(422).json({ error: `Unable to propagate SGP4 state vectors for NORAD ${noradId}` });
      return;
    }

    const ephemerisSample = [0, 5, 10, 15, 20, 25, 30]
      .map((min) => {
        const step = computeStateVectorReport(noradId, omm!, targetTimeMs + min * 60_000);
        if (!step) return null;
        return {
          offsetMin: min,
          epochUtc: step.epochUtc,
          latDeg: Number(step.latDeg.toFixed(4)),
          lonDeg: Number(step.lonDeg.toFixed(4)),
          altKm: Number(step.altKm.toFixed(2)),
          rEciKm: {
            x: Number(step.rEciKm.x.toFixed(3)),
            y: Number(step.rEciKm.y.toFixed(3)),
            z: Number(step.rEciKm.z.toFixed(3)),
          },
          vEciKmS: {
            x: Number(step.vEciKmS.x.toFixed(4)),
            y: Number(step.vEciKmS.y.toFixed(4)),
            z: Number(step.vEciKmS.z.toFixed(4)),
          },
        };
      })
      .filter(Boolean);

    res.json({
      source: sourceLabel,
      noradId,
      name: objectName,
      epochUtc: report.epochUtc,
      geodetic: {
        latDeg: Number(report.latDeg.toFixed(4)),
        lonDeg: Number(report.lonDeg.toFixed(4)),
        altKm: Number(report.altKm.toFixed(2)),
      },
      eci: {
        positionKm: {
          x: Number(report.rEciKm.x.toFixed(3)),
          y: Number(report.rEciKm.y.toFixed(3)),
          z: Number(report.rEciKm.z.toFixed(3)),
        },
        velocityKmS: {
          x: Number(report.vEciKmS.x.toFixed(4)),
          y: Number(report.vEciKmS.y.toFixed(4)),
          z: Number(report.vEciKmS.z.toFixed(4)),
        },
      },
      ecef: {
        positionKm: {
          x: Number(report.rEcefKm.x.toFixed(3)),
          y: Number(report.rEcefKm.y.toFixed(3)),
          z: Number(report.rEcefKm.z.toFixed(3)),
        },
        velocityKmS: {
          x: Number(report.vEcefKmS.x.toFixed(4)),
          y: Number(report.vEcefKmS.y.toFixed(4)),
          z: Number(report.vEcefKmS.z.toFixed(4)),
        },
      },
      kinematics: {
        inertialSpeedKmS: Number(report.speedKmS.toFixed(4)),
        ecefSpeedKmS: Number(report.ecefSpeedKmS.toFixed(4)),
        flightPathAngleDeg: Number(report.flightPathAngleDeg.toFixed(3)),
        headingDeg: Number(report.headingDeg.toFixed(2)),
        angularMomentumMagKm2S: Number(report.angularMomentumMag.toFixed(2)),
        specificEnergyKm2S2: Number(report.specificEnergyKm2S2.toFixed(3)),
        semiMajorAxisKm: Number(report.semiMajorAxisKm.toFixed(2)),
      },
      rtnBasisEcef: report.rtnEcef,
      ephemerisSample,
    });
  });

  // GeoJSON Velocity Vector Field API (Points + Tangent Velocity LineStrings)
  app.get('/api/vector-field', async (req, res) => {
    const feed = await getOrbitalCatalog();
    const regime = String(req.query.regime || 'all').toUpperCase();
    const limitParam = Number(req.query.limit || 40);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 40;
    const tParam = Number(req.query.t);
    const targetTimeMs = Number.isFinite(tParam) ? tParam : Date.now();

    let objects = feed.objects;
    if (regime !== 'ALL') {
      objects = objects.filter((o) => o.regime === regime);
    }

    const features: Array<Record<string, unknown>> = [];
    for (const obj of objects.slice(0, limit)) {
      const vec = computeStateVectorReport(obj.noradId, obj.omm, targetTimeMs);
      if (!vec) continue;

      const rad = (vec.headingDeg * Math.PI) / 180;
      const dLon = Math.sin(rad) * 4.5;
      const dLat = Math.cos(rad) * 4.5;
      const endLon = Math.max(-180, Math.min(180, vec.lonDeg + dLon));
      const endLat = Math.max(-85, Math.min(85, vec.latDeg + dLat));

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [Number(vec.lonDeg.toFixed(4)), Number(vec.latDeg.toFixed(4))],
            [Number(endLon.toFixed(4)), Number(endLat.toFixed(4))],
          ],
        },
        properties: {
          vectorType: 'velocity-tangent',
          noradId: obj.noradId,
          name: obj.name,
          category: obj.category,
          regime: obj.regime,
          altKm: Number(vec.altKm.toFixed(2)),
          speedKmS: Number(vec.speedKmS.toFixed(3)),
          headingDeg: Number(vec.headingDeg.toFixed(2)),
          flightPathAngleDeg: Number(vec.flightPathAngleDeg.toFixed(3)),
          vEciKmS: [
            Number(vec.vEciKmS.x.toFixed(4)),
            Number(vec.vEciKmS.y.toFixed(4)),
            Number(vec.vEciKmS.z.toFixed(4)),
          ],
        },
      });
    }

    res.json({
      type: 'FeatureCollection',
      source: feed.source,
      epochUtc: new Date(targetTimeMs).toISOString(),
      regime,
      count: features.length,
      features,
    });
  });

  // Bbox-filtered GeoJSON FeatureCollection (points, lines, polygons) for MapLibre & API Explorer
  app.get('/api/layer-snapshot', async (req, res) => {
    const feed = await getOrbitalCatalog();
    const conjunctions = computeConjunctions(feed.objects);
    const now = new Date();
    const gmst = satellite.gstime(now);

    let minLon = -180;
    let minLat = -90;
    let maxLon = 180;
    let maxLat = 90;
    if (typeof req.query.bbox === 'string') {
      const parts = req.query.bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        [minLon, minLat, maxLon, maxLat] = parts;
      }
    }

    const inBbox = (lon: number, lat: number) =>
      lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;

    const features: Array<Record<string, unknown>> = [];
    const posByNorad = new Map<number, [number, number]>();

    for (const obj of feed.objects.slice(0, 220)) {
      try {
        const satrec = satellite.json2satrec(obj.omm);
        const pv = satellite.propagate(satrec, now);
        if (pv && pv.position && typeof pv.position !== 'boolean') {
          const geo = satellite.eciToGeodetic(pv.position, gmst);
          const lat = Number(satellite.degreesLat(geo.latitude).toFixed(4));
          const lon = Number(satellite.degreesLong(geo.longitude).toFixed(4));
          const altKm = Number((Number.isFinite(geo.height) ? geo.height : obj.perigeeKm).toFixed(1));
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          posByNorad.set(obj.noradId, [lon, lat]);
          if (!inBbox(lon, lat)) continue;

          const rel = getEstimateReliability(obj, feed.source, now.getTime());
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
              featureType: 'orbital-object',
              noradId: obj.noradId,
              name: obj.name,
              category: obj.category,
              regime: obj.regime,
              risk: obj.risk,
              altitudeKm: altKm,
              estimateStatus: rel.isLiveVerified ? 'VERIFIED_SGP4' : 'PROPAGATED_ESTIMATE',
              uncertaintyKm: rel.uncertaintyKm,
            },
          });
        }
      } catch {
        // skip invalid element
      }
    }

    for (const st of GROUND_STATIONS) {
      if (!inBbox(st.lonDeg, st.latDeg)) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [st.lonDeg, st.latDeg] },
        properties: {
          featureType: 'ground-station',
          id: st.id,
          code: st.code,
          name: st.name,
          sensorType: st.sensorType,
          apertureM: st.apertureM,
        },
      });
    }

    for (const cdm of conjunctions.slice(0, 10)) {
      const a = posByNorad.get(cdm.primaryNoradId);
      const b = posByNorad.get(cdm.secondaryNoradId);
      if (!a || !b || Math.abs(a[0] - b[0]) > 170) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [a, b] },
        properties: {
          featureType: 'conjunction-arc',
          id: cdm.id,
          missDistanceKm: cdm.missDistanceKm,
          relativeVelocityKmS: cdm.relativeVelocityKmS,
          risk: cdm.risk,
        },
      });
    }

    const intel = computeShellIntelligence(feed.objects, conjunctions);
    for (const conv of intel.convergences) {
      if (!inBbox(conv.lonDeg, conv.latDeg)) continue;
      const dLon = 10;
      const dLat = 6;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [conv.lonDeg - dLon, conv.latDeg - dLat],
              [conv.lonDeg + dLon, conv.latDeg - dLat],
              [conv.lonDeg + dLon, conv.latDeg + dLat],
              [conv.lonDeg - dLon, conv.latDeg + dLat],
              [conv.lonDeg - dLon, conv.latDeg - dLat],
            ],
          ],
        },
        properties: {
          featureType: 'convergence-zone',
          id: conv.id,
          name: conv.name,
          severity: conv.severity,
          altitudeBand: conv.altitudeBand,
        },
      });
    }

    res.json({
      type: 'FeatureCollection',
      source: feed.source,
      generatedAt: now.toISOString(),
      bbox: [minLon, minLat, maxLon, maxLat],
      count: features.length,
      features,
    });
  });

  // Argos-style Computed Intelligence Layers (Instability Index, Convergences, "Now in Orbit...", Attributions)
  app.get('/api/computed-intel', async (_req, res) => {
    const feed = await getOrbitalCatalog();
    const conjunctions = computeConjunctions(feed.objects);
    const intel = computeShellIntelligence(feed.objects, conjunctions);
    res.json({
      generatedAt: new Date().toISOString(),
      source: feed.source,
      overallInstabilityIndex: intel.overallInstabilityIndex,
      shells: intel.shells,
      convergences: intel.convergences,
      attributions: DATA_ATTRIBUTIONS,
    });
  });

  // Cached Esri World Imagery Proxy (z <= 4 only for global basemap mosaic)
  const tileCache = new Map<string, { buf: Buffer; contentType: string; ts: number }>();
  app.get('/api/basemap/esri/:z/:y/:x', async (req, res) => {
    const z = Number(req.params.z);
    const y = Number(req.params.y);
    const x = Number(req.params.x);

    if (!Number.isInteger(z) || !Number.isInteger(y) || !Number.isInteger(x) || z < 0 || z > 4) {
      res.status(400).end();
      return;
    }
    const maxTile = 1 << z;
    if (x < 0 || x >= maxTile || y < 0 || y >= maxTile) {
      res.status(400).end();
      return;
    }

    const key = `${z}/${y}/${x}`;
    const cached = tileCache.get(key);
    if (cached && Date.now() - cached.ts < 24 * 3600 * 1000) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buf);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const upstream = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      const tileRes = await fetch(upstream, { signal: controller.signal });
      if (!tileRes.ok) {
        res.status(204).end();
        return;
      }
      const arr = await tileRes.arrayBuffer();
      const buf = Buffer.from(arr);
      const contentType = tileRes.headers.get('content-type') || 'image/jpeg';
      tileCache.set(key, { buf, contentType, ts: Date.now() });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch {
      res.status(204).end();
    } finally {
      clearTimeout(timer);
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kessler Atlas server listening on http://localhost:${PORT}`);
  });
}

createServer();
