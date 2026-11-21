import { useMemo } from 'react';
import * as satellite from 'satellite.js';
import { Camera, Radio, X, ZoomIn } from 'lucide-react';
import type { CompiledOrbitalObject, GroundStation } from '../types/orbital.ts';
import { haversineKm, propagateObjectAtDate } from '../utils/orbitalMath.ts';

interface GroundStationSheetProps {
  station: GroundStation;
  allObjects: CompiledOrbitalObject[];
  simDate: Date;
  onSelectObject: (noradId: number) => void;
  onZoomCloser: () => void;
  onOpenOptics: () => void;
  onClose: () => void;
}

export function GroundStationSheet({
  station,
  allObjects,
  simDate,
  onSelectObject,
  onZoomCloser,
  onOpenOptics,
  onClose,
}: GroundStationSheetProps) {
  const overheadTargets = useMemo(() => {
    const gmst = satellite.gstime(simDate);
    const list: Array<{ obj: CompiledOrbitalObject; rangeKm: number }> = [];
    for (const obj of allObjects) {
      const st = propagateObjectAtDate(obj, simDate, gmst);
      if (!st) continue;
      const dist = haversineKm(station.latDeg, station.lonDeg, st.latDeg, st.lonDeg);
      list.push({ obj, rangeKm: Math.round(dist) });
    }
    list.sort((a, b) => a.rangeKm - b.rangeKm);
    return list.slice(0, 3);
  }, [station, allObjects, simDate]);

  return (
    <div className="bg-[#080C15]/95 border border-white/10 rounded-xl p-4 w-full max-w-[395px] text-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 tabular-nums">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>{station.code}</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-400">{station.region}</span>
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-white truncate">
            {station.name}
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
          aria-label="Close ground station readout"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-400 leading-relaxed">
        {station.description}
      </p>

      <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-3 gap-3 font-mono tabular-nums">
        <div>
          <div className="text-[11px] text-slate-500">Coordinates</div>
          <div className="text-xs text-white">
            {station.latDeg.toFixed(2)}°, {station.lonDeg.toFixed(2)}°
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Aperture</div>
          <div className="text-xs text-white">{station.apertureM} m</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Elevation</div>
          <div className="text-xs text-white">{station.elevationM} m</div>
        </div>
      </div>

      {overheadTargets.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-white/10">
          <div className="text-[11px] font-mono text-slate-500 mb-1.5">
            Nearest Overhead Targets
          </div>
          <div className="flex flex-wrap gap-1.5">
            {overheadTargets.map((item) => (
              <button
                key={item.obj.noradId}
                type="button"
                onClick={() => onSelectObject(item.obj.noradId)}
                className="px-2 py-1 text-[11px] font-mono tabular-nums rounded-md border border-white/10 bg-[#05070C] text-slate-300 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors truncate max-w-[185px]"
              >
                {item.obj.name} · {item.rangeKm}km
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3.5 pt-3 border-t border-white/10 flex items-center gap-2">
        <button
          type="button"
          onClick={onZoomCloser}
          className="px-3 py-1.5 text-xs font-medium border border-white/15 bg-[#05070C] text-slate-200 hover:text-white rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
          Zoom Site
        </button>
        <button
          type="button"
          onClick={onOpenOptics}
          className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          Open Optical Feed
        </button>
      </div>
    </div>
  );
}
