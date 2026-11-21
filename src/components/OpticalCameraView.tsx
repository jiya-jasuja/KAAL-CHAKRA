import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Camera,
  Crosshair,
  Maximize2,
  Minimize2,
  RotateCcw,
  Video,
  VideoOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GroundStation } from '../types/orbital.ts';
import type { ObjectClass } from '../types/debriswatch.ts';
import { createCompositeDebrisModel } from '../three/debrisModels.ts';
import { createEarthTextures } from '../three/earthTextures.ts';

type CameraMode = 'orbital-optics' | 'live-device';
type SensorFilter = 'optical' | 'thermal' | 'radar';
type TargetCategory = 'FRAGMENTATION' | 'ROCKET_BODY' | 'PAYLOAD' | 'STATION';

export interface OpticalTargetInfo {
  noradId: number;
  name: string;
  category?: TargetCategory;
  objectClass?: ObjectClass;
}

export interface OpticalLiveState {
  altKm: number;
  velocityKmS?: number;
  speedKmS?: number;
}

interface OpticalCameraViewProps {
  target: OpticalTargetInfo | null;
  liveState: OpticalLiveState | null;
  station?: GroundStation | null;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onClose?: () => void;
}

export function OpticalCameraView({
  target,
  liveState,
  station = null,
  isFullscreen = false,
  onToggleFullscreen,
  onClose,
}: OpticalCameraViewProps) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbital-optics');
  const [sensorFilter, setSensorFilter] = useState<SensorFilter>('optical');
  const [zoomLevel, setZoomLevel] = useState<number>(3.5);
  const [timelapseMult, setTimelapseMult] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [deviceCamError, setDeviceCamError] = useState<string | null>(null);
  const [deviceStreamActive, setDeviceStreamActive] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zoomRef = useRef(zoomLevel);
  const timelapseRef = useRef(timelapseMult);
  const filterRef = useRef(sensorFilter);
  const categoryRef = useRef(target?.category ?? 'FRAGMENTATION');

  const resolvedCategory: TargetCategory =
    target?.category ??
    (target?.objectClass === 'STATION'
      ? 'STATION'
      : target?.objectClass === 'DEBRIS'
        ? target.name.toUpperCase().includes('R/B')
          ? 'ROCKET_BODY'
          : 'FRAGMENTATION'
        : 'PAYLOAD');

  zoomRef.current = zoomLevel;
  timelapseRef.current = timelapseMult;
  filterRef.current = sensorFilter;
  categoryRef.current = resolvedCategory;

  // Drag-to-pan for zoomed optical feed
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  // Manage real Device Live Camera (`getUserMedia`) when user selects live-device mode
  useEffect(() => {
    if (cameraMode !== 'live-device') {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setDeviceStreamActive(false);
      return;
    }

    let cancelled = false;
    setDeviceCamError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setDeviceCamError('Browser media capture API is unavailable in this context.');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setDeviceStreamActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeviceCamError(
            'Camera access was declined or no hardware optical camera was detected. Switch back to Orbital Chase Optics to inspect live 3D telemetry.'
          );
        }
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraMode]);

  // Real-time 3D Orbital Chase Telescope Viewport
  useEffect(() => {
    if (cameraMode !== 'orbital-optics') return;
    const host = canvasHostRef.current;
    if (!host) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const w = host.clientWidth || 560;
    const h = host.clientHeight || 340;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050a);

    const camera = new THREE.PerspectiveCamera(48, w / h, 0.05, 120);
    camera.position.set(0, 0.35, 5.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.75);
    const key = new THREE.DirectionalLight(0xfff7ed, 2.5);
    key.position.set(5, 4, 4);
    const rim = new THREE.DirectionalLight(0x22d3ee, 1.3);
    rim.position.set(-4, -2, -5);
    scene.add(hemi, key, rim);

    // Distant curved Earth limb below the target (matte Argos Atlas cartography)
    const earthTex = createEarthTextures(renderer.capabilities.getMaxAnisotropy());
    const limbGeo = new THREE.SphereGeometry(14, 64, 48);
    const limbMat = new THREE.MeshStandardMaterial({
      map: earthTex.albedoMap,
      bumpMap: earthTex.bumpMap,
      bumpScale: 0.06,
      roughnessMap: earthTex.roughnessMap,
      emissiveMap: earthTex.emissiveMap,
      emissive: new THREE.Color(0xfbbf24),
      emissiveIntensity: 0.65,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
    });
    const limbMesh = new THREE.Mesh(limbGeo, limbMat);
    limbMesh.position.set(0, -15.6, -4.5);
    scene.add(limbMesh);

    const limbCloudGeo = new THREE.SphereGeometry(14.1, 24, 18);
    const limbCloudMat = new THREE.MeshStandardMaterial({
      map: earthTex.cloudMap,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      roughness: 1.0,
      envMapIntensity: 0.0,
    });
    const limbCloudMesh = new THREE.Mesh(limbCloudGeo, limbCloudMat);
    limbCloudMesh.visible = false;
    limbCloudMesh.position.copy(limbMesh.position);
    scene.add(limbCloudMesh);

    // Composite target models
    const models = {
      FRAGMENTATION: createCompositeDebrisModel('FRAGMENTATION'),
      ROCKET_BODY: createCompositeDebrisModel('ROCKET_BODY'),
      PAYLOAD: createCompositeDebrisModel('PAYLOAD'),
      STATION: createCompositeDebrisModel('STATION'),
    };
    const holder = new THREE.Group();
    scene.add(holder);

    let activeCat: string | null = null;
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();

    const onResize = () => {
      if (!host) return;
      const nw = host.clientWidth || 560;
      const nh = host.clientHeight || 340;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(host);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const cat = categoryRef.current;
      if (activeCat !== cat) {
        while (holder.children.length > 0) {
          holder.remove(holder.children[0]);
        }
        holder.add(models[cat].group);
        activeCat = cat;
      }

      const speedBoost =
        timelapseRef.current >= 5000
          ? 7.5
          : timelapseRef.current >= 100
            ? 3.2
            : timelapseRef.current >= 10
              ? 1.8
              : 1.0;

      holder.rotation.x += dt * 0.42 * speedBoost;
      holder.rotation.y += dt * 0.58 * speedBoost;
      limbMesh.rotation.y += dt * 0.015 * speedBoost;
      limbCloudMesh.rotation.y += dt * 0.022 * speedBoost;

      // Optical telephoto FOV zoom (1x -> 50deg, 24x -> 2.3deg)
      const targetFov = THREE.MathUtils.clamp(52 / zoomRef.current, 2.2, 54);
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 8, dt);
        camera.updateProjectionMatrix();
      }

      // Filter lighting cues
      const f = filterRef.current;
      if (f === 'thermal') {
        key.color.setHex(0xfb923c);
        rim.color.setHex(0xef4444);
      } else if (f === 'radar') {
        key.color.setHex(0x22d3ee);
        rim.color.setHex(0x38bdf8);
      } else {
        key.color.setHex(0xfff7ed);
        rim.color.setHex(0x22d3ee);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      limbGeo.dispose();
      limbMat.dispose();
      limbCloudGeo.dispose();
      limbCloudMat.dispose();
      earthTex.dispose();
      Object.values(models).forEach((m) => m.dispose());
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [cameraMode]);

  const maxZoom = cameraMode === 'orbital-optics' ? 24 : 8;
  const minZoom = 1;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.8 : -0.8;
    setZoomLevel((z) => Math.min(maxZoom, Math.max(minZoom, Number((z + step).toFixed(1)))));
  };

  const resetOptics = () => {
    setZoomLevel(cameraMode === 'orbital-optics' ? 3.5 : 1);
    setPanOffset({ x: 0, y: 0 });
  };

  const filterCssClass =
    sensorFilter === 'thermal'
      ? 'contrast-125 saturate-150 hue-rotate-[-20deg]'
      : sensorFilter === 'radar'
        ? 'contrast-150 saturate-50 brightness-110'
        : '';

  const rangeKm = liveState ? Math.max(42, Math.round(680 / zoomLevel)) : Math.round(520 / zoomLevel);

  return (
    <div
      className={`flex flex-col bg-[#080C15] border border-white/10 overflow-hidden ${
        isFullscreen ? 'w-full h-full rounded-none' : 'rounded-xl w-full h-full'
      }`}
    >
      {/* Optical Cam Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10 bg-[#0A0F1A]">
        <div className="flex items-center gap-3 min-w-0">
          <Camera className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-display text-sm font-semibold text-white whitespace-nowrap">
            Optical Telemetry Feed
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs font-mono text-slate-400 truncate">
            {station
              ? `${station.code} (${station.apertureM}m) → ${target ? target.name : 'Overhead Pass'}`
              : target
                ? `${target.name} (NORAD ${target.noradId})`
                : 'Select debris target'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-[#05070C] border border-white/10 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => {
                setCameraMode('orbital-optics');
                setZoomLevel(3.5);
                setPanOffset({ x: 0, y: 0 });
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                cameraMode === 'orbital-optics'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Orbital Chase Cam
            </button>
            <button
              type="button"
              onClick={() => {
                setCameraMode('live-device');
                setZoomLevel(1);
                setPanOffset({ x: 0, y: 0 });
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                cameraMode === 'live-device'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              Live Camera
            </button>
          </div>

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="p-1.5 text-slate-400 hover:text-white border border-white/10 rounded-lg bg-[#05070C] transition-colors"
              aria-label={isFullscreen ? 'Exit fullscreen camera' : 'Expand camera'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white border border-white/10 rounded-lg bg-[#05070C]"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Optical Viewport Stage */}
      <div
        className="relative flex-1 bg-[#03050A] overflow-hidden select-none"
        onWheel={handleWheel}
        onPointerDown={(e) => {
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            origX: panOffset.x,
            origY: panOffset.y,
          };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return;
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          setPanOffset({
            x: Math.max(-180, Math.min(180, dragRef.current.origX + dx)),
            y: Math.max(-140, Math.min(140, dragRef.current.origY + dy)),
          });
        }}
        onPointerUp={() => {
          dragRef.current.active = false;
        }}
      >
        {cameraMode === 'orbital-optics' ? (
          <div
            ref={canvasHostRef}
            className={`w-full h-full transition-transform duration-100 ${filterCssClass}`}
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#03050A] overflow-hidden">
            {deviceCamError ? (
              <div className="max-w-sm text-center px-6 py-5 border border-white/10 bg-[#0A0F1A] rounded-xl">
                <VideoOff className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-white">Live Camera Unavailable</p>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{deviceCamError}</p>
                <button
                  type="button"
                  onClick={() => setCameraMode('orbital-optics')}
                  className="mt-4 px-3.5 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors"
                >
                  Use Orbital Chase Cam
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-transform duration-150 ${filterCssClass}`}
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                }}
              />
            )}
          </div>
        )}

        {/* Precision Tracking Crosshair Reticle Overlay (Pointer-Events None) */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-44 h-44 border border-cyan-400/25 rounded-full flex items-center justify-center">
            <div className="w-24 h-24 border border-cyan-400/40 rounded-full" />
            <div className="absolute top-0 bottom-0 w-px bg-cyan-400/20" />
            <div className="absolute left-0 right-0 h-px bg-cyan-400/20" />
            <Crosshair className="w-5 h-5 text-cyan-300/80" />
          </div>
        </div>

        {/* Corner Calibrated Telemetry Readouts */}
        <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-1 text-[11px] font-mono tabular-nums text-slate-300 bg-[#05070C]/80 border border-white/10 px-2.5 py-1.5 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400">MAG {zoomLevel.toFixed(1)}×</span>
            <span className="text-slate-600">/</span>
            <span>RANGE {rangeKm} km</span>
          </div>
          <div>
            {liveState
              ? `ALT ${liveState.altKm.toFixed(1)} km · VEL ${(liveState.velocityKmS ?? liveState.speedKmS ?? 7.5).toFixed(2)} km/s`
              : cameraMode === 'live-device' && deviceStreamActive
                ? 'LIVE OPTICAL SENSOR STREAM'
                : 'OPTICAL TRACKING LOCKED'}
          </div>
        </div>

        <div className="pointer-events-none absolute top-3 right-3 text-[11px] font-mono tabular-nums text-slate-300 bg-[#05070C]/80 border border-white/10 px-2.5 py-1.5 rounded-lg">
          FOV {(52 / zoomLevel).toFixed(1)}° · {sensorFilter.toUpperCase()}
        </div>
      </div>

      {/* Optical Zoom & Sensor Filter Control Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-white/10 bg-[#0A0F1A]">
        <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(minZoom, Number((z - 1).toFixed(1))))}
            className="p-1.5 border border-white/10 rounded-lg text-slate-300 hover:text-white hover:border-cyan-400/40 transition-colors"
            aria-label="Zoom out optical camera"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min={minZoom}
            max={maxZoom}
            step={0.5}
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="atlas-range flex-1"
            aria-label="Optical zoom magnification"
          />
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(maxZoom, Number((z + 1).toFixed(1))))}
            className="p-1.5 border border-white/10 rounded-lg text-slate-300 hover:text-white hover:border-cyan-400/40 transition-colors"
            aria-label="Zoom in optical camera"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono tabular-nums text-cyan-300 w-12 text-right">
            {zoomLevel.toFixed(1)}×
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-[#05070C] border border-white/10 rounded-md p-0.5 font-mono tabular-nums mr-1">
            {[1, 10, 100, 5000].map((mult) => (
              <button
                key={mult}
                type="button"
                onClick={() => setTimelapseMult(mult)}
                className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${
                  timelapseMult === mult
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={`Optical pass timelapse ${mult}×`}
              >
                {mult}×
              </button>
            ))}
          </div>

          {(['optical', 'thermal', 'radar'] as SensorFilter[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSensorFilter(mode)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors capitalize ${
                sensorFilter === mode
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                  : 'border-white/10 bg-[#05070C] text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode}
            </button>
          ))}
          <button
            type="button"
            onClick={resetOptics}
            className="p-1.5 border border-white/10 rounded-md bg-[#05070C] text-slate-400 hover:text-white transition-colors"
            aria-label="Reset camera zoom and pan"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
