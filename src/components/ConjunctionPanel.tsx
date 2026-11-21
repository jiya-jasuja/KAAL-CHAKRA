import { AlertTriangle, Play } from 'lucide-react';
import type { CatalogObject, ConjunctionCandidate } from '../types/debriswatch.ts';

interface ConjunctionPanelProps {
  catalog: CatalogObject[];
  primaryNoradId: number;
  windowHours: number;
  thresholdKm: number;
  screening: boolean;
  progressPct: number;
  screenedStats: string;
  results: ConjunctionCandidate[];
  activeConjunctionId: string | null;
  onChangePrimary: (noradId: number) => void;
  onChangeWindowHours: (hours: number) => void;
  onChangeThresholdKm: (km: number) => void;
  onRunScreening: () => void;
  onSelectConjunction: (c: ConjunctionCandidate) => void;
}

export function ConjunctionPanel({
  catalog,
  primaryNoradId,
  windowHours,
  thresholdKm,
  screening,
  progressPct,
  screenedStats,
  results,
  activeConjunctionId,
  onChangePrimary,
  onChangeWindowHours,
  onChangeThresholdKm,
  onRunScreening,
  onSelectConjunction,
}: ConjunctionPanelProps) {
  const priorityList = catalog.slice(0, 120);
  const selectedInPriority = priorityList.some((o) => o.noradId === primaryNoradId);
  const currentPrimary = catalog.find((o) => o.noradId === primaryNoradId);
  const dropdownList =
    currentPrimary && !selectedInPriority ? [currentPrimary, ...priorityList] : priorityList;

  return (
    <div className="p-4 space-y-3.5 text-slate-200">
      <div className="p-2.5 rounded-lg border border-amber-400/25 bg-amber-500/10 text-[11px] text-amber-200/90 leading-relaxed flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <span>
          TLE-based SGP4 screening has kilometer-level positional uncertainty and is for education
          and awareness only — not operational collision avoidance.
        </span>
      </div>

      {/* Screening Controls */}
      <div className="space-y-2.5 bg-[#04060B] border border-white/10 rounded-lg p-3">
        <div>
          <label htmlFor="conj-primary" className="block text-[10px] font-mono text-slate-400 mb-1">
            PRIMARY OBJECT
          </label>
          <select
            id="conj-primary"
            value={primaryNoradId}
            onChange={(e) => onChangePrimary(Number(e.target.value))}
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
            <label htmlFor="conj-win" className="block text-[10px] font-mono text-slate-400 mb-1">
              WINDOW ({windowHours}h)
            </label>
            <select
              id="conj-win"
              value={windowHours}
              onChange={(e) => onChangeWindowHours(Number(e.target.value))}
              className="w-full px-2 py-1.5 text-xs bg-[#080C15] border border-white/10 rounded-md text-white font-mono"
            >
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
            </select>
          </div>
          <div>
            <label htmlFor="conj-thresh" className="block text-[10px] font-mono text-slate-400 mb-1">
              THRESHOLD ({thresholdKm} km)
            </label>
            <input
              id="conj-thresh"
              type="range"
              min={1}
              max={25}
              step={1}
              value={thresholdKm}
              onChange={(e) => onChangeThresholdKm(Number(e.target.value))}
              className="atlas-range w-full mt-2"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onRunScreening}
          disabled={screening}
          className="w-full py-2 px-3 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <Play className="w-3.5 h-3.5" />
          {screening ? `Screening (${progressPct}%)` : 'Run Conjunction Screening'}
        </button>

        {screening && (
          <div className="space-y-1">
            <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-slate-400 tabular-nums">
              {screenedStats}
            </div>
          </div>
        )}
      </div>

      {/* Results Table */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5">
          <span>CLOSE APPROACHES ({results.length})</span>
          <span>Click row to jump to TCA</span>
        </div>

        {results.length === 0 ? (
          <div className="p-4 border border-white/10 rounded-lg bg-[#04060B] text-xs text-slate-400 text-center">
            {screening
              ? 'Running two-stage SGP4 search...'
              : 'No conjunctions found within threshold, or run screening to scan active bands.'}
          </div>
        ) : (
          <div className="border border-white/10 rounded-lg bg-[#04060B] overflow-hidden">
            <table className="w-full text-left border-collapse text-[11px] font-mono tabular-nums">
              <thead>
                <tr className="border-b border-white/10 text-slate-500">
                  <th className="py-2 px-2">Secondary</th>
                  <th className="py-2 px-1.5 text-right">Miss</th>
                  <th className="py-2 px-1.5 text-right">RelV</th>
                  <th className="py-2 px-2 text-right">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {results.map((c) => {
                  const active = c.id === activeConjunctionId;
                  const riskCls =
                    c.risk === 'HIGH'
                      ? 'text-red-400'
                      : c.risk === 'MEDIUM'
                        ? 'text-amber-300'
                        : 'text-cyan-300';
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectConjunction(c)}
                      className={`cursor-pointer transition-colors ${
                        active ? 'bg-cyan-500/15' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <td className="py-2 px-2 max-w-[140px]">
                        <div className="text-slate-100 truncate font-sans font-medium">
                          {c.secondaryName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(c.tcaUtcMs).toISOString().slice(11, 19)} UTC
                        </div>
                      </td>
                      <td className="py-2 px-1.5 text-right text-white">
                        {c.missDistanceKm.toFixed(2)} km
                      </td>
                      <td className="py-2 px-1.5 text-right text-slate-300">
                        {c.relativeVelocityKmS.toFixed(1)}
                      </td>
                      <td className={`py-2 px-2 text-right font-semibold ${riskCls}`}>
                        {c.risk}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
