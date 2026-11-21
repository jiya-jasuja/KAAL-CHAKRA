import { useMemo } from 'react';
import { Camera, Code2, Crosshair, Radio, X, ZoomIn } from 'lucide-react';
import { GROUND_STATIONS } from '../data/tleCatalog.ts';
import type { CompiledOrbitalObject, PropagatedState } from '../types/orbital.ts';
import {
  findNearestNeighbors,
  getEstimateReliability,
} from '../utils/orbitalMath.ts';

interface TargetTelemetrySheetProps {
  target: CompiledOrbitalObject;
  allObjects: CompiledOrbitalObject[];
  liveState: PropagatedState | null;
  dataSource: 'celestrak-live' | 'catalog-cache';
  simDate: Date;
  followSelected: boolean;
  onToggleFollow: () => void;
  onZoomCloser: () => void;
  onSelectNeighborObject: (noradId: number) => void;
  onSelectNeighborStation: (stationId: string) => void;
  onOpenOpticalCam: () => void;
  onInspectApi: () => void;
  onClose: () => void;
}

export function TargetTelemetrySheet({
  target,
  allObjects,
  liveState,
  dataSource,
  simDate,
  followSelected,
  onToggleFollow,
  onZoomCloser,
  onSelectNeighborObject,
  onSelectNeighborStation,
  onOpenOpticalCam,
  onInspectApi,
  onClose,
}: TargetTelemetrySheetProps) {
  const reliability = useMemo(
    () => getEstimateReliability(target, dataSource, simDate.getTime()),
    [target, dataSource, simDate]
  );

  const { neighborObjects, nearestStation } = useMemo(
    () => findNearestNeighbors(target, allObjects, GROUND_STATIONS, simDate),
    [target, allObjects, simDate]
  );

  return (
    <div className="bg-[#080C15]/95 border border-white/10 rounded-xl p-4 w-full max-w-[395px] text-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
            <span>NORAD {target.noradId}</span>
            <span aria-hidden="true">·</span>
            <span>{target.objectId}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                target.risk === 'CRITICAL'
                  ? 'text-rose-400'
                  : target.risk === 'HIGH'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }
            >
              {target.risk}
            </span>
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-white truncate">
            {target.name}
          </h3>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            <span className={reliability.isLiveVerified ? 'text-emerald-400' : 'text-amber-400'}>
              {reliability.label}
            </span>
            <span aria-hidden="true"> · </span>
            <span>±{reliability.uncertaintyKm} km</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
          aria-label="Clear target selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Calibrated Telemetry Grid */}
      <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-3 gap-3 font-mono tabular-nums">
        <div>
          <div className="text-[11px] text-slate-500">Altitude</div>
          <div className="text-sm font-semibold text-white">
            {liveState ? `${liveState.altKm.toFixed(1)}` : target.perigeeKm.toFixed(1)}
            <span className="text-[11px] font-normal text-slate-400 ml-1">km</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Velocity</div>
          <div className="text-sm font-semibold text-white">
            {liveState ? liveState.velocityKmS.toFixed(2) : '7.46'}
            <span className="text-[11px] font-normal text-slate-400 ml-1">km/s</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Inclination</div>
          <div className="text-sm font-semibold text-white">
            {target.inclinationDeg.toFixed(2)}
            <span className="text-[11px] font-normal text-slate-400 ml-0.5">°</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Latitude</div>
          <div className="text-xs text-slate-200">
            {liveState ? `${liveState.latDeg.toFixed(2)}°` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Longitude</div>
          <div className="text-xs text-slate-200">
            {liveState ? `${liveState.lonDeg.toFixed(2)}°` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Period</div>
          <div className="text-xs text-slate-200">{target.periodMin.toFixed(1)} min</div>
        </div>
      </div>

      {/* Neighbor Jump Links (Card-Everything UX) */}
      {(neighborObjects.length > 0 || nearestStation) && (
        <div className="mt-3 pt-2.5 border-t border-white/10">
          <div className="text-[11px] font-mono text-slate-500 mb-1.5">
            Nearby Orbital & Ground Links
          </div>
          <div className="flex flex-wrap gap-1.5">
            {neighborObjects.map((n) => (
              <button
                key={n.obj.noradId}
                type="button"
                onClick={() => onSelectNeighborObject(n.obj.noradId)}
                className="px-2 py-1 text-[11px] font-mono tabular-nums rounded-md border border-white/10 bg-[#05070C] text-slate-300 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors truncate max-w-[185px]"
                title={`Jump to ${n.obj.name} (${n.distanceKm} km separation)`}
              >
                {n.obj.name} · {n.distanceKm}km
              </button>
            ))}
            {nearestStation && (
              <button
                type="button"
                onClick={() => onSelectNeighborStation(nearestStation.station.id)}
                className="px-2 py-1 text-[11px] font-mono tabular-nums rounded-md border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors flex items-center gap-1"
                title={`Jump to ${nearestStation.station.name}`}
              >
                <Radio className="w-3 h-3 shrink-0" />
                {nearestStation.station.code} ({nearestStation.groundKm}km)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action Strip */}
      <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onZoomCloser}
          className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <ZoomIn className="w-3.5 h-3.5" />
          Zoom Closer
        </button>
        <button
          type="button"
          onClick={onToggleFollow}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            followSelected
              ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
              : 'border-white/10 bg-[#05070C] text-slate-300 hover:text-white'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          {followSelected ? 'Locked' : 'Follow'}
        </button>
        <button
          type="button"
          onClick={onOpenOpticalCam}
          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-[#05070C] text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          Optical Cam
        </button>
        <button
          type="button"
          onClick={onInspectApi}
          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-[#05070C] text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          <Code2 className="w-3.5 h-3.5" />
          API
        </button>
      </div>
    </div>
  );
}
