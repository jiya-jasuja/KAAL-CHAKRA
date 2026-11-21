/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as satellite from 'satellite.js';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  Code2,
  Compass,
  Flame,
  Globe2,
  Info,
  Map as MapIcon,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radar,
  RefreshCw,
  RotateCcw,
  Satellite,
  Sparkles,
  X,
} from 'lucide-react';
import { AboutModal } from './components/AboutModal.tsx';
import { ApiInspectorDrawer } from './components/ApiInspectorDrawer.tsx';
import type { CameraTargetRequest } from './components/CesiumGlobe.tsx';
import { ConjunctionPanel } from './components/ConjunctionPanel.tsx';
import { FilterPanel } from './components/FilterPanel.tsx';
import { FragmentationPanel } from './components/FragmentationPanel.tsx';
import { ObjectCard } from './components/ObjectCard.tsx';
import { OpticalCameraView } from './components/OpticalCameraView.tsx';
import { StatsAndOverflightPanel } from './components/StatsAndOverflightPanel.tsx';
import { TimeControlsBar } from './components/TimeControlsBar.tsx';
import { getCacheAgeMinutes, loadCelesTrakCatalog } from './services/celestrak.ts';
import {
  CELESTRAK_GROUPS,
  type AltitudeBand,
  type BaseImageryMode,
  type CatalogObject,
  type CelesTrakGroup,
  type ConjunctionCandidate,
  type DataStatus,
  type FragmentationMode,
  type FragmentationSummary,
  type LiveTelemetrySnapshot,
  type RegionBox,
} from './types/debriswatch.ts';
import { EARTH_OMEGA_RAD_S } from './utils/orbitMath.ts';

const CesiumGlobe = lazy(() => import('./components/CesiumGlobe.tsx'));
const VectorMap2D = lazy(() => import('./components/VectorMap2D.tsx'));

type RightTab = 'object' | 'conjunctions' | 'breakup' | 'stats' | 'overflight' | 'briefing';

const DEFAULT_ENABLED_GROUPS: Record<CelesTrakGroup, boolean> = CELESTRAK_GROUPS.reduce(
  (acc, g) => {
    acc[g.id] = true;
    return acc;
  },
  {} as Record<CelesTrakGroup, boolean>
);

const DEFAULT_REGION: RegionBox = {
  name: 'Western Europe (Sentinel AOI)',
  minLat: 42,
  maxLat: 54,
  minLon: -5,
  maxLon: 16,
};

function computeSingleTelemetry(obj: CatalogObject, timeMs: number): LiveTelemetrySnapshot | null {
  try {
    const satrec = satellite.json2satrec(obj.omm);
    if (!satrec || satrec.error !== 0) return null;
    const d = new Date(timeMs);
    const pv = satellite.propagate(satrec, d);
    if (
      !pv ||
      !pv.position ||
      typeof pv.position === 'boolean' ||
      !pv.velocity ||
      typeof pv.velocity === 'boolean'
    ) {
      return null;
    }
    const gmst = satellite.gstime(d);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const vRot = satellite.eciToEcf(pv.velocity, gmst);
    const vxEcefKmS = vRot.x + EARTH_OMEGA_RAD_S * ecf.y;
    const vyEcefKmS = vRot.y - EARTH_OMEGA_RAD_S * ecf.x;
    const vzEcefKmS = vRot.z;
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const latDeg = satellite.degreesLat(geo.latitude);
    const lonDeg = satellite.degreesLong(geo.longitude);
    const altKm = Number.isFinite(geo.height) ? geo.height : obj.perigeeKm;
    const speedKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
    return {
      noradId: obj.noradId,
      ecefX: ecf.x * 1000,
      ecefY: ecf.y * 1000,
      ecefZ: ecf.z * 1000,
      latDeg,
      lonDeg,
      altKm,
      speedKmS,
      vxEcefKmS,
      vyEcefKmS,
      vzEcefKmS,
    };
  } catch {
    return null;
  }
}

export default function App() {
  // Catalog & data status
  const [catalog, setCatalog] = useState<CatalogObject[]>([]);
  const [dataStatus, setDataStatus] = useState<DataStatus>('CACHED DATA');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [cacheAgeMin, setCacheAgeMin] = useState<number | null>(null);

  // Filters & visual layers
  const [enabledGroups, setEnabledGroups] = useState<Record<CelesTrakGroup, boolean>>(
    DEFAULT_ENABLED_GROUPS
  );
  const [altitudeBand, setAltitudeBand] = useState<AltitudeBand | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [imageryMode, setImageryMode] = useState<BaseImageryMode>('gibs-blue-marble');
  const [showDensityHeatmap, setShowDensityHeatmap] = useState(false);
  const [showVectorOverlay, setShowVectorOverlay] = useState(true);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');

  // Layout panels & overlays
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('stats');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [opticsOpen, setOpticsOpen] = useState(false);
  const [opticsFullscreen, setOpticsFullscreen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);

  // Simulation clock
  const [baseRealTimeMs, setBaseRealTimeMs] = useState<number>(() => Date.now());
  const [simTimeMs, setSimTimeMs] = useState<number>(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(100);

  const simTimeRef = useRef<number>(simTimeMs);
  const baseTimeRef = useRef<number>(baseRealTimeMs);
  const pausedRef = useRef<boolean>(paused);
  const speedRef = useRef<number>(speedMultiplier);

  baseTimeRef.current = baseRealTimeMs;
  pausedRef.current = paused;
  speedRef.current = speedMultiplier;

  // Selection & camera
  const [selectedNoradId, setSelectedNoradId] = useState<number | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<{
    obj: CatalogObject;
    telemetry: LiveTelemetrySnapshot | null;
    x: number;
    y: number;
  } | null>(null);
  const [flyRequest, setFlyRequest] = useState<CameraTargetRequest | null>(null);
  const [resetViewNonce, setResetViewNonce] = useState(0);

  // Mutable high-frequency position buffers shared with CesiumGlobe preRender
  const positionsRef = useRef<Float32Array | null>(null);
  const noradIndexMapRef = useRef<Map<number, number>>(new Map());
  const fragmentPositionsRef = useRef<Float32Array | null>(null);
  const [fragmentVersion, setFragmentVersion] = useState(0);

  // Workers
  const propWorkerRef = useRef<Worker | null>(null);
  const propBusyRef = useRef<boolean>(false);
  const conjWorkerRef = useRef<Worker | null>(null);
  const conjRunIdRef = useRef<number>(0);
  const fragWorkerRef = useRef<Worker | null>(null);
  const fragRunIdRef = useRef<number>(0);
  const fragBusyRef = useRef<boolean>(false);
  const hasActiveCloudRef = useRef<boolean>(false);

  // Conjunction screening state
  const [conjPrimaryId, setConjPrimaryId] = useState<number>(25544);
  const [conjWindowHours, setConjWindowHours] = useState<number>(24);
  const [conjThresholdKm, setConjThresholdKm] = useState<number>(10);
  const [conjScreening, setConjScreening] = useState<boolean>(false);
  const [conjProgress, setConjProgress] = useState<number>(0);
  const [conjStatsText, setConjStatsText] = useState<string>('');
  const [conjResults, setConjResults] = useState<ConjunctionCandidate[]>([]);
  const [activeConjunction, setActiveConjunction] = useState<ConjunctionCandidate | null>(null);

  // Fragmentation simulator state
  const [fragParentId, setFragParentId] = useState<number>(25544);
  const [fragCount, setFragCount] = useState<number>(200);
  const [fragDeltaV, setFragDeltaV] = useState<number>(50);
  const [fragMode, setFragMode] = useState<FragmentationMode>('isotropic');
  const [fragProxKm, setFragProxKm] = useState<number>(50);
  const [fragRunning, setFragRunning] = useState<boolean>(false);
  const [fragSummary, setFragSummary] = useState<FragmentationSummary | null>(null);

  // Region overflight state
  const [regionBox, setRegionBox] = useState<RegionBox>(DEFAULT_REGION);
  const [drawRegionMode, setDrawRegionMode] = useState<boolean>(false);

  // Initialize the 3 dedicated Web Workers once
  useEffect(() => {
    const propWorker = new Worker(new URL('./workers/propagation.worker.ts', import.meta.url), {
      type: 'module',
    });
    const conjWorker = new Worker(new URL('./workers/conjunction.worker.ts', import.meta.url), {
      type: 'module',
    });
    const fragWorker = new Worker(new URL('./workers/fragmentation.worker.ts', import.meta.url), {
      type: 'module',
    });

    propWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        const idxMap = new Map<number, number>();
        const ids = msg.noradIds as number[];
        for (let i = 0; i < ids.length; i++) {
          idxMap.set(ids[i], i);
        }
        noradIndexMapRef.current = idxMap;
        propBusyRef.current = false;
        propWorker.postMessage({ type: 'step', simTimeMs: simTimeRef.current });
      } else if (msg.type === 'positions') {
        positionsRef.current = new Float32Array(msg.buffer as ArrayBuffer);
        propBusyRef.current = false;
      }
    };

    conjWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.runId !== conjRunIdRef.current) return;
      if (msg.type === 'progress') {
        setConjProgress(msg.progress);
        setConjStatsText(
          `Screened ${msg.screenedCount} / ${msg.candidateCount} band-filtered objects`
        );
      } else if (msg.type === 'result') {
        setConjResults(msg.results);
        setConjProgress(100);
        setConjScreening(false);
        setConjStatsText(`Completed scan across ${msg.candidateCount} band-filtered pairs`);
      } else if (msg.type === 'error') {
        setConjScreening(false);
        setErrorBanner(msg.message || 'Conjunction worker error.');
      }
    };

    fragWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'simulated') {
        if (msg.runId !== fragRunIdRef.current) return;
        setFragSummary(msg.summary);
        setFragRunning(false);
        hasActiveCloudRef.current = true;
        fragBusyRef.current = false;
        fragWorker.postMessage({ type: 'step', simTimeMs: simTimeRef.current });
      } else if (msg.type === 'cloud') {
        const prevLen = fragmentPositionsRef.current?.length ?? 0;
        const nextBuf = new Float32Array(msg.buffer as ArrayBuffer);
        fragmentPositionsRef.current = nextBuf;
        fragBusyRef.current = false;
        if (nextBuf.length !== prevLen) {
          setFragmentVersion((v) => v + 1);
        }
      } else if (msg.type === 'error') {
        setFragRunning(false);
        setErrorBanner(msg.message || 'Fragmentation simulation error.');
      }
    };

    propWorkerRef.current = propWorker;
    conjWorkerRef.current = conjWorker;
    fragWorkerRef.current = fragWorker;

    return () => {
      propWorker.terminate();
      conjWorker.terminate();
      fragWorker.terminate();
      propWorkerRef.current = null;
      conjWorkerRef.current = null;
      fragWorkerRef.current = null;
    };
  }, []);

  // Load CelesTrak catalog (2-hour localStorage cache + SAMPLE DATA fallback)
  const loadCatalog = useCallback(async (forceRefresh = false) => {
    setLoadingCatalog(true);
    const result = await loadCelesTrakCatalog(forceRefresh);
    setCatalog(result.objects);
    setDataStatus(result.dataStatus);
    setErrorBanner(result.errorBanner);
    setCacheAgeMin(getCacheAgeMinutes());
    setLoadingCatalog(false);

    if (result.objects.length > 0) {
      const hasIss = result.objects.some((o) => o.noradId === 25544);
      const defaultId = hasIss ? 25544 : result.objects[0].noradId;
      setConjPrimaryId((prev) =>
        result.objects.some((o) => o.noradId === prev) ? prev : defaultId
      );
      setFragParentId((prev) =>
        result.objects.some((o) => o.noradId === prev) ? prev : defaultId
      );
    }

    if (propWorkerRef.current) {
      propBusyRef.current = true;
      propWorkerRef.current.postMessage({
        type: 'init',
        records: result.objects.map((o) => ({ noradId: o.noradId, omm: o.omm })),
      });
    }
  }, []);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  // Continuous SGP4 & Fragmentation simulation loop
  useEffect(() => {
    let rafId = 0;
    let lastFrameMs = performance.now();
    let lastUiSyncMs = 0;

    const tick = (nowPerf: number) => {
      const dtMs = Math.min(100, Math.max(0, nowPerf - lastFrameMs));
      lastFrameMs = nowPerf;

      if (!pausedRef.current) {
        const minMs = baseTimeRef.current - 48 * 3600_000;
        const maxMs = baseTimeRef.current + 48 * 3600_000;
        let nextSim = simTimeRef.current + dtMs * speedRef.current;
        if (nextSim > maxMs) nextSim = minMs;
        if (nextSim < minMs) nextSim = maxMs;
        simTimeRef.current = nextSim;

        if (propWorkerRef.current && !propBusyRef.current) {
          propBusyRef.current = true;
          propWorkerRef.current.postMessage({ type: 'step', simTimeMs: nextSim });
        }
        if (fragWorkerRef.current && hasActiveCloudRef.current && !fragBusyRef.current) {
          fragBusyRef.current = true;
          fragWorkerRef.current.postMessage({ type: 'step', simTimeMs: nextSim });
        }
        if (nowPerf - lastUiSyncMs >= 100) {
          lastUiSyncMs = nowPerf;
          setSimTimeMs(nextSim);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Push immediate worker step when user scrubs or jumps to TCA
  const jumpToSimTime = useCallback((targetMs: number) => {
    const minMs = baseTimeRef.current - 48 * 3600_000;
    const maxMs = baseTimeRef.current + 48 * 3600_000;
    const clamped = Math.max(minMs, Math.min(maxMs, targetMs));
    simTimeRef.current = clamped;
    setSimTimeMs(clamped);

    if (propWorkerRef.current) {
      propBusyRef.current = true;
      propWorkerRef.current.postMessage({ type: 'step', simTimeMs: clamped });
    }
    if (fragWorkerRef.current && hasActiveCloudRef.current) {
      fragBusyRef.current = true;
      fragWorkerRef.current.postMessage({ type: 'step', simTimeMs: clamped });
    }
  }, []);

  // Keyboard shortcuts: Space (play/pause), Left/Right arrows (scrub time), Esc (exit draw / modal)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const stepMs = (e.shiftKey ? 3600 : 900) * 1000;
        jumpToSimTime(simTimeRef.current - stepMs);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const stepMs = (e.shiftKey ? 3600 : 900) * 1000;
        jumpToSimTime(simTimeRef.current + stepMs);
      } else if (e.code === 'Escape') {
        setDrawRegionMode(false);
        setAboutOpen(false);
        setOpticsOpen(false);
        setOpticsFullscreen(false);
        setApiOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jumpToSimTime]);

  // Visible NORAD set after applying group toggles, altitude band, and search filter
  const visibleNoradIds = useMemo(() => {
    const set = new Set<number>();
    const q = searchQuery.trim().toLowerCase();
    for (const obj of catalog) {
      if (!enabledGroups[obj.group]) continue;
      if (altitudeBand !== 'ALL' && obj.altitudeBand !== altitudeBand) continue;
      if (
        q &&
        !obj.name.toLowerCase().includes(q) &&
        !String(obj.noradId).includes(q)
      ) {
        continue;
      }
      set.add(obj.noradId);
    }
    return set;
  }, [catalog, enabledGroups, altitudeBand, searchQuery]);

  const selectedObject = useMemo(
    () => catalog.find((o) => o.noradId === selectedNoradId) ?? null,
    [catalog, selectedNoradId]
  );

  const selectedTelemetry = useMemo((): LiveTelemetrySnapshot | null => {
    if (!selectedObject) return null;
    const idx = noradIndexMapRef.current.get(selectedObject.noradId);
    const buf = positionsRef.current;
    if (idx !== undefined && buf && idx * 10 + 9 < buf.length) {
      const base = idx * 10;
      if (Number.isFinite(buf[base])) {
        return {
          noradId: selectedObject.noradId,
          ecefX: buf[base],
          ecefY: buf[base + 1],
          ecefZ: buf[base + 2],
          latDeg: buf[base + 3],
          lonDeg: buf[base + 4],
          altKm: buf[base + 5],
          speedKmS: buf[base + 6],
          vxEcefKmS: buf[base + 7],
          vyEcefKmS: buf[base + 8],
          vzEcefKmS: buf[base + 9],
        };
      }
    }
    return computeSingleTelemetry(selectedObject, simTimeMs);
  }, [selectedObject, simTimeMs]);

  const focusCameraOnObject = useCallback(
    (obj: CatalogObject, targetTimeMs?: number) => {
      const tMs = targetTimeMs ?? simTimeRef.current;
      const snap = computeSingleTelemetry(obj, tMs);
      if (snap) {
        setFlyRequest({
          noradId: obj.noradId,
          latDeg: snap.latDeg,
          lonDeg: snap.lonDeg,
          altKm: snap.altKm,
          nonce: Date.now(),
        });
      }
    },
    []
  );

  const handleSelectObject = useCallback(
    (noradId: number | null) => {
      setSelectedNoradId(noradId);
      setActiveConjunction(null);
      if (noradId !== null) {
        setRightOpen(true);
        setRightTab('object');
        const found = catalog.find((o) => o.noradId === noradId);
        if (found) focusCameraOnObject(found);
      }
    },
    [catalog, focusCameraOnObject]
  );

  const handleRunConjunctionScreening = useCallback(
    (overridePrimaryId?: number) => {
      if (!conjWorkerRef.current || catalog.length === 0) return;
      const targetId = overridePrimaryId ?? conjPrimaryId;
      const runId = ++conjRunIdRef.current;
      setConjPrimaryId(targetId);
      setConjScreening(true);
      setConjProgress(0);
      setConjStatsText('Filtering orbital altitude bands...');
      setActiveConjunction(null);
      setRightOpen(true);
      setRightTab('conjunctions');

      conjWorkerRef.current.postMessage({
        type: 'screen',
        runId,
        primaryNoradId: targetId,
        startTimeMs: simTimeRef.current,
        windowHours: conjWindowHours,
        thresholdKm: conjThresholdKm,
        objects: catalog.map((o) => ({
          noradId: o.noradId,
          name: o.name,
          objectClass: o.objectClass,
          perigeeKm: o.perigeeKm,
          apogeeKm: o.apogeeKm,
          omm: o.omm,
        })),
      });
    },
    [catalog, conjPrimaryId, conjThresholdKm, conjWindowHours]
  );

  const handleSelectConjunction = useCallback(
    (c: ConjunctionCandidate) => {
      setPaused(true);
      jumpToSimTime(c.tcaUtcMs);
      setSelectedNoradId(c.primaryNoradId);
      setActiveConjunction(c);
      const primaryObj = catalog.find((o) => o.noradId === c.primaryNoradId);
      if (primaryObj) {
        focusCameraOnObject(primaryObj, c.tcaUtcMs);
      }
    },
    [catalog, focusCameraOnObject, jumpToSimTime]
  );

  const handleSimulateBreakup = useCallback(
    (overrideParentId?: number) => {
      if (!fragWorkerRef.current || catalog.length === 0) return;
      const targetId = overrideParentId ?? fragParentId;
      const parent = catalog.find((o) => o.noradId === targetId);
      if (!parent) return;

      const runId = ++fragRunIdRef.current;
      setFragParentId(targetId);
      setFragRunning(true);
      setSelectedNoradId(targetId);
      setRightOpen(true);
      setRightTab('breakup');
      focusCameraOnObject(parent, simTimeRef.current);

      fragWorkerRef.current.postMessage({
        type: 'simulate',
        runId,
        parentNoradId: parent.noradId,
        parentName: parent.name,
        parentOmm: parent.omm,
        breakupTimeMs: simTimeRef.current,
        fragmentCount: fragCount,
        deltaVSigmaMS: fragDeltaV,
        mode: fragMode,
        proximityThresholdKm: fragProxKm,
        trackedRecords: catalog.slice(0, 1800).map((o) => ({
          noradId: o.noradId,
          perigeeKm: o.perigeeKm,
          apogeeKm: o.apogeeKm,
          omm: o.omm,
        })),
      });
    },
    [catalog, focusCameraOnObject, fragCount, fragDeltaV, fragMode, fragParentId, fragProxKm]
  );

  const handleClearBreakupCloud = useCallback(() => {
    hasActiveCloudRef.current = false;
    fragmentPositionsRef.current = new Float32Array(0);
    setFragSummary(null);
    setFragmentVersion((v) => v + 1);
  }, []);

  const statusChipClass =
    dataStatus === 'LIVE DATA'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
      : dataStatus === 'CACHED DATA'
        ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300'
        : 'border-amber-400/45 bg-amber-500/15 text-amber-300';

  const tabs: Array<{ id: RightTab; label: string; icon: typeof Satellite }> = [
    { id: 'object', label: 'Object', icon: Satellite },
    { id: 'conjunctions', label: 'Screen', icon: Radar },
    { id: 'breakup', label: 'Breakup', icon: Flame },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
    { id: 'overflight', label: 'Region', icon: Compass },
    { id: 'briefing', label: 'Briefing', icon: Sparkles },
  ];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#03050a] text-slate-100 select-none">
      {/* Full-Screen Lazy-Loaded 3D CesiumJS Globe or 2D MapLibre Vector Map */}
      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#03050a] gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <div className="font-mono text-xs text-slate-400">
                {viewMode === '3d'
                  ? 'Initializing CesiumJS 3D Globe...'
                  : 'Initializing 2D Vector Map...'}
              </div>
            </div>
          }
        >
          {viewMode === '3d' ? (
            <CesiumGlobe
              catalog={catalog}
              visibleNoradIds={visibleNoradIds}
              positionsRef={positionsRef}
              noradIndexMapRef={noradIndexMapRef}
              fragmentPositionsRef={fragmentPositionsRef}
              fragmentVersion={fragmentVersion}
              selectedObject={selectedObject}
              activeConjunction={activeConjunction}
              simTimeMs={simTimeMs}
              imageryMode={imageryMode}
              showDensityHeatmap={showDensityHeatmap}
              showVectorOverlay={showVectorOverlay}
              regionBox={rightTab === 'overflight' || drawRegionMode ? regionBox : null}
              drawRegionMode={drawRegionMode}
              flyRequest={flyRequest}
              resetViewNonce={resetViewNonce}
              onSelectObject={handleSelectObject}
              onHoverObject={setHoveredInfo}
              onRegionDrawn={(box) => {
                setRegionBox(box);
                setDrawRegionMode(false);
              }}
            />
          ) : (
            <VectorMap2D
              catalog={catalog}
              visibleNoradIds={visibleNoradIds}
              positionsRef={positionsRef}
              noradIndexMapRef={noradIndexMapRef}
              selectedObject={selectedObject}
              activeConjunction={activeConjunction}
              simTimeMs={simTimeMs}
              imageryMode={imageryMode}
              showVectorOverlay={showVectorOverlay}
              regionBox={rightTab === 'overflight' || drawRegionMode ? regionBox : null}
              drawRegionMode={drawRegionMode}
              flyRequest={flyRequest}
              resetViewNonce={resetViewNonce}
              onSelectObject={handleSelectObject}
              onRegionDrawn={(box) => {
                setRegionBox(box);
                setDrawRegionMode(false);
              }}
            />
          )}
        </Suspense>
      </div>

      {/* Top Mission Header Bar */}
      <header className="pointer-events-none absolute top-3 left-3 right-3 z-30 flex flex-col gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[#070B13]/92 border border-white/10 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setLeftOpen((o) => !o)}
              className="p-1.5 rounded-lg border border-white/10 bg-[#04060B] text-slate-300 hover:text-white shrink-0"
              aria-label="Toggle layer filters panel"
            >
              {leftOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <Globe2 className="w-5 h-5 text-cyan-400 shrink-0" />
              <span className="font-display text-sm sm:text-base font-bold tracking-wider text-white whitespace-nowrap">
                DEBRISWATCH
              </span>
              <span className="hidden md:inline text-xs text-slate-400 truncate">
                Orbital Debris &amp; Conjunction Simulator
              </span>
            </div>

            <span
              className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border whitespace-nowrap shrink-0 ${statusChipClass}`}
            >
              {dataStatus}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
            <span className="hidden xl:inline text-slate-300 whitespace-nowrap">
              {visibleNoradIds.size.toLocaleString()} / {catalog.length.toLocaleString()}
              {cacheAgeMin !== null ? ` · ${cacheAgeMin}m` : ''}
            </span>

            {/* 3D Globe / 2D Vector Map Toggle */}
            <div className="flex items-center bg-[#04060B] border border-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('3d')}
                className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-colors ${
                  viewMode === '3d'
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe2 className="w-3.5 h-3.5" />
                <span>3D</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('2d')}
                className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-colors ${
                  viewMode === '2d'
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>2D Vector</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowVectorOverlay((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                showVectorOverlay
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-[#04060B] text-slate-300 hover:text-white'
              }`}
              title="Toggle live 3D/2D velocity & RTN vector overlay"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Vectors</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setApiOpen(false);
                setOpticsOpen((v) => !v);
              }}
              className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                opticsOpen
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-[#04060B] text-slate-300 hover:text-white'
              }`}
              title="Open Zoomable Optical Chase Camera & Live Camera"
            >
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Optics</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOpticsOpen(false);
                setApiOpen((v) => !v);
              }}
              className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                apiOpen
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-[#04060B] text-slate-300 hover:text-white'
              }`}
              title="Open Live Vector Tracking & Telemetry REST/GeoJSON API Explorer"
            >
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">API</span>
            </button>

            <button
              type="button"
              onClick={() => loadCatalog(true)}
              disabled={loadingCatalog}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#04060B] text-slate-200 hover:text-white hover:border-cyan-400/40 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
              title="Refresh CelesTrak OMM catalogs (2h cache recommended)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalog ? 'animate-spin' : ''}`} />
              <span className="hidden lg:inline">{loadingCatalog ? 'Syncing...' : 'Sync'}</span>
            </button>

            <button
              type="button"
              onClick={() => setResetViewNonce((n) => n + 1)}
              className="p-1.5 rounded-lg border border-white/10 bg-[#04060B] text-slate-300 hover:text-white shrink-0"
              title="Reset globe camera"
              aria-label="Reset camera view"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#04060B] text-slate-300 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">Docs</span>
            </button>

            <button
              type="button"
              onClick={() => setRightOpen((o) => !o)}
              className="p-1.5 rounded-lg border border-white/10 bg-[#04060B] text-slate-300 hover:text-white shrink-0"
              aria-label="Toggle telemetry and analysis drawer"
            >
              {rightOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Visible Error Banner when CelesTrak fetch fails / SAMPLE DATA active */}
        {errorBanner && (
          <div className="pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg border border-red-400/45 bg-red-950/85 text-xs text-red-100 backdrop-blur-md">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="truncate">{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-1 text-red-200 hover:text-white shrink-0"
              aria-label="Dismiss error banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Region Drawing Prompt Banner */}
        {drawRegionMode && (
          <div className="pointer-events-auto self-center px-4 py-1.5 rounded-lg border border-emerald-400/50 bg-emerald-950/90 text-xs font-mono text-emerald-200">
            Click two opposite corners on the 3D Earth to define your overflight region box (Esc to
            cancel)
          </div>
        )}
      </header>

      {/* Left Filter & Catalog Panel */}
      {leftOpen && (
        <div
          className={`pointer-events-auto absolute left-3 z-20 w-72 bottom-24 ${
            errorBanner ? 'top-28' : 'top-16'
          }`}
        >
          <FilterPanel
            catalog={catalog}
            enabledGroups={enabledGroups}
            altitudeBand={altitudeBand}
            searchQuery={searchQuery}
            imageryMode={imageryMode}
            showDensityHeatmap={showDensityHeatmap}
            showVectorOverlay={showVectorOverlay}
            onToggleGroup={(g) =>
              setEnabledGroups((prev) => ({ ...prev, [g]: !prev[g] }))
            }
            onSetAllGroups={(enabled) =>
              setEnabledGroups(
                CELESTRAK_GROUPS.reduce(
                  (acc, g) => {
                    acc[g.id] = enabled;
                    return acc;
                  },
                  {} as Record<CelesTrakGroup, boolean>
                )
              )
            }
            onSetAltitudeBand={setAltitudeBand}
            onSetSearchQuery={setSearchQuery}
            onSetImageryMode={setImageryMode}
            onToggleDensityHeatmap={() => setShowDensityHeatmap((v) => !v)}
            onToggleVectorOverlay={() => setShowVectorOverlay((v) => !v)}
            onSelectObject={(noradId) => handleSelectObject(noradId)}
          />
        </div>
      )}

      {/* Right Mission Inspector Drawer */}
      {rightOpen && (
        <aside
          className={`pointer-events-auto absolute right-3 z-20 w-[340px] sm:w-[368px] bottom-24 flex flex-col bg-[#070B13]/92 border border-white/10 rounded-xl overflow-hidden backdrop-blur-md ${
            errorBanner ? 'top-28' : 'top-16'
          }`}
        >
          <nav
            className="grid grid-cols-6 border-b border-white/10 bg-[#0A101D] shrink-0"
            aria-label="Analysis tools"
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = rightTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setRightTab(t.id)}
                  className={`py-2 px-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors border-b-2 ${
                    active
                      ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto">
            {rightTab === 'object' && (
              <ObjectCard
                object={selectedObject}
                telemetry={selectedTelemetry}
                simTimeMs={simTimeMs}
                onFocusCamera={(obj) => focusCameraOnObject(obj)}
                onScreenConjunctions={(noradId) => handleRunConjunctionScreening(noradId)}
                onSimulateBreakup={(noradId) => {
                  setFragParentId(noradId);
                  setRightTab('breakup');
                }}
                onOpenOptics={() => {
                  setApiOpen(false);
                  setOpticsOpen(true);
                }}
                onOpenVectorApi={() => {
                  setOpticsOpen(false);
                  setApiOpen(true);
                }}
                onClearSelection={() => {
                  setSelectedNoradId(null);
                  setActiveConjunction(null);
                }}
              />
            )}

            {rightTab === 'conjunctions' && (
              <ConjunctionPanel
                catalog={catalog}
                primaryNoradId={conjPrimaryId}
                windowHours={conjWindowHours}
                thresholdKm={conjThresholdKm}
                screening={conjScreening}
                progressPct={conjProgress}
                screenedStats={conjStatsText}
                results={conjResults}
                activeConjunctionId={activeConjunction?.id ?? null}
                onChangePrimary={setConjPrimaryId}
                onChangeWindowHours={setConjWindowHours}
                onChangeThresholdKm={setConjThresholdKm}
                onRunScreening={() => handleRunConjunctionScreening()}
                onSelectConjunction={handleSelectConjunction}
              />
            )}

            {rightTab === 'breakup' && (
              <FragmentationPanel
                catalog={catalog}
                parentNoradId={fragParentId}
                fragmentCount={fragCount}
                deltaVSigmaMS={fragDeltaV}
                mode={fragMode}
                proximityThresholdKm={fragProxKm}
                running={fragRunning}
                summary={fragSummary}
                onChangeParent={setFragParentId}
                onChangeCount={setFragCount}
                onChangeDeltaV={setFragDeltaV}
                onChangeMode={setFragMode}
                onChangeProximityKm={setFragProxKm}
                onSimulate={() => handleSimulateBreakup()}
                onClearCloud={handleClearBreakupCloud}
              />
            )}

            {(rightTab === 'stats' ||
              rightTab === 'overflight' ||
              rightTab === 'briefing') && (
              <StatsAndOverflightPanel
                mode={rightTab}
                catalog={catalog}
                dataStatus={dataStatus}
                simTimeMs={simTimeMs}
                conjunctions={conjResults}
                fragmentationSummary={fragSummary}
                regionBox={regionBox}
                drawRegionMode={drawRegionMode}
                onChangeRegionBox={setRegionBox}
                onToggleDrawRegion={() => setDrawRegionMode((m) => !m)}
                onSelectObject={(noradId) => handleSelectObject(noradId)}
              />
            )}
          </div>
        </aside>
      )}

      {/* Floating Hover Tooltip over Globe Objects */}
      {hoveredInfo && (
        <div
          className="pointer-events-none fixed z-40 px-3 py-2 rounded-lg bg-[#070B13]/95 border border-cyan-400/35 text-xs shadow-lg max-w-[260px]"
          style={{
            left: Math.min(window.innerWidth - 270, hoveredInfo.x + 14),
            top: Math.max(64, Math.min(window.innerHeight - 140, hoveredInfo.y + 14)),
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-semibold text-white truncate">
              {hoveredInfo.obj.name}
            </span>
            <span className="font-mono text-[10px] text-cyan-300 shrink-0">
              {hoveredInfo.obj.objectClass}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-300 tabular-nums space-y-0.5">
            <div>NORAD {hoveredInfo.obj.noradId}</div>
            <div>
              Alt:{' '}
              {hoveredInfo.telemetry
                ? `${hoveredInfo.telemetry.altKm.toFixed(1)} km`
                : `${hoveredInfo.obj.perigeeKm.toFixed(0)} km`}{' '}
              · Inc: {hoveredInfo.obj.inclinationDeg.toFixed(1)}°
            </div>
            <div>
              Vel: {hoveredInfo.telemetry ? `${hoveredInfo.telemetry.speedKmS.toFixed(2)} km/s` : '—'}{' '}
              · Period: {hoveredInfo.obj.periodMin.toFixed(0)}m
            </div>
          </div>
        </div>
      )}

      {/* Bottom Simulation Time Controls Bar */}
      <footer className="pointer-events-auto absolute bottom-3 left-3 right-3 z-30">
        <TimeControlsBar
          simTimeMs={simTimeMs}
          baseRealTimeMs={baseRealTimeMs}
          paused={paused}
          speedMultiplier={speedMultiplier}
          onTogglePause={() => setPaused((p) => !p)}
          onChangeSpeed={(mult) => setSpeedMultiplier(mult)}
          onScrubOffsetHours={(hoursOffset) =>
            jumpToSimTime(baseTimeRef.current + hoursOffset * 3600_000)
          }
          onResetNow={() => {
            const now = Date.now();
            setBaseRealTimeMs(now);
            baseTimeRef.current = now;
            jumpToSimTime(now);
          }}
        />
      </footer>

      {opticsOpen && (
        <div
          className={
            opticsFullscreen
              ? 'fixed inset-0 z-50'
              : 'fixed inset-x-4 top-20 bottom-24 lg:inset-x-24 z-40 shadow-2xl'
          }
        >
          <OpticalCameraView
            target={selectedObject ?? catalog[0] ?? null}
            liveState={selectedTelemetry}
            isFullscreen={opticsFullscreen}
            onToggleFullscreen={() => setOpticsFullscreen((f) => !f)}
            onClose={() => {
              setOpticsOpen(false);
              setOpticsFullscreen(false);
            }}
          />
        </div>
      )}

      {apiOpen && (
        <div className="fixed inset-x-4 top-20 bottom-24 lg:inset-x-20 z-40 shadow-2xl">
          <ApiInspectorDrawer
            selectedObject={selectedObject ?? catalog[0] ?? null}
            simTimeMs={simTimeMs}
            onClose={() => setApiOpen(false)}
          />
        </div>
      )}

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
