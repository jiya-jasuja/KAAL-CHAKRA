import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as satellite from 'satellite.js';
import type {
  CompiledOrbitalObject,
  ConjunctionEvent,
  DebrisCategory,
  GlobeBasemapStyle,
  LayerVisibility,
  OrbitalHotspot,
  PropagatedState,
} from '../types/orbital.ts';
import { GROUND_STATIONS } from '../data/tleCatalog.ts';
import {
  altitudeKmToSceneRadius,
  computeOrbitTrackPoints,
  latLonAltToVector3,
  propagateObjectAtDate,
} from '../utils/orbitalMath.ts';
import {
  createEarthTextures,
  loadEsriSatelliteAlbedoTexture,
} from '../three/earthTextures.ts';
import { createCompositeDebrisModel } from '../three/debrisModels.ts';

export interface CameraFlyTarget {
  id: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  nonce: number;
}

interface OrbitalGlobeCanvasProps {
  objects: CompiledOrbitalObject[];
  conjunctions: ConjunctionEvent[];
  selectedId: number | null;
  selectedStationId: string | null;
  activeHotspot: OrbitalHotspot | null;
  flyRequest: CameraFlyTarget | null;
  autoRotate: boolean;
  timeScale: number;
  paused: boolean;
  layers: LayerVisibility;
  basemapStyle: GlobeBasemapStyle;
  followSelected: boolean;
  onSelectObject: (noradId: number | null) => void;
  onSelectStation: (stationId: string) => void;
  onTelemetryTick: (
    simTime: Date,
    selectedState: PropagatedState | null,
    visibleCount: number
  ) => void;
}

// Reusable math scratchpad (zero GC inside render loop)
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _pos = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _color = new THREE.Color();
const _tmpGeo = { x: 0, y: 0, z: 0 };
const _stateScratch: PropagatedState = {
  noradId: 0,
  latDeg: 0,
  lonDeg: 0,
  altKm: 0,
  velocityKmS: 0,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
};

const CATEGORY_COLORS: Record<DebrisCategory, number> = {
  FRAGMENTATION: 0xef4444, // Alert Crimson
  ROCKET_BODY: 0xf59e0b,   // Telemetry Amber
  PAYLOAD: 0x38bdf8,       // Calibrated Cyan
  STATION: 0x34d399,       // Orbital Emerald
};

export function OrbitalGlobeCanvas({
  objects,
  conjunctions,
  selectedId,
  selectedStationId,
  flyRequest,
  autoRotate,
  timeScale,
  paused,
  layers,
  basemapStyle,
  followSelected,
  onSelectObject,
  onSelectStation,
  onTelemetryTick,
}: OrbitalGlobeCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Mutable refs so React UI updates never rebuild the WebGL scene
  const objectsRef = useRef(objects);
  const conjunctionsRef = useRef(conjunctions);
  const selectedIdRef = useRef(selectedId);
  const selectedStationIdRef = useRef(selectedStationId);
  const autoRotateRef = useRef(autoRotate);
  const timeScaleRef = useRef(timeScale);
  const pausedRef = useRef(paused);
  const layersRef = useRef(layers);
  const basemapStyleRef = useRef(basemapStyle);
  const followSelectedRef = useRef(followSelected);
  const onSelectRef = useRef(onSelectObject);
  const onSelectStationRef = useRef(onSelectStation);
  const onTickRef = useRef(onTelemetryTick);

  objectsRef.current = objects;
  conjunctionsRef.current = conjunctions;
  selectedIdRef.current = selectedId;
  selectedStationIdRef.current = selectedStationId;
  autoRotateRef.current = autoRotate;
  timeScaleRef.current = timeScale;
  pausedRef.current = paused;
  layersRef.current = layers;
  basemapStyleRef.current = basemapStyle;
  followSelectedRef.current = followSelected;
  onSelectRef.current = onSelectObject;
  onSelectStationRef.current = onSelectStation;
  onTickRef.current = onTelemetryTick;

  const flyStateRef = useRef<{
    active: boolean;
    targetCam: THREE.Vector3;
    targetLook: THREE.Vector3;
    lastNonce: number;
  }>({
    active: false,
    targetCam: new THREE.Vector3(0, 1.35, 3.35),
    targetLook: new THREE.Vector3(0, 0, 0),
    lastNonce: -1,
  });

  useEffect(() => {
    if (flyRequest && flyRequest.nonce !== flyStateRef.current.lastNonce) {
      flyStateRef.current.active = true;
      flyStateRef.current.lastNonce = flyRequest.nonce;
      flyStateRef.current.targetCam.set(...flyRequest.position);
      flyStateRef.current.targetLook.set(...flyRequest.lookAt);
    }
  }, [flyRequest]);

  // Ref for triggering orbital track rebuild when selectedId changes
  const trackRebuildSignalRef = useRef<number | null>(null);
  useEffect(() => {
    trackRebuildSignalRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

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

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070c);
    scene.fog = new THREE.FogExp2(0x05070c, 0.018);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.02, 100);
    camera.position.set(0.85, 1.25, 3.15);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Mandatory studio environment map for metallic hardware reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Balanced Argos Atlas Tactical Lighting Rig (even cartographic legibility, zero glare)
    const hemiLight = new THREE.HemisphereLight(0xcbe2ff, 0x243247, 0.96);
    scene.add(hemiLight);

    const sunDirection = new THREE.Vector3(8, 3.2, 6.2).normalize();
    const sunLight = new THREE.DirectionalLight(0xf8fafc, 1.15);
    sunLight.position.copy(sunDirection).multiplyScalar(14);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.25);
    rimLight.position.set(-7, -2.0, -5);
    scene.add(rimLight);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.26;
    controls.maxDistance = 13.5;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.95;
    controls.autoRotateSpeed = 0.42;

    controls.addEventListener('start', () => {
      flyStateRef.current.active = false;
    });

    // Starfield (Instanced / Points)
    const starCount = 2200;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.sin(i * 12.9898) * 43758.5453;
      const v = Math.sin(i * 78.233) * 24634.6345;
      const r1 = u - Math.floor(u);
      const r2 = v - Math.floor(v);
      const theta = r1 * Math.PI * 2;
      const phi = Math.acos(2 * r2 - 1);
      const radius = 28 + (i % 14);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.cos(phi);
      starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const tint = 0.7 + (i % 5) * 0.06;
      starColors[i * 3] = tint;
      starColors[i * 3 + 1] = tint + 0.04;
      starColors[i * 3 + 2] = 1.0;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.075,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // Matte Argos Atlas Earth Globe (zero studio specular reflection, crisp coastlines & borders)
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthTextures = createEarthTextures(maxAnisotropy);
    let esriSatelliteMap: THREE.CanvasTexture | null = null;
    let esriLoading = false;
    let appliedBasemap: GlobeBasemapStyle = 'dark-vector';

    const earthGeo = new THREE.SphereGeometry(1.0, 96, 64);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTextures.albedoMap,
      bumpMap: earthTextures.bumpMap,
      bumpScale: 0.008,
      roughnessMap: earthTextures.roughnessMap,
      emissiveMap: earthTextures.emissiveMap,
      emissive: new THREE.Color(0xfbbf24),
      emissiveIntensity: 1.05,
      metalness: 0.0,
      roughness: 1.0,
      envMapIntensity: 0.0,
    });

    earthMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = { value: sunDirection };
      shader.vertexShader =
        `varying vec3 vWorldNormal;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vWorldNormal = normalize(mat3(modelMatrix) * normal);`
        );

      shader.fragmentShader =
        `uniform vec3 uSunDir;\nvarying vec3 vWorldNormal;\n` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           float sunAngle = dot(normalize(vWorldNormal), normalize(uSunDir));
           float nightFactor = mix(0.32, 1.0, smoothstep(0.25, -0.25, sunAngle));
           totalEmissiveRadiance *= nightFactor;`
        );
    };

    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);

    // Cloud shell kept clean & off so Argos tactical borders remain razor-sharp
    const cloudGeo = new THREE.SphereGeometry(1.008, 48, 36);
    const cloudMat = new THREE.MeshStandardMaterial({
      map: earthTextures.cloudMap,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.0,
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.visible = false;
    scene.add(cloudMesh);

    // Subtle Crisp Horizon Edge Rim (Argos Atlas thin atmospheric outline, no shiny bubble glare)
    const atmoGeo = new THREE.SphereGeometry(1.026, 72, 54);
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x38bdf8) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float rim = pow(0.56 - dot(vNormal, normalize(vViewPos)), 4.6);
          gl_FragColor = vec4(uColor, clamp(rim * 0.42, 0.0, 0.38));
        }
      `,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // Orbital Altitude Shells Group (LEO 800km, MEO 2000km, GEO 35786km)
    const shellsGroup = new THREE.Group();
    const buildShellRing = (altKm: number, colorHex: number, opacity: number) => {
      const r = altitudeKmToSceneRadius(altKm);
      const pts: THREE.Vector3[] = [];
      const segs = 128;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
      });
      return new THREE.Line(g, m);
    };

    const leoEquatorial = buildShellRing(780, 0x38bdf8, 0.24);
    const leoPolar = buildShellRing(850, 0xef4444, 0.16);
    leoPolar.rotation.x = Math.PI / 2;
    const geoRing = buildShellRing(35786, 0xf59e0b, 0.22);
    shellsGroup.add(leoEquatorial, leoPolar, geoRing);
    scene.add(shellsGroup);

    // Kessler High-Density Hazard Shell Band (780-860 km orbital danger zone)
    const kesslerGroup = new THREE.Group();
    const kesslerBandGeo = new THREE.SphereGeometry(altitudeKmToSceneRadius(820), 48, 36);
    const kesslerBandMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.045,
      wireframe: true,
      depthWrite: false,
    });
    const kesslerBandMesh = new THREE.Mesh(kesslerBandGeo, kesslerBandMat);
    kesslerGroup.add(kesslerBandMesh);
    scene.add(kesslerGroup);

    // Argos-Style 3D Ground Surveillance Stations (Optical Telescopes & Phased Array Radars)
    const groundStationsGroup = new THREE.Group();
    const stationHitMeshes: THREE.Mesh[] = [];
    const stationPinGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.025, 12);
    const stationConeGeo = new THREE.ConeGeometry(0.06, 0.24, 16, 1, true);
    const stationHitGeo = new THREE.SphereGeometry(0.048, 8, 8);
    const stationHitMat = new THREE.MeshBasicMaterial({ visible: false });
    const stationBaseRingGeo = new THREE.RingGeometry(0.016, 0.024, 24);

    const stationVisuals: Array<{
      id: string;
      pinMat: THREE.MeshBasicMaterial;
      coneMat: THREE.MeshBasicMaterial;
      ringMat: THREE.MeshBasicMaterial;
    }> = [];

    for (const st of GROUND_STATIONS) {
      latLonAltToVector3(st.latDeg, st.lonDeg, 1.004, _tmpGeo);
      const stHolder = new THREE.Group();
      stHolder.position.set(_tmpGeo.x, _tmpGeo.y, _tmpGeo.z);

      // Orient local +Y outward along surface normal
      _pos.set(_tmpGeo.x, _tmpGeo.y, _tmpGeo.z).normalize();
      stHolder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _pos);

      const isOptical = st.sensorType.includes('Optical');
      const baseColor = isOptical ? 0x22d3ee : 0xf59e0b;

      const pinMat = new THREE.MeshBasicMaterial({ color: baseColor });
      const pinMesh = new THREE.Mesh(stationPinGeo, pinMat);
      pinMesh.position.y = 0.012;
      stHolder.add(pinMesh);

      const ringMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(stationBaseRingGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = 0.003;
      stHolder.add(ringMesh);

      const coneMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const coneMesh = new THREE.Mesh(stationConeGeo, coneMat);
      coneMesh.position.y = 0.14;
      coneMesh.rotation.x = Math.PI;
      stHolder.add(coneMesh);

      const hitMesh = new THREE.Mesh(stationHitGeo, stationHitMat);
      hitMesh.position.y = 0.03;
      hitMesh.layers.set(1);
      hitMesh.userData.stationId = st.id;
      stHolder.add(hitMesh);
      stationHitMeshes.push(hitMesh);

      stationVisuals.push({ id: st.id, pinMat, coneMat, ringMat });
      groundStationsGroup.add(stHolder);
    }
    scene.add(groundStationsGroup);

    // Argos-Style 3D Conjunction Hazard Arcs (dynamically updated for top conjunction pairs)
    const MAX_ARC_SEGMENTS = 12;
    const ARC_POINTS = 28;
    const conjunctionArcsGroup = new THREE.Group();
    const arcLines: Array<{
      line: THREE.Line;
      geo: THREE.BufferGeometry;
      mat: THREE.LineBasicMaterial;
    }> = [];
    for (let i = 0; i < MAX_ARC_SEGMENTS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3)
      );
      const mat = new THREE.LineBasicMaterial({
        color: i < 3 ? 0xef4444 : 0xf59e0b,
        transparent: true,
        opacity: 0.72,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      conjunctionArcsGroup.add(line);
      arcLines.push({ line, geo, mat });
    }
    scene.add(conjunctionArcsGroup);

    // Instanced Debris Cloud (max 500 instances)
    const MAX_INSTANCES = 500;
    const debrisGeo = new THREE.OctahedronGeometry(0.017, 0);
    const debrisMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, MAX_INSTANCES);
    debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    debrisMesh.frustumCulled = false;
    debrisMesh.layers.enable(1);
    scene.add(debrisMesh);

    // Invisible larger hit spheres for forgiving pointer picking of debris dots
    const hitGeo = new THREE.SphereGeometry(0.042, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitInstancedMesh = new THREE.InstancedMesh(hitGeo, hitMat, MAX_INSTANCES);
    hitInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hitInstancedMesh.frustumCulled = false;
    hitInstancedMesh.layers.set(1);
    scene.add(hitInstancedMesh);

    // Active Selected Target Overlay: Orbit Line + Nadir Plumb + Beacon Ring + Composite 3D Model
    const orbitTrackGeo = new THREE.BufferGeometry();
    const orbitTrackMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.88,
    });
    const orbitTrackLine = new THREE.Line(orbitTrackGeo, orbitTrackMat);
    orbitTrackLine.visible = false;
    scene.add(orbitTrackLine);

    const nadirGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const nadirMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
    });
    const nadirLine = new THREE.Line(nadirGeo, nadirMat);
    nadirLine.visible = false;
    scene.add(nadirLine);

    const beaconGeo = new THREE.RingGeometry(0.022, 0.036, 32);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.visible = false;
    scene.add(beaconMesh);

    // Composite 3-12 part 3D models cached by category for selected target inspection
    const compositeModels: Record<
      DebrisCategory,
      ReturnType<typeof createCompositeDebrisModel>
    > = {
      FRAGMENTATION: createCompositeDebrisModel('FRAGMENTATION'),
      ROCKET_BODY: createCompositeDebrisModel('ROCKET_BODY'),
      PAYLOAD: createCompositeDebrisModel('PAYLOAD'),
      STATION: createCompositeDebrisModel('STATION'),
    };
    const activeCraftHolder = new THREE.Group();
    activeCraftHolder.visible = false;
    scene.add(activeCraftHolder);

    let currentCraftCategory: DebrisCategory | null = null;

    // Raycasting Setup (restricted to layer 1: debris + ground stations)
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (dx * dx + dy * dy > 36) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);

      if (layersRef.current.groundStations) {
        const stationHits = raycaster.intersectObjects(stationHitMeshes, false);
        if (stationHits.length > 0 && stationHits[0].object.userData.stationId) {
          onSelectStationRef.current(String(stationHits[0].object.userData.stationId));
          return;
        }
      }

      const hits = raycaster.intersectObject(hitInstancedMesh, false);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        const idx = hits[0].instanceId;
        const obj = objectsRef.current[idx];
        if (obj) {
          onSelectRef.current(obj.noradId);
        }
      }
    };

    let lastHoverCheck = 0;
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheck < 60) return;
      lastHoverCheck = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const stationHits = layersRef.current.groundStations
        ? raycaster.intersectObjects(stationHitMeshes, false)
        : [];
      const hits = raycaster.intersectObject(hitInstancedMesh, false);
      renderer.domElement.style.cursor =
        stationHits.length > 0 || hits.length > 0 ? 'pointer' : 'grab';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Simulation Loop
    let simTimeMs = Date.now();
    let lastFrameTime = performance.now();
    let lastTelemetryPush = 0;
    let builtTrackForId: number | null = null;
    let frameId = 0;
    let disposed = false;

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
      const nowPerf = performance.now();
      const dt = Math.min((nowPerf - lastFrameTime) / 1000, 0.1);
      lastFrameTime = nowPerf;

      if (!pausedRef.current) {
        simTimeMs += dt * 1000 * timeScaleRef.current;
      }
      const simDate = new Date(simTimeMs);
      const gmst = satellite.gstime(simDate);

      // Slow cloud drift
      cloudMesh.rotation.y += dt * 0.008;

      // Basemap style swap (Dark Vector vs Esri Satellite) without scene rebuild
      const desiredBasemap = basemapStyleRef.current;
      if (desiredBasemap === 'esri-satellite' && !esriSatelliteMap && !esriLoading) {
        esriLoading = true;
        loadEsriSatelliteAlbedoTexture(maxAnisotropy).then((tex) => {
          if (disposed) {
            tex?.dispose();
            return;
          }
          esriLoading = false;
          if (tex) {
            esriSatelliteMap = tex;
            if (basemapStyleRef.current === 'esri-satellite') {
              earthMat.map = esriSatelliteMap;
              earthMat.emissiveIntensity = 0.65;
              earthMat.needsUpdate = true;
              appliedBasemap = 'esri-satellite';
            }
          }
        });
      } else if (desiredBasemap !== appliedBasemap) {
        if (desiredBasemap === 'esri-satellite' && esriSatelliteMap) {
          earthMat.map = esriSatelliteMap;
          earthMat.emissiveIntensity = 0.65;
          earthMat.needsUpdate = true;
          appliedBasemap = 'esri-satellite';
        } else if (desiredBasemap === 'dark-vector') {
          earthMat.map = earthTextures.albedoMap;
          earthMat.emissiveIntensity = 1.05;
          earthMat.needsUpdate = true;
          appliedBasemap = 'dark-vector';
        }
      }

      const activeLayers = layersRef.current;
      shellsGroup.visible = activeLayers.shells;
      kesslerGroup.visible = activeLayers.kesslerBands;
      groundStationsGroup.visible = activeLayers.groundStations;
      conjunctionArcsGroup.visible = activeLayers.conjunctionArcs;

      // Highlight selected ground station beacon
      const selStId = selectedStationIdRef.current;
      for (const sv of stationVisuals) {
        const isSel = sv.id === selStId;
        sv.coneMat.opacity = isSel ? 0.28 : 0.11;
        sv.ringMat.opacity = isSel ? 1.0 : 0.72;
      }

      // Update instanced debris cloud
      const activeObjects = objectsRef.current;
      const count = Math.min(activeObjects.length, MAX_INSTANCES);
      debrisMesh.count = count;
      hitInstancedMesh.count = count;

      let selectedObj: CompiledOrbitalObject | null = null;
      let selectedState: PropagatedState | null = null;
      const selId = selectedIdRef.current;
      const posByNorad = new Map<number, [number, number, number]>();

      for (let i = 0; i < count; i++) {
        const obj = activeObjects[i];
        const categoryVisible =
          (obj.category === 'FRAGMENTATION' && activeLayers.fragmentation) ||
          (obj.category === 'ROCKET_BODY' && activeLayers.rocketBodies) ||
          ((obj.category === 'PAYLOAD' || obj.category === 'STATION') && activeLayers.payloads) ||
          obj.noradId === selId;

        const st = categoryVisible
          ? propagateObjectAtDate(obj, simDate, gmst, _stateScratch)
          : null;

        if (st) {
          posByNorad.set(obj.noradId, [st.x, st.y, st.z]);
          _pos.set(st.x, st.y, st.z);
          const isSel = obj.noradId === selId;
          const s = isSel ? 1.85 : obj.rcsSize === 'LARGE' ? 1.35 : 0.9;
          _scale.set(s, s, s);
          _mat4.compose(_pos, _quat, _scale);
          debrisMesh.setMatrixAt(i, _mat4);
          hitInstancedMesh.setMatrixAt(i, _mat4);

          if (isSel) {
            _color.setHex(0xffffff);
            selectedObj = obj;
            selectedState = { ...st };
          } else {
            _color.setHex(CATEGORY_COLORS[obj.category]);
          }
          debrisMesh.setColorAt(i, _color);
        } else {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos, _quat, _scale);
          debrisMesh.setMatrixAt(i, _mat4);
          hitInstancedMesh.setMatrixAt(i, _mat4);
        }
      }

      debrisMesh.instanceMatrix.needsUpdate = true;
      hitInstancedMesh.instanceMatrix.needsUpdate = true;
      if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;

      // Update Argos-style 3D Conjunction Hazard Arcs between close-approach pairs
      if (activeLayers.conjunctionArcs) {
        const cdms = conjunctionsRef.current;
        for (let i = 0; i < MAX_ARC_SEGMENTS; i++) {
          const arc = arcLines[i];
          const cdm = cdms[i];
          if (!cdm) {
            arc.line.visible = false;
            continue;
          }
          const pA = posByNorad.get(cdm.primaryNoradId);
          const pB = posByNorad.get(cdm.secondaryNoradId);
          if (!pA || !pB) {
            arc.line.visible = false;
            continue;
          }
          _pos.set(pA[0], pA[1], pA[2]);
          _posB.set(pB[0], pB[1], pB[2]);
          const attr = arc.geo.getAttribute('position') as THREE.BufferAttribute;
          for (let k = 0; k < ARC_POINTS; k++) {
            const t = k / (ARC_POINTS - 1);
            const lift = 1 + Math.sin(t * Math.PI) * 0.12;
            const lx = (_pos.x + (_posB.x - _pos.x) * t) * lift;
            const ly = (_pos.y + (_posB.y - _pos.y) * t) * lift;
            const lz = (_pos.z + (_posB.z - _pos.z) * t) * lift;
            attr.setXYZ(k, lx, ly, lz);
          }
          attr.needsUpdate = true;
          arc.line.visible = true;
        }
      }

      // Update Selected Target 3D Craft + Orbit Arc + Nadir Plumb Line
      if (selectedObj && selectedState) {
        if (currentCraftCategory !== selectedObj.category) {
          while (activeCraftHolder.children.length > 0) {
            activeCraftHolder.remove(activeCraftHolder.children[0]);
          }
          activeCraftHolder.add(compositeModels[selectedObj.category].group);
          currentCraftCategory = selectedObj.category;
        }
        activeCraftHolder.visible = true;
        activeCraftHolder.position.set(selectedState.x, selectedState.y, selectedState.z);
        activeCraftHolder.scale.setScalar(0.032);
        activeCraftHolder.rotation.x += dt * 0.65;
        activeCraftHolder.rotation.y += dt * 0.85;

        // Nadir plumb line + surface beacon
        latLonAltToVector3(selectedState.latDeg, selectedState.lonDeg, 1.005, _tmpGeo);
        const nadirAttr = nadirGeo.getAttribute('position') as THREE.BufferAttribute;
        nadirAttr.setXYZ(0, selectedState.x, selectedState.y, selectedState.z);
        nadirAttr.setXYZ(1, _tmpGeo.x, _tmpGeo.y, _tmpGeo.z);
        nadirAttr.needsUpdate = true;
        nadirLine.visible = true;

        beaconMesh.position.set(_tmpGeo.x, _tmpGeo.y, _tmpGeo.z);
        beaconMesh.lookAt(0, 0, 0);
        beaconMesh.visible = true;

        if (activeLayers.orbitTrack) {
          if (builtTrackForId !== selectedObj.noradId) {
            const pts = computeOrbitTrackPoints(selectedObj, simDate, 96);
            orbitTrackGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
            orbitTrackGeo.computeBoundingSphere();
            builtTrackForId = selectedObj.noradId;
          }
          orbitTrackLine.visible = true;
        } else {
          orbitTrackLine.visible = false;
        }
      } else {
        activeCraftHolder.visible = false;
        nadirLine.visible = false;
        beaconMesh.visible = false;
        orbitTrackLine.visible = false;
        builtTrackForId = null;
      }

      // Smooth damped camera fly-to or follow-target tracking
      if (flyStateRef.current.active) {
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          flyStateRef.current.targetCam.x,
          4.8,
          dt
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          flyStateRef.current.targetCam.y,
          4.8,
          dt
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          flyStateRef.current.targetCam.z,
          4.8,
          dt
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          flyStateRef.current.targetLook.x,
          5.2,
          dt
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          flyStateRef.current.targetLook.y,
          5.2,
          dt
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          flyStateRef.current.targetLook.z,
          5.2,
          dt
        );

        if (
          camera.position.distanceTo(flyStateRef.current.targetCam) < 0.015 &&
          controls.target.distanceTo(flyStateRef.current.targetLook) < 0.01
        ) {
          flyStateRef.current.active = false;
        }
      } else if (followSelectedRef.current && selectedState) {
        controls.target.x = THREE.MathUtils.damp(controls.target.x, selectedState.x * 0.45, 3.2, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, selectedState.y * 0.45, 3.2, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, selectedState.z * 0.45, 3.2, dt);
      }

      controls.autoRotate = !isSoftwareGl && autoRotateRef.current && !flyStateRef.current.active;
      controls.update();

      renderer.render(scene, camera);

      // Throttle telemetry callbacks to React UI (~6 Hz) so React never bottlenecks WebGL
      if (nowPerf - lastTelemetryPush > 160) {
        lastTelemetryPush = nowPerf;
        onTickRef.current(simDate, selectedState, count);
      }

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      controls.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      earthTextures.dispose();
      esriSatelliteMap?.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      debrisGeo.dispose();
      debrisMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      orbitTrackGeo.dispose();
      orbitTrackMat.dispose();
      nadirGeo.dispose();
      nadirMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      kesslerBandGeo.dispose();
      kesslerBandMat.dispose();
      stationPinGeo.dispose();
      stationConeGeo.dispose();
      stationHitGeo.dispose();
      stationHitMat.dispose();
      stationBaseRingGeo.dispose();
      stationVisuals.forEach((sv) => {
        sv.pinMat.dispose();
        sv.coneMat.dispose();
        sv.ringMat.dispose();
      });
      arcLines.forEach((a) => {
        a.geo.dispose();
        a.mat.dispose();
      });
      Object.values(compositeModels).forEach((m) => m.dispose());
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="Interactive 3D Earth Orbital Debris Globe"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#05070C] text-slate-200 p-6">
          <div className="max-w-md text-center border border-white/10 bg-[#0B101B] rounded-xl p-6">
            <h2 className="font-display text-lg font-semibold text-white">
              WebGL Context Interrupted
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Graphics hardware reset the orbital viewport. Telemetry and catalog
              views remain available while WebGL restores.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
