import { Layers, Search } from 'lucide-react';
import {
  CELESTRAK_GROUPS,
  type AltitudeBand,
  type BaseImageryMode,
  type CatalogObject,
  type CelesTrakGroup,
  type ObjectClass,
} from '../types/debriswatch.ts';

interface FilterPanelProps {
  catalog: CatalogObject[];
  enabledGroups: Record<CelesTrakGroup, boolean>;
  altitudeBand: AltitudeBand | 'ALL';
  searchQuery: string;
  imageryMode: BaseImageryMode;
  showDensityHeatmap: boolean;
  showVectorOverlay: boolean;
  onToggleGroup: (group: CelesTrakGroup) => void;
  onSetAllGroups: (enabled: boolean) => void;
  onSetAltitudeBand: (band: AltitudeBand | 'ALL') => void;
  onSetSearchQuery: (q: string) => void;
  onSetImageryMode: (mode: BaseImageryMode) => void;
  onToggleDensityHeatmap: () => void;
  onToggleVectorOverlay: () => void;
  onSelectObject: (noradId: number) => void;
}

const CLASS_DOT: Record<ObjectClass, string> = {
  DEBRIS: 'bg-red-500',
  ACTIVE: 'bg-cyan-400',
  EO: 'bg-emerald-400',
  STATION: 'bg-amber-400',
};

export function FilterPanel({
  catalog,
  enabledGroups,
  altitudeBand,
  searchQuery,
  imageryMode,
  showDensityHeatmap,
  showVectorOverlay,
  onToggleGroup,
  onSetAllGroups,
  onSetAltitudeBand,
  onSetSearchQuery,
  onSetImageryMode,
  onToggleDensityHeatmap,
  onToggleVectorOverlay,
  onSelectObject,
}: FilterPanelProps) {
  const groupCounts = catalog.reduce<Record<string, number>>((acc, o) => {
    acc[o.group] = (acc[o.group] || 0) + 1;
    return acc;
  }, {});

  const q = searchQuery.trim().toLowerCase();
  const quickMatches = q
    ? catalog
        .filter(
          (o) =>
            o.name.toLowerCase().includes(q) || String(o.noradId).includes(q)
        )
        .slice(0, 6)
    : [];

  return (
    <aside className="flex flex-col h-full bg-[#070B13]/92 border border-white/10 rounded-xl overflow-hidden text-slate-200">
      <div className="px-3.5 py-2.5 border-b border-white/10 bg-[#0A101D] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="font-display text-xs font-semibold tracking-wide text-white">
            LAYERS & FILTERS
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => onSetAllGroups(true)}
            className="text-cyan-400 hover:text-cyan-300"
          >
            All
          </button>
          <span className="text-slate-600">/</span>
          <button
            type="button"
            onClick={() => onSetAllGroups(false)}
            className="text-slate-400 hover:text-white"
          >
            None
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Search by Name or NORAD ID */}
        <div>
          <label htmlFor="dw-search" className="block text-[11px] font-mono text-slate-400 mb-1.5">
            SEARCH NAME OR NORAD ID
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              id="dw-search"
              type="text"
              value={searchQuery}
              onChange={(e) => onSetSearchQuery(e.target.value)}
              placeholder="e.g. ISS, 25544, SENTINEL..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#04060B] border border-white/10 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
            />
          </div>

          {quickMatches.length > 0 && (
            <div className="mt-1.5 border border-white/10 rounded-lg bg-[#04060B] divide-y divide-white/5 overflow-hidden">
              {quickMatches.map((m) => (
                <button
                  key={m.noradId}
                  type="button"
                  onClick={() => onSelectObject(m.noradId)}
                  className="w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-cyan-500/10 flex items-center justify-between gap-2"
                >
                  <span className="truncate text-slate-100">{m.name}</span>
                  <span className="font-mono text-slate-400 shrink-0 tabular-nums">
                    {m.noradId}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Altitude Band Segmented Filter */}
        <div>
          <div className="text-[11px] font-mono text-slate-400 mb-1.5">ALTITUDE BAND</div>
          <div className="grid grid-cols-4 gap-1 bg-[#04060B] border border-white/10 rounded-lg p-0.5 font-mono text-[11px]">
            {(['ALL', 'LEO', 'MEO', 'GEO'] as const).map((band) => (
              <button
                key={band}
                type="button"
                onClick={() => onSetAltitudeBand(band)}
                className={`py-1 rounded-md transition-colors ${
                  altitudeBand === band
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {band}
              </button>
            ))}
          </div>
        </div>

        {/* CelesTrak Catalog Groups */}
        <div>
          <div className="text-[11px] font-mono text-slate-400 mb-1.5">CELESTRAK CATALOGS</div>
          <div className="space-y-1">
            {CELESTRAK_GROUPS.map((g) => {
              const active = enabledGroups[g.id];
              const count = groupCounts[g.id] || 0;
              const dotClass = g.isDebris
                ? CLASS_DOT.DEBRIS
                : g.id === 'stations'
                  ? CLASS_DOT.STATION
                  : g.id === 'resource'
                    ? CLASS_DOT.EO
                    : CLASS_DOT.ACTIVE;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onToggleGroup(g.id)}
                  className={`w-full px-2.5 py-1.5 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors ${
                    active
                      ? 'border-white/15 bg-[#0C1322] text-white'
                      : 'border-white/5 bg-[#04060B] text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        active ? dotClass : 'bg-slate-700'
                      }`}
                    />
                    <span className="truncate">{g.label}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Legend */}
        <div className="pt-2 border-t border-white/10">
          <div className="text-[11px] font-mono text-slate-400 mb-1.5">POINT LEGEND</div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Debris
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" /> Active
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Earth Obs
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Station
            </div>
            <div className="flex items-center gap-1.5 col-span-2">
              <span className="w-2 h-2 rounded-full bg-orange-400" /> Simulated Breakup Cloud
            </div>
          </div>
        </div>

        {/* Globe Base Imagery (No Ion Token) & Density Overlay */}
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-[11px] font-mono text-slate-400">BASE IMAGERY (NO ION TOKEN)</div>
          <div className="grid grid-cols-3 gap-1 bg-[#04060B] border border-white/10 rounded-lg p-0.5 text-[11px]">
            {(
              [
                { id: 'gibs-blue-marble', label: 'GIBS' },
                { id: 'osm-dark', label: 'OSM Dark' },
                { id: 'gibs-night', label: 'Night' },
              ] as Array<{ id: BaseImageryMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSetImageryMode(opt.id)}
                className={`py-1 rounded-md transition-colors ${
                  imageryMode === opt.id
                    ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleDensityHeatmap}
            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border transition-colors text-left flex items-center justify-between ${
              showDensityHeatmap
                ? 'border-red-400/50 bg-red-500/15 text-red-200'
                : 'border-white/10 bg-[#04060B] text-slate-400 hover:text-white'
            }`}
          >
            <span>800 km Kessler Shell Grid</span>
            <span className="font-mono text-[10px]">{showDensityHeatmap ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleVectorOverlay}
            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border transition-colors text-left flex items-center justify-between ${
              showVectorOverlay
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                : 'border-white/10 bg-[#04060B] text-slate-400 hover:text-white'
            }`}
          >
            <span>Velocity Vectors &amp; RTN Triad</span>
            <span className="font-mono text-[10px]">{showVectorOverlay ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
