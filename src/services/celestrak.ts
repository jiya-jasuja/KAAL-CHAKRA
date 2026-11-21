import type { OMMJsonObject } from 'satellite.js';
import { getBundledSampleCatalog } from '../data/sampleCatalog.ts';
import {
  CELESTRAK_GROUPS,
  type AltitudeBand,
  type CatalogObject,
  type CelesTrakGroup,
  type DataStatus,
  type ObjectClass,
} from '../types/debriswatch.ts';
import { deriveOrbitalMetrics } from '../utils/orbitMath.ts';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours per CelesTrak fair-use policy
const CACHE_KEY_PREFIX = 'debriswatch_celestrak_v1_';

interface CachedGroupPayload {
  fetchedAtMs: number;
  ommList: OMMJsonObject[];
}

export interface CatalogLoadResult {
  objects: CatalogObject[];
  dataStatus: DataStatus;
  errorBanner: string | null;
  lastSyncedAtMs: number;
}

const EO_NAME_HINTS = [
  'SENTINEL',
  'LANDSAT',
  'TERRA',
  'AQUA',
  'ENVISAT',
  'SUOMI',
  'NOAA',
  'METOP',
  'RADARSAT',
  'ALOS',
  'SPOT',
  'WORLDVIEW',
  'PLEIADES',
  'ICESAT',
  'SWOT',
  'GRACE',
  'JASON',
  'GOES',
  'HIMAWARI',
  'METEOSAT',
  'MODIS',
  'VIIRS',
  'COPERNICUS',
];

export function classifyObject(
  name: string,
  group: CelesTrakGroup
): ObjectClass {
  const upper = name.toUpperCase();
  if (
    group === 'cosmos-1408-debris' ||
    group === 'fengyun-1c-debris' ||
    group === 'iridium-33-debris' ||
    group === 'cosmos-2251-debris' ||
    upper.includes(' DEB') ||
    upper.includes('R/B')
  ) {
    return 'DEBRIS';
  }
  if (group === 'stations' || upper.includes('ISS') || upper.includes('TIANHE') || upper.includes('CSS')) {
    return 'STATION';
  }
  if (
    group === 'resource' ||
    EO_NAME_HINTS.some((kw) => upper.includes(kw))
  ) {
    return 'EO';
  }
  return 'ACTIVE';
}

export function classifyAltitudeBand(perigeeKm: number, apogeeKm: number): AltitudeBand {
  const avg = (perigeeKm + apogeeKm) * 0.5;
  if (avg >= 33000) return 'GEO';
  if (avg >= 2000) return 'MEO';
  return 'LEO';
}

function compactOmm(raw: OMMJsonObject): OMMJsonObject {
  return {
    OBJECT_NAME: String(raw.OBJECT_NAME || 'UNKNOWN'),
    OBJECT_ID: String(raw.OBJECT_ID || ''),
    EPOCH: String(raw.EPOCH || ''),
    MEAN_MOTION: Number(raw.MEAN_MOTION),
    ECCENTRICITY: Number(raw.ECCENTRICITY),
    INCLINATION: Number(raw.INCLINATION),
    RA_OF_ASC_NODE: Number(raw.RA_OF_ASC_NODE),
    ARG_OF_PERICENTER: Number(raw.ARG_OF_PERICENTER),
    MEAN_ANOMALY: Number(raw.MEAN_ANOMALY),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: raw.CLASSIFICATION_TYPE === 'C' ? 'C' : 'U',
    NORAD_CAT_ID: Number(raw.NORAD_CAT_ID),
    ELEMENT_SET_NO: Number(raw.ELEMENT_SET_NO ?? 999),
    REV_AT_EPOCH: Number(raw.REV_AT_EPOCH ?? 1),
    BSTAR: Number(raw.BSTAR ?? 0),
    MEAN_MOTION_DOT: Number(raw.MEAN_MOTION_DOT ?? 0),
    MEAN_MOTION_DDOT: Number(raw.MEAN_MOTION_DDOT ?? 0),
  };
}

function toCatalogObject(
  omm: OMMJsonObject,
  group: CelesTrakGroup,
  dataStatus: DataStatus
): CatalogObject | null {
  const noradId = Number(omm.NORAD_CAT_ID);
  if (!Number.isFinite(noradId) || !omm.MEAN_MOTION || !omm.EPOCH) return null;

  const name = String(omm.OBJECT_NAME || `NORAD ${noradId}`).trim();
  const metrics = deriveOrbitalMetrics(omm);
  const objectClass = classifyObject(name, group);
  const altitudeBand = classifyAltitudeBand(metrics.perigeeKm, metrics.apogeeKm);

  return {
    noradId,
    name,
    objectId: String(omm.OBJECT_ID || ''),
    group,
    objectClass,
    altitudeBand,
    epochIso: String(omm.EPOCH),
    epochAgeHours: metrics.epochAgeHours,
    inclinationDeg: Number(Number(omm.INCLINATION || 0).toFixed(2)),
    periodMin: metrics.periodMin,
    apogeeKm: metrics.apogeeKm,
    perigeeKm: metrics.perigeeKm,
    eccentricity: Number(Number(omm.ECCENTRICITY || 0).toFixed(5)),
    omm,
    dataStatus,
  };
}

function readCachedGroup(group: CelesTrakGroup): CachedGroupPayload | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${group}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGroupPayload;
    if (!Array.isArray(parsed.ommList) || typeof parsed.fetchedAtMs !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedGroup(group: CelesTrakGroup, ommList: OMMJsonObject[], nowMs: number) {
  const maxStored = group === 'active' ? 3500 : 2500;
  const trimmed = ommList.slice(0, maxStored).map(compactOmm);
  try {
    localStorage.setItem(
      `${CACHE_KEY_PREFIX}${group}`,
      JSON.stringify({ fetchedAtMs: nowMs, ommList: trimmed })
    );
  } catch {
    // Retry with smaller slice if browser localStorage quota is tight
    try {
      localStorage.setItem(
        `${CACHE_KEY_PREFIX}${group}`,
        JSON.stringify({ fetchedAtMs: nowMs, ommList: trimmed.slice(0, 800) })
      );
    } catch {
      // Ignore storage quota failure gracefully
    }
  }
}

async function fetchCelesTrakGroupDirect(group: CelesTrakGroup): Promise<OMMJsonObject[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7500);
  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as OMMJsonObject[];
    if (!Array.isArray(json)) {
      throw new Error('Unexpected non-array OMM payload');
    }
    return json;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Loads all 8 CelesTrak OMM groups with strict 2-hour localStorage caching.
 * If network/CORS blocks live fetches and no cache exists, visibly reports an error banner
 * and falls back cleanly to the ~56-object bundled SAMPLE DATA dataset.
 */
export async function loadCelesTrakCatalog(forceRefresh = false): Promise<CatalogLoadResult> {
  const nowMs = Date.now();
  const byNorad = new Map<number, CatalogObject>();
  const failedGroups: string[] = [];
  let usedFreshLive = false;
  let usedCache = false;
  let oldestSyncMs = nowMs;

  await Promise.all(
    CELESTRAK_GROUPS.map(async (groupMeta) => {
      const group = groupMeta.id;
      const cached = readCachedGroup(group);
      const cacheFresh = cached && nowMs - cached.fetchedAtMs < CACHE_TTL_MS;

      if (!forceRefresh && cacheFresh && cached) {
        usedCache = true;
        oldestSyncMs = Math.min(oldestSyncMs, cached.fetchedAtMs);
        for (const omm of cached.ommList) {
          const item = toCatalogObject(omm, group, 'CACHED DATA');
          if (item && (!byNorad.has(item.noradId) || group !== 'active')) {
            byNorad.set(item.noradId, item);
          }
        }
        return;
      }

      try {
        const liveOmm = await fetchCelesTrakGroupDirect(group);
        writeCachedGroup(group, liveOmm, nowMs);
        usedFreshLive = true;
        const limit = group === 'active' ? 6000 : 4000;
        for (const omm of liveOmm.slice(0, limit)) {
          const item = toCatalogObject(compactOmm(omm), group, 'LIVE DATA');
          if (item && (!byNorad.has(item.noradId) || group !== 'active')) {
            byNorad.set(item.noradId, item);
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Network/CORS blocked';
        failedGroups.push(`${group} (${reason})`);

        if (cached && cached.ommList.length > 0) {
          usedCache = true;
          oldestSyncMs = Math.min(oldestSyncMs, cached.fetchedAtMs);
          for (const omm of cached.ommList) {
            const item = toCatalogObject(omm, group, 'CACHED DATA');
            if (item && (!byNorad.has(item.noradId) || group !== 'active')) {
              byNorad.set(item.noradId, item);
            }
          }
        }
      }
    })
  );

  // If live & cache yielded nothing, fall back cleanly to bundled ~56-object SAMPLE DATA
  if (byNorad.size === 0) {
    const sample = getBundledSampleCatalog();
    for (const rec of sample) {
      const item = toCatalogObject(rec.omm, rec.group, 'SAMPLE DATA');
      if (item) byNorad.set(item.noradId, item);
    }
    return {
      objects: Array.from(byNorad.values()),
      dataStatus: 'SAMPLE DATA',
      errorBanner:
        failedGroups.length > 0
          ? `CelesTrak fetch failed (${failedGroups.slice(0, 2).join(', ')}${failedGroups.length > 2 ? ` +${failedGroups.length - 2} more` : ''}). Displaying bundled SAMPLE DATA (${byNorad.size} objects).`
          : 'Displaying bundled SAMPLE DATA.',
      lastSyncedAtMs: nowMs,
    };
  }

  const errorBanner =
    failedGroups.length > 0
      ? `Partial CelesTrak failure on ${failedGroups.length} group(s) (${failedGroups[0]}). Using cached or available live groups.`
      : null;

  return {
    objects: Array.from(byNorad.values()),
    dataStatus: usedFreshLive ? 'LIVE DATA' : usedCache ? 'CACHED DATA' : 'SAMPLE DATA',
    errorBanner,
    lastSyncedAtMs: oldestSyncMs,
  };
}

export function getCacheAgeMinutes(): number | null {
  const cached = readCachedGroup('stations');
  if (!cached) return null;
  return Math.max(0, Math.round((Date.now() - cached.fetchedAtMs) / 60000));
}
