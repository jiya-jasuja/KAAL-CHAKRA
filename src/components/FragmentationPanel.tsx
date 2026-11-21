import { Flame, Trash2 } from 'lucide-react';
import type {
  CatalogObject,
  FragmentationMode,
  FragmentationSummary,
} from '../types/debriswatch.ts';

interface FragmentationPanelProps {
  catalog: CatalogObject[];
  parentNoradId: number;
  fragmentCount: number;
  deltaVSigmaMS: number;
  mode: FragmentationMode;
  proximityThresholdKm: number;
  running: boolean;
  summary: FragmentationSummary | null;
  onChangeParent: (noradId: number) => void;
  onChangeCount: (count: number) => void;
  onChangeDeltaV: (dv: number) => void;
  onChangeMode: (mode: FragmentationMode) => void;
  onChangeProximityKm: (km: number) => void;
  onSimulate: () => void;
  onClearCloud: () => void;
}

export function FragmentationPanel({
  catalog,
  parentNoradId,
  fragmentCount,
  deltaVSigmaMS,
  mode,
  proximityThresholdKm,
  running,
  summary,
  onChangeParent,
  onChangeCount,
  onChangeDeltaV,
  onChangeMode,
  onChangeProximityKm,
  onSimulate,
  onClearCloud,
}: FragmentationPanelProps) {
  const priorityList = catalog.slice(0, 120);
  const currentParent = catalog.find((o) => o.noradId === parentNoradId);
  const dropdownList =
    currentParent && !priorityList.some((o) => o.noradId === parentNoradId)
      ? [currentParent, ...priorityList]
      : priorityList;

  const series = summary?.spreadSeries ?? [];
  const maxAlong = Math.max(100, ...series.map((s) => s.alongTrackSpreadKm));
  const maxAltSpread = Math.max(20, ...series.map((s) => s.altSpreadKm));

  const w = 290;
  const h = 110;
  const pad = 16;

  const alongPoints = series
    .map((pt, i) => {
      const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
      const y = h - pad - (pt.alongTrackSpreadKm / maxAlong) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const altPoints = series
    .map((pt, i) => {
      const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
      const y = h - pad - (pt.altSpreadKm / maxAltSpread) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="p-4 space-y-3.5 text-slate-200">
      {/* Mandatory SIMULATED badge */}
      <div className="px-2.5 py-2 rounded-lg border border-orange-400/40 bg-orange-500/15 text-[11px] font-mono text-orange-200 flex items-center justify-between gap-2">
        <span className="font-semibold">SIMULATED</span>
        <span className="text-orange-200/80">Simplified educational Two-Body + J2 model</span>
      </div>

      {/* Controls */}
      <div className="space-y-2.5 bg-[#04060B] border border-white/10 rounded-lg p-3">
        <div>
          <label htmlFor="frag-parent" className="block text-[10px] font-mono text-slate-400 mb-1">
            PARENT TARGET
          </label>
          <select
            id="frag-parent"
            value={parentNoradId}
            onChange={(e) => onChangeParent(Number(e.target.value))}
            className="w-full px-2.5 py-1.5 text-xs bg-[#080C15] border border-white/10 rounded-md text-white font-mono"
          >
            {dropdownList.map((o) => (
              <option key={o.noradId} value={o.noradId}>
                {o.name} ({o.noradId})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="frag-count" className="block text-[10px] font-mono text-slate-400 mb-1">
              FRAGMENTS ({fragmentCount})
            </label>
            <input
              id="frag-count"
              type="range"
              min={50}
              max={600}
              step={50}
              value={fragmentCount}
              onChange={(e) => onChangeCount(Number(e.target.value))}
              className="atlas-range w-full mt-1"
            />
          </div>
          <div>
            <label htmlFor="frag-dv" className="block text-[10px] font-mono text-slate-400 mb-1">
              ΔV 1σ ({deltaVSigmaMS} m/s)
            </label>
            <input
              id="frag-dv"
              type="range"
              min={10}
              max={200}
              step={10}
              value={deltaVSigmaMS}
              onChange={(e) => onChangeDeltaV(Number(e.target.value))}
              className="atlas-range w-full mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="text-[10px] font-mono text-slate-400 mb-1">DISPERSION MODE</div>
            <div className="grid grid-cols-2 gap-1 bg-[#080C15] border border-white/10 rounded-md p-0.5 text-[11px]">
              {(['isotropic', 'directional'] as FragmentationMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeMode(m)}
                  className={`py-1 rounded capitalize transition-colors ${
                    mode === m
                      ? 'bg-orange-500/25 text-orange-200 font-medium'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="frag-prox" className="block text-[10px] font-mono text-slate-400 mb-1">
              EXPOSURE RADIUS ({proximityThresholdKm} km)
            </label>
            <input
              id="frag-prox"
              type="range"
              min={15}
              max={150}
              step={15}
              value={proximityThresholdKm}
              onChange={(e) => onChangeProximityKm(Number(e.target.value))}
              className="atlas-range w-full mt-2"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onSimulate}
            disabled={running}
            className="flex-1 py-2 px-3 text-xs font-semibold bg-orange-500 text-slate-950 hover:bg-orange-400 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Flame className="w-3.5 h-3.5" />
            {running ? 'Simulating Cloud...' : 'Simulate Breakup'}
          </button>
          {summary && (
            <button
              type="button"
              onClick={onClearCloud}
              className="p-2 border border-white/10 bg-[#080C15] text-slate-400 hover:text-white rounded-lg"
              aria-label="Clear simulated breakup cloud"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Results & Spread Chart */}
      {summary && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 bg-[#04060B] border border-orange-400/20 rounded-lg p-3 font-mono tabular-nums">
            <div>
              <div className="text-[10px] text-slate-500">SIMULATED FRAGMENTS</div>
              <div className="text-base font-bold text-orange-300">{summary.fragmentCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">
                EXPOSED TRACKED (24h, &lt;{summary.proximityThresholdKm}km)
              </div>
              <div className="text-base font-bold text-red-400">
                {summary.trackedObjectsInProximity24h}
              </div>
            </div>
          </div>

          <div className="bg-[#04060B] border border-white/10 rounded-lg p-3">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-2">
              <span>CLOUD DISPERSION (0–4 ORBITS)</span>
              <span className="text-orange-300">
                Max Along-Track: {Math.round(maxAlong).toLocaleString()} km
              </span>
            </div>

            <svg
              viewBox={`0 0 ${w} ${h}`}
              className="w-full h-28 bg-[#020408] rounded border border-white/5"
            >
              <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(148,163,184,0.2)" />
              <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(148,163,184,0.2)" />
              {alongPoints && (
                <polyline
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="2"
                  points={alongPoints}
                />
              )}
              {altPoints && (
                <polyline
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                  points={altPoints}
                />
              )}
            </svg>
            <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span className="text-orange-300">— Along-track spread (km)</span>
              <span className="text-cyan-300">-- Altitude band ({maxAltSpread.toFixed(0)} km)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
