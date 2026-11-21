import { useMemo } from 'react';
import { Camera, Code2, Crosshair, Flame, Navigation, Radar, X } from 'lucide-react';
import type { CatalogObject, LiveTelemetrySnapshot } from '../types/debriswatch.ts';
import { computeStateVectorReport } from '../utils/orbitMath.ts';

interface ObjectCardProps {
  object: CatalogObject | null;
  telemetry: LiveTelemetrySnapshot | null;
  simTimeMs: number;
  onFocusCamera: (obj: CatalogObject) => void;
  onScreenConjunctions: (noradId: number) => void;
  onSimulateBreakup: (noradId: number) => void;
  onOpenOptics: (noradId: number) => void;
  onOpenVectorApi: (noradId: number) => void;
  onClearSelection: () => void;
}

export function ObjectCard({
  object,
  telemetry,
  simTimeMs,
  onFocusCamera,
  onScreenConjunctions,
  onSimulateBreakup,
  onOpenOptics,
  onOpenVectorApi,
  onClearSelection,
}: ObjectCardProps) {
  const vectorReport = useMemo(() => {
    if (!object) return null;
    return computeStateVectorReport(object.noradId, object.omm, simTimeMs);
  }, [object, simTimeMs]);

  if (!object) {
    return (
      <div className="p-4 text-xs text-slate-400 leading-relaxed">
        Click or hover any tracked point on the 3D Globe or 2D Vector Map, or search by name/NORAD
        ID on the left, to inspect live SGP4 state vectors (ECI r, v, ECEF, RTN) and draw its next
        full orbital track.
      </div>
    );
  }

  const classColor =
    object.objectClass === 'DEBRIS'
      ? 'text-red-400 border-red-400/30 bg-red-500/10'
      : object.objectClass === 'STATION'
        ? 'text-amber-300 border-amber-400/30 bg-amber-500/10'
        : object.objectClass === 'EO'
          ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10'
          : 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10';

  const statusChip =
    object.dataStatus === 'LIVE DATA'
      ? 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10'
      : object.dataStatus === 'CACHED DATA'
        ? 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10'
        : 'text-amber-300 border-amber-400/30 bg-amber-500/10';

  const epochAgeText =
    object.epochAgeHours >= 24
      ? `${Math.floor(object.epochAgeHours / 24)}d ${(object.epochAgeHours % 24).toFixed(0)}h`
      : `${object.epochAgeHours.toFixed(1)}h`;

  return (
    <div className="p-4 space-y-3 text-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${classColor}`}>
              {object.objectClass}
            </span>
            <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${statusChip}`}>
              {object.dataStatus}
            </span>
          </div>
          <h3 className="mt-1.5 font-display text-base font-semibold text-white truncate">
            {object.name}
          </h3>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            NORAD {object.noradId} · {object.objectId || object.group} · {object.altitudeBand}
          </div>
        </div>

        <button
          type="button"
          onClick={onClearSelection}
          className="p-1 text-slate-400 hover:text-white rounded-md"
          aria-label="Clear selected object"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Telemetry & Keplerian Grid */}
      <div className="grid grid-cols-2 gap-2.5 bg-[#04060B] border border-white/10 rounded-lg p-3 font-mono tabular-nums text-xs">
        <div>
          <div className="text-[10px] text-slate-500">ALTITUDE</div>
          <div className="text-sm font-semibold text-white">
            {telemetry ? telemetry.altKm.toFixed(1) : object.perigeeKm.toFixed(1)} km
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">INERTIAL SPEED</div>
          <div className="text-sm font-semibold text-white">
            {telemetry ? telemetry.speedKmS.toFixed(2) : vectorReport?.speedKmS.toFixed(2) ?? '7.48'} km/s
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">LAT / LON</div>
          <div className="text-slate-200">
            {telemetry
              ? `${telemetry.latDeg.toFixed(2)}°, ${telemetry.lonDeg.toFixed(2)}°`
              : vectorReport
                ? `${vectorReport.latDeg.toFixed(2)}°, ${vectorReport.lonDeg.toFixed(2)}°`
                : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">INCLINATION</div>
          <div className="text-slate-200">{object.inclinationDeg.toFixed(2)}°</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">PERIGEE / APOGEE</div>
          <div className="text-slate-200">
            {object.perigeeKm.toFixed(0)} / {object.apogeeKm.toFixed(0)} km
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">PERIOD</div>
          <div className="text-slate-200">{object.periodMin.toFixed(1)} min</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">TLE EPOCH</div>
          <div className="text-slate-300 truncate" title={object.epochIso}>
            {object.epochIso.slice(0, 16).replace('T', ' ')}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">EPOCH AGE</div>
          <div className="text-slate-300">{epochAgeText}</div>
        </div>
      </div>

      {/* State Vector Tracking Block (ECI / ECEF / Kinematics) */}
      {vectorReport && (
        <div className="bg-[#04060B] border border-cyan-400/20 rounded-lg p-3 font-mono tabular-nums text-[11px] space-y-2">
          <div className="flex items-center justify-between text-[10px] text-cyan-300">
            <span className="flex items-center gap-1 font-semibold">
              <Navigation className="w-3 h-3" />
              STATE VECTOR TRACKING (SGP4)
            </span>
            <span>HDG {vectorReport.headingDeg.toFixed(1)}°</span>
          </div>

          <div className="space-y-1 text-slate-300">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">r_ECI (km)</span>
              <span className="text-right">
                [{vectorReport.rEciKm.x.toFixed(1)}, {vectorReport.rEciKm.y.toFixed(1)},{' '}
                {vectorReport.rEciKm.z.toFixed(1)}]
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">v_ECI (km/s)</span>
              <span className="text-right text-cyan-200">
                [{vectorReport.vEciKmS.x.toFixed(3)}, {vectorReport.vEciKmS.y.toFixed(3)},{' '}
                {vectorReport.vEciKmS.z.toFixed(3)}]
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">v_ECEF (km/s)</span>
              <span className="text-right">
                [{vectorReport.vEcefKmS.x.toFixed(3)}, {vectorReport.vEcefKmS.y.toFixed(3)},{' '}
                {vectorReport.vEcefKmS.z.toFixed(3)}]
              </span>
            </div>
          </div>

          <div className="pt-1.5 border-t border-white/10 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-slate-500">FLIGHT PATH γ: </span>
              <span className="text-white">{vectorReport.flightPathAngleDeg.toFixed(2)}°</span>
            </div>
            <div className="text-right">
              <span className="text-slate-500">|h|: </span>
              <span className="text-white">{Math.round(vectorReport.angularMomentumMag).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onFocusCamera(object)}
          className="w-full py-2 px-3 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Crosshair className="w-3.5 h-3.5" />
          Zoom Camera to Object
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenOptics(object.noradId)}
            className="py-1.5 px-2.5 text-xs font-medium border border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            Optical Cam
          </button>
          <button
            type="button"
            onClick={() => onOpenVectorApi(object.noradId)}
            className="py-1.5 px-2.5 text-xs font-medium border border-white/15 bg-[#04060B] hover:border-cyan-400/50 text-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Code2 className="w-3.5 h-3.5 text-cyan-400" />
            Vector API
          </button>
          <button
            type="button"
            onClick={() => onScreenConjunctions(object.noradId)}
            className="py-1.5 px-2.5 text-xs font-medium border border-white/15 bg-[#04060B] hover:border-cyan-400/50 text-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Radar className="w-3.5 h-3.5 text-cyan-400" />
            Screen Risk
          </button>
          <button
            type="button"
            onClick={() => onSimulateBreakup(object.noradId)}
            className="py-1.5 px-2.5 text-xs font-medium border border-orange-400/30 bg-orange-500/10 hover:bg-orange-500/20 text-orange-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            Breakup Sim
          </button>
        </div>
      </div>
    </div>
  );
}
