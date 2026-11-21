import { useMemo, useState } from 'react';
import * as satellite from 'satellite.js';
import { BarChart3, Compass, PenTool, Sparkles } from 'lucide-react';
import type {
  AltitudeBand,
  BriefingPayload,
  CatalogObject,
  ConjunctionCandidate,
  DataStatus,
  FragmentationSummary,
  ObjectClass,
  OverflightPass,
  RegionBox,
} from '../types/debriswatch.ts';

interface StatsAndOverflightPanelProps {
  mode: 'stats' | 'overflight' | 'briefing';
  catalog: CatalogObject[];
  dataStatus: DataStatus;
  simTimeMs: number;
  conjunctions: ConjunctionCandidate[];
  fragmentationSummary: FragmentationSummary | null;
  regionBox: RegionBox;
  drawRegionMode: boolean;
  onChangeRegionBox: (box: RegionBox) => void;
  onToggleDrawRegion: () => void;
  onSelectObject: (noradId: number) => void;
}

const PRESET_REGIONS: RegionBox[] = [
  { name: 'Western Europe (Sentinel AOI)', minLat: 42, maxLat: 54, minLon: -5, maxLon: 16 },
  { name: 'California / Pacific Coast', minLat: 32, maxLat: 42, minLon: -125, maxLon: -114 },
  { name: 'East Asia / Japan', minLat: 30, maxLat: 42, minLon: 126, maxLon: 145 },
  { name: 'Amazon Basin (EO Deforestation)', minLat: -12, maxLat: 4, minLon: -72, maxLon: -50 },
];

export function StatsAndOverflightPanel({
  mode,
  catalog,
  dataStatus,
  simTimeMs,
  conjunctions,
  fragmentationSummary,
  regionBox,
  drawRegionMode,
  onChangeRegionBox,
  onToggleDrawRegion,
  onSelectObject,
}: StatsAndOverflightPanelProps) {
  const [eoPasses, setEoPasses] = useState<OverflightPass[]>([]);
  const [debrisPasses, setDebrisPasses] = useState<OverflightPass[]>([]);
  const [overflightComputedAt, setOverflightComputedAt] = useState<number | null>(null);

  const [briefingText, setBriefingText] = useState<string | null>(null);
  const [briefingMeta, setBriefingMeta] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const byClass: Record<ObjectClass, number> = {
      DEBRIS: 0,
      ACTIVE: 0,
      EO: 0,
      STATION: 0,
    };
    const byBand: Record<AltitudeBand, number> = { LEO: 0, MEO: 0, GEO: 0 };
    const shells = [
      { label: '200–500 km', min: 0, max: 500, count: 0 },
      { label: '500–700 km', min: 500, max: 700, count: 0 },
      { label: '700–900 km', min: 700, max: 900, count: 0 },
      { label: '900–1200 km', min: 900, max: 1200, count: 0 },
      { label: '1200–2000 km', min: 1200, max: 2000, count: 0 },
      { label: 'MEO / GEO', min: 2000, max: 100000, count: 0 },
    ];

    for (const o of catalog) {
      byClass[o.objectClass] += 1;
      byBand[o.altitudeBand] += 1;
      const avg = (o.perigeeKm + o.apogeeKm) * 0.5;
      const bucket = shells.find((s) => avg >= s.min && avg < s.max) ?? shells[shells.length - 1];
      if (o.objectClass === 'DEBRIS') {
        bucket.count += 1;
      }
    }

    const crowded = shells.reduce(
      (best, cur) => (cur.count > best.count ? cur : best),
      shells[0]
    );
    const maxShellCount = Math.max(1, ...shells.map((s) => s.count));

    return { byClass, byBand, shells, crowded, maxShellCount };
  }, [catalog]);

  // Compute 48-hour region overflight passes via satellite.ecfToLookAngles
  const computeOverflights = () => {
    const centerLatDeg = (regionBox.minLat + regionBox.maxLat) * 0.5;
    const centerLonDeg = (regionBox.minLon + regionBox.maxLon) * 0.5;
    const observerGd = {
      latitude: satellite.degreesToRadians(centerLatDeg),
      longitude: satellite.degreesToRadians(centerLonDeg),
      height: 0.1,
    };

    const eoObjects = catalog.filter((o) => o.objectClass === 'EO').slice(0, 60);
    const debrisObjects = catalog.filter((o) => o.objectClass === 'DEBRIS').slice(0, 85);
    const stepSec = 120; // 2-minute resolution across 48h
    const totalSteps = Math.floor((48 * 3600) / stepSec);

    const scanGroup = (subset: CatalogObject[]): OverflightPass[] => {
      const found: OverflightPass[] = [];
      for (const obj of subset) {
        let satrec: satellite.SatRec;
        try {
          satrec = satellite.json2satrec(obj.omm);
          if (!satrec || satrec.error !== 0) continue;
        } catch {
          continue;
        }

        let inPass = false;
        let aosMs = 0;
        let maxEl = 0;

        for (let s = 0; s <= totalSteps; s++) {
          const tMs = simTimeMs + s * stepSec * 1000;
          const d = new Date(tMs);
          const pv = satellite.propagate(satrec, d);
          if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
          const gmst = satellite.gstime(d);
          const ecf = satellite.eciToEcf(pv.position, gmst);
          const geo = satellite.eciToGeodetic(pv.position, gmst);
          const lat = satellite.degreesLat(geo.latitude);
          const lon = satellite.degreesLong(geo.longitude);
          const look = satellite.ecfToLookAngles(observerGd, ecf);
          const elDeg = satellite.radiansToDegrees(look.elevation);

          const insideBox =
            lat >= regionBox.minLat &&
            lat <= regionBox.maxLat &&
            lon >= regionBox.minLon &&
            lon <= regionBox.maxLon;
          const visible = (insideBox && elDeg > 5) || elDeg >= 18;

          if (visible) {
            if (!inPass) {
              inPass = true;
              aosMs = tMs;
              maxEl = elDeg;
            } else if (elDeg > maxEl) {
              maxEl = elDeg;
            }
          } else if (inPass) {
            inPass = false;
            found.push({
              noradId: obj.noradId,
              name: obj.name,
              objectClass: obj.objectClass,
              group: obj.group,
              aosUtcMs: aosMs,
              losUtcMs: tMs,
              durationSec: Math.max(stepSec, Math.round((tMs - aosMs) / 1000)),
              maxElevationDeg: Number(maxEl.toFixed(1)),
            });
            if (found.length >= 25) break;
          }
        }
      }
      return found.sort((a, b) => a.aosUtcMs - b.aosUtcMs).slice(0, 18);
    };

    setEoPasses(scanGroup(eoObjects));
    setDebrisPasses(scanGroup(debrisObjects));
    setOverflightComputedAt(simTimeMs);
  };

  // Generate AI Briefing via server-side Gemini API (/api/briefing)
  const handleGenerateBriefing = async () => {
    setBriefingLoading(true);
    setBriefingError(null);

    const payload: BriefingPayload = {
      simUtc: new Date(simTimeMs).toISOString(),
      dataStatus,
      totalTracked: catalog.length,
      countsByClass: stats.byClass,
      countsByBand: stats.byBand,
      mostCrowdedShell: {
        label: stats.crowded.label,
        count: stats.crowded.count,
      },
      topConjunctions: conjunctions.slice(0, 5).map((c) => ({
        primary: c.primaryName,
        secondary: c.secondaryName,
        tcaUtc: new Date(c.tcaUtcMs).toISOString(),
        missDistanceKm: c.missDistanceKm,
        relativeVelocityKmS: c.relativeVelocityKmS,
        risk: c.risk,
      })),
      fragmentation: fragmentationSummary,
      regionOverflight: overflightComputedAt
        ? {
            regionName: regionBox.name,
            eoPassCount48h: eoPasses.length,
            debrisPassCount48h: debrisPasses.length,
          }
        : null,
    };

    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setBriefingError(json.error || `Briefing failed (HTTP ${res.status})`);
      } else {
        setBriefingText(json.briefing || '');
        setBriefingMeta(`${json.model || 'gemini-4-hydrogen'} · ${new Date(json.generatedAt).toISOString().slice(11, 19)} UTC`);
      }
    } catch (err) {
      setBriefingError(err instanceof Error ? err.message : 'Network error calling /api/briefing');
    } finally {
      setBriefingLoading(false);
    }
  };

  if (mode === 'stats') {
    return (
      <div className="p-4 space-y-4 text-slate-200">
        {/* Crowded Shell Callout */}
        <div className="p-3 rounded-lg border border-red-400/30 bg-red-500/10 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono text-red-300">MOST CROWDED DEBRIS SHELL</div>
            <div className="text-sm font-display font-semibold text-white">
              {stats.crowded.label}
            </div>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-base font-bold text-red-400">{stats.crowded.count}</div>
            <div className="text-[10px] text-slate-400">tracked debris</div>
          </div>
        </div>

        {/* Counts by Class & Band */}
        <div className="grid grid-cols-2 gap-2.5 bg-[#04060B] border border-white/10 rounded-lg p-3 font-mono tabular-nums text-xs">
          <div>
            <div className="text-[10px] text-slate-500 mb-1">BY OBJECT TYPE</div>
            <div className="flex justify-between">
              <span className="text-red-400">Debris</span>
              <span>{stats.byClass.DEBRIS}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cyan-400">Active</span>
              <span>{stats.byClass.ACTIVE}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-400">Earth Obs</span>
              <span>{stats.byClass.EO}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-300">Stations</span>
              <span>{stats.byClass.STATION}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-1">BY ALTITUDE BAND</div>
            <div className="flex justify-between">
              <span className="text-slate-300">LEO (&lt;2000km)</span>
              <span>{stats.byBand.LEO}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">MEO</span>
              <span>{stats.byBand.MEO}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">GEO</span>
              <span>{stats.byBand.GEO}</span>
            </div>
            <div className="flex justify-between border-t border-white/10 mt-1 pt-1 text-white">
              <span>Total</span>
              <span>{catalog.length}</span>
            </div>
          </div>
        </div>

        {/* Debris Altitude Histogram */}
        <div className="bg-[#04060B] border border-white/10 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 mb-2.5">
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
            DEBRIS ALTITUDE HISTOGRAM
          </div>
          <div className="space-y-2">
            {stats.shells.map((sh) => {
              const pct = Math.round((sh.count / stats.maxShellCount) * 100);
              const isPeak = sh.label === stats.crowded.label;
              return (
                <div
                  key={sh.label}
                  className="grid grid-cols-[92px_1fr_38px] items-center gap-2 text-[11px] font-mono tabular-nums"
                >
                  <span className="text-slate-400 truncate">{sh.label}</span>
                  <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isPeak ? 'bg-red-500' : 'bg-cyan-400/75'}`}
                      style={{ width: `${Math.max(3, pct)}%` }}
                    />
                  </div>
                  <span className="text-right text-slate-200">{sh.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'overflight') {
    return (
      <div className="p-4 space-y-3.5 text-slate-200">
        <div className="bg-[#04060B] border border-white/10 rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-slate-400">REGION AOI (LAT / LON BOX)</span>
            <button
              type="button"
              onClick={onToggleDrawRegion}
              className={`px-2 py-1 text-[11px] font-medium rounded border flex items-center gap-1 transition-colors ${
                drawRegionMode
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-[#080C15] text-slate-300 hover:text-white'
              }`}
            >
              <PenTool className="w-3 h-3" />
              {drawRegionMode ? 'Click 2 Corners on Globe...' : 'Draw Box on Globe'}
            </button>
          </div>

          <select
            value={regionBox.name}
            onChange={(e) => {
              const found = PRESET_REGIONS.find((r) => r.name === e.target.value);
              if (found) onChangeRegionBox(found);
            }}
            className="w-full px-2.5 py-1.5 text-xs bg-[#080C15] border border-white/10 rounded-md text-white"
            aria-label="Choose region preset"
          >
            {PRESET_REGIONS.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
            {!PRESET_REGIONS.some((r) => r.name === regionBox.name) && (
              <option value={regionBox.name}>{regionBox.name}</option>
            )}
          </select>

          <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
            {(
              [
                { key: 'minLat', label: 'Min Lat' },
                { key: 'maxLat', label: 'Max Lat' },
                { key: 'minLon', label: 'Min Lon' },
                { key: 'maxLon', label: 'Max Lon' },
              ] as const
            ).map((f) => (
              <label key={f.key} className="block text-slate-400">
                {f.label}
                <input
                  type="number"
                  value={regionBox[f.key]}
                  onChange={(e) =>
                    onChangeRegionBox({
                      ...regionBox,
                      name: 'Custom Region',
                      [f.key]: Number(e.target.value),
                    })
                  }
                  className="mt-0.5 w-full px-1.5 py-1 bg-[#080C15] border border-white/10 rounded text-white tabular-nums"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={computeOverflights}
            className="w-full py-2 px-3 text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" />
            Compute 48h EO & Debris Overflights
          </button>
        </div>

        {/* EO Satellite Passes */}
        <div>
          <div className="text-[11px] font-mono text-emerald-300 mb-1.5">
            EARTH OBSERVATION PASSES ({eoPasses.length})
          </div>
          <div className="border border-white/10 rounded-lg bg-[#04060B] divide-y divide-white/5 max-h-40 overflow-y-auto text-[11px] font-mono tabular-nums">
            {eoPasses.length === 0 ? (
              <div className="p-3 text-slate-500 font-sans">
                Click Compute to predict upcoming 48h EO passes via ecfToLookAngles.
              </div>
            ) : (
              eoPasses.map((p, idx) => (
                <button
                  key={`${p.noradId}-${idx}`}
                  type="button"
                  onClick={() => onSelectObject(p.noradId)}
                  className="w-full px-2.5 py-1.5 text-left hover:bg-white/[0.04] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-white font-sans font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(p.aosUtcMs).toISOString().slice(11, 16)} UTC · {Math.round(p.durationSec / 60)}m
                    </div>
                  </div>
                  <span className="text-emerald-300 shrink-0">{p.maxElevationDeg}° el</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Debris Overflights */}
        <div>
          <div className="text-[11px] font-mono text-red-400 mb-1.5">
            DEBRIS CROSSING REGION ({debrisPasses.length})
          </div>
          <div className="border border-white/10 rounded-lg bg-[#04060B] divide-y divide-white/5 max-h-36 overflow-y-auto text-[11px] font-mono tabular-nums">
            {debrisPasses.length === 0 ? (
              <div className="p-3 text-slate-500 font-sans">
                No debris crossings computed yet.
              </div>
            ) : (
              debrisPasses.map((p, idx) => (
                <button
                  key={`${p.noradId}-d-${idx}`}
                  type="button"
                  onClick={() => onSelectObject(p.noradId)}
                  className="w-full px-2.5 py-1.5 text-left hover:bg-white/[0.04] flex items-center justify-between gap-2"
                >
                  <span className="text-slate-200 truncate font-sans">{p.name}</span>
                  <span className="text-red-400 shrink-0">
                    {new Date(p.aosUtcMs).toISOString().slice(11, 16)} UTC ({p.maxElevationDeg}°)
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // AI Briefing mode (Gemini)
  return (
    <div className="p-4 space-y-3.5 text-slate-200">
      <div className="p-3 rounded-lg border border-white/10 bg-[#04060B] text-xs text-slate-300 leading-relaxed">
        Sends only your computed DEBRISWATCH telemetry counts, top screened conjunctions, and
        fragmentation simulation metrics to Gemini for a plain-language orbital safety briefing.
      </div>

      <button
        type="button"
        onClick={handleGenerateBriefing}
        disabled={briefingLoading}
        className="w-full py-2.5 px-4 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <Sparkles className="w-4 h-4" />
        {briefingLoading ? 'Generating Briefing...' : 'Generate Briefing'}
      </button>

      {briefingError && (
        <div className="p-3 rounded-lg border border-red-400/40 bg-red-500/10 text-xs text-red-200">
          {briefingError}
        </div>
      )}

      {briefingText && (
        <div className="p-3.5 rounded-lg border border-white/10 bg-[#04060B] space-y-2.5">
          {briefingMeta && (
            <div className="text-[10px] font-mono text-cyan-300">{briefingMeta}</div>
          )}
          <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
            {briefingText}
          </div>
        </div>
      )}
    </div>
  );
}
