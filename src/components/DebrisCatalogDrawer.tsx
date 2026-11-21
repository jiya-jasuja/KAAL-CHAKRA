import { useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, Search, X } from 'lucide-react';
import type {
  CompiledOrbitalObject,
  ConjunctionEvent,
  DebrisCategory,
} from '../types/orbital.ts';

interface DebrisCatalogDrawerProps {
  objects: CompiledOrbitalObject[];
  conjunctions: ConjunctionEvent[];
  selectedId: number | null;
  dataSource: 'celestrak-live' | 'catalog-cache';
  onSelectObject: (noradId: number) => void;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<DebrisCategory, string> = {
  FRAGMENTATION: 'Fragmentation',
  ROCKET_BODY: 'Rocket Body',
  PAYLOAD: 'Payload',
  STATION: 'Station',
};

export function DebrisCatalogDrawer({
  objects,
  conjunctions,
  selectedId,
  dataSource,
  onSelectObject,
  onClose,
}: DebrisCatalogDrawerProps) {
  const [tab, setTab] = useState<'catalog' | 'conjunctions'>('catalog');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const filteredObjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return objects
      .filter((o) => {
        if (categoryFilter !== 'ALL' && o.category !== categoryFilter) return false;
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) ||
          String(o.noradId).includes(q) ||
          o.objectId.toLowerCase().includes(q)
        );
      })
      .slice(0, 80);
  }, [objects, query, categoryFilter]);

  return (
    <div className="w-full h-full flex flex-col bg-[#080C15] border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-[#0A0F1A]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === 'catalog'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tracked Catalog ({objects.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('conjunctions')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              tab === 'conjunctions'
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Conjunction Watch ({conjunctions.length})
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white border border-white/10 rounded-lg bg-[#05070C] transition-colors"
          aria-label="Close catalog drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {tab === 'catalog' ? (
        <>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-white/10 bg-[#070B13]">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search object name or NORAD ID..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#05070C] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-[#05070C] border border-white/10 rounded-lg text-slate-200"
              aria-label="Filter debris category"
            >
              <option value="ALL">All Types</option>
              <option value="FRAGMENTATION">Fragmentation</option>
              <option value="ROCKET_BODY">Rocket Bodies</option>
              <option value="PAYLOAD">Payloads</option>
              <option value="STATION">Stations</option>
            </select>
          </div>

          <div className="flex-1 overflow-auto divide-y divide-white/5">
            {filteredObjects.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No tracked objects match your filter.
              </div>
            ) : (
              filteredObjects.map((obj) => {
                const isSelected = obj.noradId === selectedId;
                return (
                  <button
                    key={obj.noradId}
                    type="button"
                    onClick={() => onSelectObject(obj.noradId)}
                    className={`w-full text-left px-5 py-3 transition-colors flex items-center justify-between gap-4 ${
                      isSelected ? 'bg-cyan-500/10' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">
                          {obj.name}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
                        <span>NORAD {obj.noradId}</span>
                        <span aria-hidden="true">·</span>
                        <span>{CATEGORY_LABEL[obj.category]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{obj.regime}</span>
                        <span aria-hidden="true">·</span>
                        <span className={dataSource === 'celestrak-live' ? 'text-emerald-400' : 'text-amber-400'}>
                          {dataSource === 'celestrak-live' ? 'Live GP' : 'Est.'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0 font-mono tabular-nums">
                      <div className="text-xs text-slate-200">
                        {obj.perigeeKm.toFixed(0)}–{obj.apogeeKm.toFixed(0)} km
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          obj.risk === 'CRITICAL'
                            ? 'text-rose-400'
                            : obj.risk === 'HIGH'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {obj.risk} · {obj.inclinationDeg.toFixed(1)}°
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto divide-y divide-white/5">
          {conjunctions.map((cdm) => (
            <div
              key={cdm.id}
              className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.02]"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {cdm.primaryName} <span className="text-slate-500">/</span> {cdm.secondaryName}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
                  <span
                    className={
                      cdm.risk === 'CRITICAL' ? 'text-rose-400' : 'text-amber-400'
                    }
                  >
                    {cdm.risk}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Miss {cdm.missDistanceKm.toFixed(2)} km</span>
                  <span aria-hidden="true">·</span>
                  <span>Rel {cdm.relativeVelocityKmS.toFixed(1)} km/s</span>
                  <span aria-hidden="true">·</span>
                  <span>TCA +{cdm.tcaMinutes} min</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelectObject(cdm.secondaryNoradId)}
                className="px-3 py-1.5 text-xs font-medium bg-[#05070C] border border-white/15 hover:border-cyan-400/50 text-cyan-300 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Zoom Target
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
