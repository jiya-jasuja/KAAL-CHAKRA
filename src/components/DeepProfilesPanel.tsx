import { useMemo, useState } from 'react';
import { Camera, Crosshair, Globe2, Layers, Radio, ShieldAlert, X } from 'lucide-react';
import { GROUND_STATIONS, ORBITAL_HOTSPOTS } from '../data/tleCatalog.ts';
import type {
  CompiledOrbitalObject,
  ConjunctionEvent,
  GroundStation,
  OrbitalHotspot,
} from '../types/orbital.ts';
import { computeShellIntelligence, DATA_ATTRIBUTIONS } from '../utils/orbitalMath.ts';

interface DeepProfilesPanelProps {
  objects: CompiledOrbitalObject[];
  conjunctions: ConjunctionEvent[];
  dataSource: 'celestrak-live' | 'catalog-cache';
  onZoomHotspot: (hotspot: OrbitalHotspot) => void;
  onZoomObject: (noradId: number) => void;
  onZoomStation: (station: GroundStation, openOptics?: boolean) => void;
  onClose: () => void;
}

type ProfileSection = 'intel' | 'posture' | 'stations' | 'incidents' | 'attributions';

export function DeepProfilesPanel({
  objects,
  conjunctions,
  dataSource,
  onZoomHotspot,
  onZoomObject,
  onZoomStation,
  onClose,
}: DeepProfilesPanelProps) {
  const [section, setSection] = useState<ProfileSection>('intel');

  const intel = useMemo(
    () => computeShellIntelligence(objects, conjunctions),
    [objects, conjunctions]
  );

  // Compute live altitude density buckets from tracked SGP4 objects
  const altitudeBuckets = useMemo(() => {
    const bins = [
      { label: '200–500 km', count: 0, danger: false },
      { label: '500–750 km', count: 0, danger: false },
      { label: '750–900 km', count: 0, danger: true },
      { label: '900–1400 km', count: 0, danger: false },
      { label: 'MEO', count: 0, danger: false },
      { label: 'GEO', count: 0, danger: false },
    ];

    for (const o of objects) {
      const avg = (o.perigeeKm + o.apogeeKm) * 0.5;
      if (o.regime === 'GEO') bins[5].count++;
      else if (o.regime === 'MEO' || avg > 2000) bins[4].count++;
      else if (avg < 500) bins[0].count++;
      else if (avg < 750) bins[1].count++;
      else if (avg <= 900) bins[2].count++;
      else bins[3].count++;
    }
    const maxCount = Math.max(1, ...bins.map((b) => b.count));
    return { bins, maxCount };
  }, [objects]);

  // Compute Argos Atlas-style Orbital Entity Posture Breakdown
  const actorPosture = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        total: number;
        fragments: number;
        rocketBodies: number;
        payloads: number;
        critical: number;
      }
    >();

    for (const o of objects) {
      const key = o.countryCode || 'INTL';
      const entry = map.get(key) ?? {
        code: key,
        total: 0,
        fragments: 0,
        rocketBodies: 0,
        payloads: 0,
        critical: 0,
      };
      entry.total += 1;
      if (o.category === 'FRAGMENTATION') entry.fragments += 1;
      else if (o.category === 'ROCKET_BODY') entry.rocketBodies += 1;
      else entry.payloads += 1;
      if (o.risk === 'CRITICAL') entry.critical += 1;
      map.set(key, entry);
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [objects]);

  return (
    <div className="w-full h-full flex flex-col bg-[#080C15] border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-[#0A0F1A]">
        <div className="flex items-center gap-3">
          <Globe2 className="w-4 h-4 text-cyan-400" />
          <h2 className="font-display text-sm font-semibold text-white">
            Orbital Atlas Intelligence Profiles
          </h2>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            Global Index {intel.overallInstabilityIndex}/100 · {objects.length} tracked
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white border border-white/10 rounded-lg bg-[#05070C] transition-colors"
          aria-label="Close Atlas Profiles"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/10 bg-[#070B13] overflow-x-auto">
        {(
          [
            { id: 'intel', label: 'Instability & Convergences' },
            { id: 'posture', label: 'Density & Attribution' },
            { id: 'stations', label: `Sensors (${GROUND_STATIONS.length})` },
            { id: 'incidents', label: `Dossiers (${ORBITAL_HOTSPOTS.length})` },
            { id: 'attributions', label: 'Sources & Licenses' },
          ] as Array<{ id: ProfileSection; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              section === t.id
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5 space-y-6">
        {section === 'intel' && (
          <>
            {/* Computed Orbital Instability Index (0-100) + "Now in Orbit..." Summaries */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-300">
                  Shell Instability Index (0–100)
                </h3>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {dataSource === 'celestrak-live'
                    ? 'CelesTrak GP · Live SGP4 Model'
                    : 'Catalog Propagated Estimate'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {intel.shells.map((sh) => (
                  <div
                    key={sh.id}
                    className="bg-[#05070C] border border-white/10 rounded-xl p-3.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white truncate">
                          {sh.label}
                        </span>
                        <span
                          className={`text-sm font-mono font-bold tabular-nums shrink-0 ${
                            sh.instabilityIndex >= 78
                              ? 'text-rose-400'
                              : sh.instabilityIndex >= 55
                                ? 'text-amber-400'
                                : 'text-cyan-300'
                          }`}
                        >
                          {sh.instabilityIndex}/100
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                        {sh.altitudeRange} · {sh.status} · {sh.objectCount} objects
                      </div>
                      <div className="mt-2 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            sh.instabilityIndex >= 78
                              ? 'bg-rose-500'
                              : sh.instabilityIndex >= 55
                                ? 'bg-amber-400'
                                : 'bg-cyan-400'
                          }`}
                          style={{ width: `${sh.instabilityIndex}%` }}
                        />
                      </div>
                      <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
                        {sh.summaryNow}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Convergences (3+ overlapping hazard classes) */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  Active Orbital Convergences (3+ Overlapping Risks)
                </h3>
                <span className="text-[11px] font-mono text-slate-500">
                  24h Nodal Window
                </span>
              </div>

              <div className="divide-y divide-white/10 bg-[#05070C] border border-white/10 rounded-xl overflow-hidden">
                {intel.convergences.map((conv) => (
                  <div
                    key={conv.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                        <span className="text-rose-400">SEVERITY {conv.severity}/100</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-slate-400">{conv.altitudeBand}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-slate-400">
                          {conv.latDeg.toFixed(1)}°, {conv.lonDeg.toFixed(1)}°
                        </span>
                      </div>
                      <h4 className="mt-1 font-display text-sm font-semibold text-white">
                        {conv.name}
                      </h4>
                      <div className="mt-1 text-[11px] font-mono text-cyan-300/90">
                        {conv.overlappingTypes.join(' · ')}
                      </div>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                        {conv.summary}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onZoomObject(conv.targetNoradId)}
                      className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 self-start sm:self-center whitespace-nowrap"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      Zoom Zone
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {section === 'posture' && (
          <>
            {/* Live Altitude Congestion Histogram */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-300">
                  Spatial Density by Altitude Shell
                </h3>
                <span className="text-[11px] font-mono text-rose-400">
                  750–900 km Kessler Peak
                </span>
              </div>

              <div className="space-y-2.5 bg-[#05070C] border border-white/10 rounded-xl p-4">
                {altitudeBuckets.bins.map((bin) => {
                  const pct = Math.round((bin.count / altitudeBuckets.maxCount) * 100);
                  return (
                    <div
                      key={bin.label}
                      className="grid grid-cols-[100px_1fr_44px] items-center gap-3 text-xs font-mono tabular-nums"
                    >
                      <span className="text-slate-400">{bin.label}</span>
                      <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            bin.danger ? 'bg-rose-500' : 'bg-cyan-400/80'
                          }`}
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                      <span className="text-right text-slate-200">{bin.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Orbital Entity / Country Debris Posture Table */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-300">
                  Orbital Debris Attribution by Entity
                </h3>
                <span className="text-[11px] font-mono text-slate-500">
                  Catalog Breakdown
                </span>
              </div>

              <div className="bg-[#05070C] border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500">
                      <th className="py-2.5 px-3 font-medium">Entity</th>
                      <th className="py-2.5 px-3 font-medium text-right">Total</th>
                      <th className="py-2.5 px-3 font-medium text-right">Frags</th>
                      <th className="py-2.5 px-3 font-medium text-right">R/B</th>
                      <th className="py-2.5 px-3 font-medium text-right">Payloads</th>
                      <th className="py-2.5 px-3 font-medium text-right">Critical</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-200">
                    {actorPosture.map((row) => (
                      <tr key={row.code} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3 font-semibold text-white">{row.code}</td>
                        <td className="py-2.5 px-3 text-right">{row.total}</td>
                        <td className="py-2.5 px-3 text-right text-rose-400">{row.fragments}</td>
                        <td className="py-2.5 px-3 text-right text-amber-400">{row.rocketBodies}</td>
                        <td className="py-2.5 px-3 text-right text-cyan-300">{row.payloads}</td>
                        <td className="py-2.5 px-3 text-right text-slate-300">{row.critical}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {section === 'stations' && (
          <div className="divide-y divide-white/10 bg-[#05070C] border border-white/10 rounded-xl overflow-hidden">
            {GROUND_STATIONS.map((st) => (
              <div
                key={st.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400 tabular-nums">
                    <Radio className="w-3.5 h-3.5 shrink-0" />
                    <span>{st.code}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400">{st.region}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400">{st.apertureM}m Aperture</span>
                  </div>
                  <h4 className="mt-1 font-display text-sm font-semibold text-white">
                    {st.name}
                  </h4>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    {st.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onZoomStation(st, false)}
                    className="px-3 py-1.5 text-xs font-medium border border-white/15 bg-[#080C15] text-slate-200 hover:text-white hover:border-cyan-400/50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    Zoom Site
                  </button>
                  <button
                    type="button"
                    onClick={() => onZoomStation(st, true)}
                    className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Optics
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {section === 'incidents' && (
          <div className="divide-y divide-white/10 bg-[#05070C] border border-white/10 rounded-xl overflow-hidden">
            {ORBITAL_HOTSPOTS.map((spot) => (
              <div
                key={spot.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-amber-400 tabular-nums">
                    {spot.subtitle} · {spot.estimatedFragments.toLocaleString()} est. fragments
                  </div>
                  <h4 className="mt-1 font-display text-sm font-semibold text-white">
                    {spot.name}
                  </h4>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    {spot.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onZoomHotspot(spot)}
                  className="px-3.5 py-2 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 self-start sm:self-center whitespace-nowrap"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  Fly & Zoom
                </button>
              </div>
            ))}
          </div>
        )}

        {section === 'attributions' && (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                Live Data Pipeline Cadences & Open-Data Licenses
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                Compliance Ledger
              </span>
            </div>
            <div className="divide-y divide-white/10 bg-[#05070C] border border-white/10 rounded-xl overflow-hidden">
              {DATA_ATTRIBUTIONS.map((item) => (
                <div key={item.layer} className="p-4 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">{item.layer}</span>
                    <span className="text-[11px] font-mono text-cyan-300">{item.license}</span>
                  </div>
                  <div className="text-xs text-slate-300">{item.source}</div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Cadence: {item.cadence} · {item.attribution}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
