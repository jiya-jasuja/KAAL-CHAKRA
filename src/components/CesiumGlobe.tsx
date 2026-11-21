import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type {
  BaseImageryMode,
  CatalogObject,
  ConjunctionCandidate,
  LiveTelemetrySnapshot,
  ObjectClass,
  RegionBox,
} from '../types/debriswatch.ts';
import { computeNextPeriodOrbitCartesianMeters } from '../utils/orbitMath.ts';

if (typeof window !== 'undefined') {
  (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/';
}

export interface CameraTargetRequest {
  noradId: number;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  nonce: number;
}

interface CesiumGlobeProps {
  catalog: CatalogObject[];
  visibleNoradIds: Set<number>;
  positionsRef: React.MutableRefObject<Float32Array | null>;
  noradIndexMapRef: React.MutableRefObject<Map<number, number>>;
  fragmentPositionsRef: React.MutableRefObject<Float32Array | null>;
  fragmentVersion: number;
  selectedObject: CatalogObject | null;
  activeConjunction: ConjunctionCandidate | null;
  simTimeMs: number;
  imageryMode: BaseImageryMode;
  showDensityHeatmap: boolean;
  showVectorOverlay: boolean;
  regionBox: RegionBox | null;
  drawRegionMode: boolean;
  flyRequest: CameraTargetRequest | null;
  resetViewNonce: number;
  onSelectObject: (noradId: number | null) => void;
  onHoverObject: (snapshot: { obj: CatalogObject; telemetry: LiveTelemetrySnapshot | null; x: number; y: number } | null) => void;
  onRegionDrawn: (box: RegionBox) => void;
}

const CLASS_COLORS_CSS: Record<ObjectClass, string> = {
  DEBRIS: '#ef4444',  // Red
  ACTIVE: '#22d3ee',  // Cyan
  EO: '#34d399',      // Green
  STATION: '#fbbf24', // Gold
};

export default function CesiumGlobe({
  catalog,
  visibleNoradIds,
  positionsRef,
  noradIndexMapRef,
  fragmentPositionsRef,
  fragmentVersion,
  selectedObject,
  activeConjunction,
  simTimeMs,
  imageryMode,
  showDensityHeatmap,
  showVectorOverlay,
  regionBox,
  drawRegionMode,
  flyRequest,
  resetViewNonce,
  onSelectObject,
  onHoverObject,
  onRegionDrawn,
}: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const creditRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const pointCollectionRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const pointPoolRef = useRef<Cesium.PointPrimitive[]>([]);
  const fragCollectionRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const fragPoolRef = useRef<Cesium.PointPrimitive[]>([]);
  const orbitPolylinesRef = useRef<Cesium.PolylineCollection | null>(null);
  const vectorPolylinesRef = useRef<Cesium.PolylineCollection | null>(null);
  const fieldVectorPoolRef = useRef<Cesium.Polyline[]>([]);
  const triadPolylinesRef = useRef<{
    velocity: Cesium.Polyline;
    radial: Cesium.Polyline;
    normal: Cesium.Polyline;
  } | null>(null);
  const regionEntityRef = useRef<Cesium.Entity | null>(null);
  const densityEntityRef = useRef<Cesium.Entity[]>([]);

  const [webglError, setWebglError] = useState<string | null>(null);

  const catalogByNoradRef = useRef<Map<number, CatalogObject>>(new Map());
  const visibleSetRef = useRef(visibleNoradIds);
  const selectedNoradRef = useRef<number | null>(selectedObject?.noradId ?? null);
  const showVectorRef = useRef(showVectorOverlay);
  const drawModeRef = useRef(drawRegionMode);
  const firstCornerRef = useRef<{ lat: number; lon: number } | null>(null);
  const onSelectRef = useRef(onSelectObject);
  const onHoverRef = useRef(onHoverObject);
  const onRegionDrawnRef = useRef(onRegionDrawn);

  visibleSetRef.current = visibleNoradIds;
  selectedNoradRef.current = selectedObject?.noradId ?? null;
  showVectorRef.current = showVectorOverlay;
  drawModeRef.current = drawRegionMode;
  onSelectRef.current = onSelectObject;
  onHoverRef.current = onHoverObject;
  onRegionDrawnRef.current = onRegionDrawn;

  useEffect(() => {
    const map = new Map<number, CatalogObject>();
    for (const item of catalog) {
      map.set(item.noradId, item);
    }
    catalogByNoradRef.current = map;
  }, [catalog]);

  // Initialize CesiumJS Viewer once (no Cesium ion token)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    Cesium.Ion.defaultAccessToken = '';

    let viewer: Cesium.Viewer;
    try {
      viewer = new Cesium.Viewer(container, {
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        vrButton: false,
        creditContainer: creditRef.current ?? undefined,
        requestRenderMode: false,
        msaaSamples: 1,
      });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'Unable to initialize Cesium WebGL viewer.');
      return;
    }

    viewerRef.current = viewer;

    const scene = viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#03050a');
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#08101d');
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
      scene.skyAtmosphere.hueShift = -0.02;
      scene.skyAtmosphere.saturationShift = -0.15;
      scene.skyAtmosphere.brightnessShift = -0.18;
    }
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;

    // Initial free imagery layer (NASA GIBS Blue Marble shaded relief, zero Ion token)
    const gibsProvider = new Cesium.UrlTemplateImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
      maximumLevel: 8,
      credit: 'NASA GIBS',
    });
    const baseLayer = viewer.imageryLayers.addImageryProvider(gibsProvider);
    baseLayer.brightness = 0.62;
    baseLayer.contrast = 1.18;
    baseLayer.saturation = 0.72;

    // Collections for thousands of tracked objects + fragmentation cloud + orbit paths + 3D state vectors
    const pointsCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const fragCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const polyCol = scene.primitives.add(new Cesium.PolylineCollection());
    const vecCol = scene.primitives.add(new Cesium.PolylineCollection());
    pointCollectionRef.current = pointsCol;
    fragCollectionRef.current = fragCol;
    orbitPolylinesRef.current = polyCol;
    vectorPolylinesRef.current = vecCol;

    // Pre-allocate selected object's 3D vector triad (Velocity, Radial, Normal)
    const triadVel = vecCol.add({
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
      width: 3.5,
      show: false,
      material: Cesium.Material.fromType('PolylineArrow', {
        color: Cesium.Color.fromCssColorString('#22d3ee'),
      }),
    });
    const triadRad = vecCol.add({
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
      width: 2.0,
      show: false,
      material: Cesium.Material.fromType('Color', {
        color: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.9),
      }),
    });
    const triadNorm = vecCol.add({
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
      width: 2.0,
      show: false,
      material: Cesium.Material.fromType('Color', {
        color: Cesium.Color.fromCssColorString('#a78bfa').withAlpha(0.9),
      }),
    });
    triadPolylinesRef.current = { velocity: triadVel, radial: triadRad, normal: triadNorm };

    // Pre-allocate 140 reusable velocity field vector arrows
    const fieldPool: Cesium.Polyline[] = [];
    for (let i = 0; i < 140; i++) {
      fieldPool.push(
        vecCol.add({
          positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
          width: 1.5,
          show: false,
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.62),
          }),
        })
      );
    }
    fieldVectorPoolRef.current = fieldPool;

    // Initial overview camera position
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(20, 22, 18_500_000),
    });

    // Pointer picking for object hover & selection + optional 2-click region box draw
    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    const scratchPick = new Cesium.Cartesian2();

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (drawModeRef.current) {
        scene.canvas.style.cursor = 'crosshair';
        onHoverRef.current(null);
        return;
      }

      const picked = scene.pick(movement.endPosition);
      if (picked && picked.primitive && picked.id && typeof picked.id.noradId === 'number') {
        const noradId = picked.id.noradId as number;
        const obj = catalogByNoradRef.current.get(noradId);
        if (obj) {
          scene.canvas.style.cursor = 'pointer';
          const idx = noradIndexMapRef.current.get(noradId);
          const buf = positionsRef.current;
          let telemetry: LiveTelemetrySnapshot | null = null;
          if (idx !== undefined && buf && idx * 10 + 9 < buf.length) {
            const base = idx * 10;
            if (Number.isFinite(buf[base])) {
              telemetry = {
                noradId,
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
          onHoverRef.current({
            obj,
            telemetry,
            x: movement.endPosition.x,
            y: movement.endPosition.y,
          });
          return;
        }
      }
      scene.canvas.style.cursor = 'grab';
      onHoverRef.current(null);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawModeRef.current) {
        const ray = viewer.camera.getPickRay(click.position);
        const cartesian = ray ? scene.globe.pick(ray, scene) : undefined;
        if (!cartesian) return;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Number(Cesium.Math.toDegrees(carto.latitude).toFixed(2));
        const lon = Number(Cesium.Math.toDegrees(carto.longitude).toFixed(2));
        if (!firstCornerRef.current) {
          firstCornerRef.current = { lat, lon };
        } else {
          const a = firstCornerRef.current;
          firstCornerRef.current = null;
          onRegionDrawnRef.current({
            name: 'Custom Drawn Region',
            minLat: Math.min(a.lat, lat),
            maxLat: Math.max(a.lat, lat),
            minLon: Math.min(a.lon, lon),
            maxLon: Math.max(a.lon, lon),
          });
        }
        return;
      }

      scratchPick.x = click.position.x;
      scratchPick.y = click.position.y;
      const picked = scene.pick(scratchPick);
      if (picked && picked.id && typeof picked.id.noradId === 'number') {
        onSelectRef.current(picked.id.noradId as number);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Per-frame synchronization loop: updates PointPrimitive positions from transferable Float32Array
    const scratchPos = new Cesium.Cartesian3();
    const removePreRender = scene.preRender.addEventListener(() => {
      const buf = positionsRef.current;
      const pool = pointPoolRef.current;
      const visSet = visibleSetRef.current;
      const selId = selectedNoradRef.current;

      const idxMap = noradIndexMapRef.current;
      const triad = triadPolylinesRef.current;
      const fieldPool = fieldVectorPoolRef.current;
      const showVec = showVectorRef.current;

      if (buf && pool.length > 0 && idxMap.size > 0) {
        const stride = 10;
        let fieldCursor = 0;
        const fieldStep = Math.max(1, Math.floor(pool.length / 140));

        for (let i = 0; i < pool.length; i++) {
          const pt = pool[i];
          const noradId = pt.id?.noradId as number | undefined;
          const idx = noradId !== undefined ? idxMap.get(noradId) : undefined;
          const base = idx !== undefined ? idx * stride : -1;
          const x = base >= 0 && base + 9 < buf.length ? buf[base] : Number.NaN;
          const visible =
            noradId !== undefined &&
            (visSet.has(noradId) || noradId === selId) &&
            Number.isFinite(x);

          if (visible) {
            const y = buf[base + 1];
            const z = buf[base + 2];
            Cesium.Cartesian3.fromElements(x, y, z, scratchPos);
            pt.position = scratchPos;
            pt.pixelSize = noradId === selId ? 9.5 : pt.id?.baseSize ?? 4.0;
            pt.outlineWidth = noradId === selId ? 2 : 0;
            pt.show = true;

            const vx = buf[base + 7];
            const vy = buf[base + 8];
            const vz = buf[base + 9];
            const vMag = Math.hypot(vx, vy, vz);

            // Update selected object's live 3D RTN + Velocity vector triad
            if (noradId === selId && triad && vMag > 0.01) {
              const velLenMeters = 1_900_000;
              const rMag = Math.hypot(x, y, z) || 1;
              const rx = x / rMag;
              const ry = y / rMag;
              const rz = z / rMag;

              const vnx = vx / vMag;
              const vny = vy / vMag;
              const vnz = vz / vMag;

              const hx = ry * vnz - rz * vny;
              const hy = rz * vnx - rx * vnz;
              const hz = rx * vny - ry * vnx;
              const hMag = Math.hypot(hx, hy, hz) || 1;

              const p0 = new Cesium.Cartesian3(x, y, z);
              triad.velocity.positions = [
                p0,
                new Cesium.Cartesian3(
                  x + vnx * velLenMeters,
                  y + vny * velLenMeters,
                  z + vnz * velLenMeters
                ),
              ];
              triad.velocity.show = true;

              const triadLen = 1_150_000;
              triad.radial.positions = [
                p0,
                new Cesium.Cartesian3(x + rx * triadLen, y + ry * triadLen, z + rz * triadLen),
              ];
              triad.radial.show = showVec;

              triad.normal.positions = [
                p0,
                new Cesium.Cartesian3(
                  x + (hx / hMag) * triadLen,
                  y + (hy / hMag) * triadLen,
                  z + (hz / hMag) * triadLen
                ),
              ];
              triad.normal.show = showVec;
            }

            // Populate global velocity vector field needles when Vector Overlay is ON
            if (showVec && i % fieldStep === 0 && fieldCursor < fieldPool.length && vMag > 0.01) {
              const scaleM = 85_000; // ~650km needle for ~7.6 km/s LEO object
              const line = fieldPool[fieldCursor++];
              line.positions = [
                new Cesium.Cartesian3(x, y, z),
                new Cesium.Cartesian3(x + vx * scaleM, y + vy * scaleM, z + vz * scaleM),
              ];
              line.show = true;
            }
          } else {
            pt.show = false;
          }
        }

        if (selId === null && triad) {
          triad.velocity.show = false;
          triad.radial.show = false;
          triad.normal.show = false;
        }
        for (let f = fieldCursor; f < fieldPool.length; f++) {
          fieldPool[f].show = false;
        }
      } else {
        if (triad) {
          triad.velocity.show = false;
          triad.radial.show = false;
          triad.normal.show = false;
        }
        for (let f = 0; f < fieldPool.length; f++) {
          fieldPool[f].show = false;
        }
      }

      const fragBuf = fragmentPositionsRef.current;
      const fragPool = fragPoolRef.current;
      if (fragBuf && fragPool.length > 0) {
        const maxFrag = Math.min(fragPool.length, Math.floor(fragBuf.length / 3));
        for (let i = 0; i < fragPool.length; i++) {
          const pt = fragPool[i];
          if (i < maxFrag) {
            const x = fragBuf[i * 3];
            if (Number.isFinite(x)) {
              Cesium.Cartesian3.fromElements(
                x,
                fragBuf[i * 3 + 1],
                fragBuf[i * 3 + 2],
                scratchPos
              );
              pt.position = scratchPos;
              pt.show = true;
            } else {
              pt.show = false;
            }
          } else {
            pt.show = false;
          }
        }
      }
    });

    return () => {
      removePreRender();
      handler.destroy();
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      pointCollectionRef.current = null;
      fragCollectionRef.current = null;
      orbitPolylinesRef.current = null;
      vectorPolylinesRef.current = null;
      triadPolylinesRef.current = null;
      fieldVectorPoolRef.current = [];
    };
  }, []);

  // Build/sync PointPrimitive pool whenever catalog changes
  useEffect(() => {
    const col = pointCollectionRef.current;
    if (!col) return;
    col.removeAll();
    const pool: Cesium.PointPrimitive[] = [];

    for (const item of catalog) {
      const color = Cesium.Color.fromCssColorString(CLASS_COLORS_CSS[item.objectClass]);
      const baseSize = item.objectClass === 'STATION' ? 7 : item.objectClass === 'EO' ? 4.8 : 3.8;
      const pt = col.add({
        position: new Cesium.Cartesian3(7_000_000, 0, 0),
        color,
        pixelSize: baseSize,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 0,
        show: false,
        id: { noradId: item.noradId, baseSize },
      });
      pool.push(pt);
    }
    pointPoolRef.current = pool;
  }, [catalog]);

  // Build/sync orange fragmentation PointPrimitive pool
  useEffect(() => {
    const fragCol = fragCollectionRef.current;
    if (!fragCol) return;
    fragCol.removeAll();
    const pool: Cesium.PointPrimitive[] = [];
    const buf = fragmentPositionsRef.current;
    const count = buf ? Math.floor(buf.length / 3) : 0;
    const orange = Cesium.Color.fromCssColorString('#fb923c');
    for (let i = 0; i < count; i++) {
      pool.push(
        fragCol.add({
          position: new Cesium.Cartesian3(7_000_000, 0, 0),
          color: orange,
          pixelSize: 4.5,
          show: false,
        })
      );
    }
    fragPoolRef.current = pool;
  }, [fragmentVersion, fragmentPositionsRef]);

  // Swap free base imagery layer (NASA GIBS Blue Marble / OpenStreetMap Dark / NASA Night Lights)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.imageryLayers.removeAll();

    if (imageryMode === 'osm-dark') {
      const osm = new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      });
      const layer = viewer.imageryLayers.addImageryProvider(osm);
      layer.brightness = 0.28;
      layer.contrast = 1.25;
      layer.saturation = 0.35;
    } else if (imageryMode === 'gibs-night') {
      const night = new Cesium.UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
        maximumLevel: 8,
        credit: 'NASA GIBS VIIRS',
      });
      const layer = viewer.imageryLayers.addImageryProvider(night);
      layer.brightness = 1.05;
      layer.contrast = 1.1;
    } else {
      const gibs = new Cesium.UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
        maximumLevel: 8,
        credit: 'NASA GIBS',
      });
      const layer = viewer.imageryLayers.addImageryProvider(gibs);
      layer.brightness = 0.62;
      layer.contrast = 1.18;
      layer.saturation = 0.72;
    }
  }, [imageryMode]);

  // Draw orbit polyline(s) for selected object and active conjunction secondary
  useEffect(() => {
    const polyCol = orbitPolylinesRef.current;
    if (!polyCol) return;
    polyCol.removeAll();

    if (selectedObject) {
      const flat = computeNextPeriodOrbitCartesianMeters(
        selectedObject.omm,
        simTimeMs,
        selectedObject.periodMin,
        112
      );
      const positions: Cesium.Cartesian3[] = [];
      for (let i = 0; i < flat.length; i += 3) {
        positions.push(new Cesium.Cartesian3(flat[i], flat[i + 1], flat[i + 2]));
      }
      if (positions.length > 1) {
        polyCol.add({
          positions,
          width: 2.0,
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.85),
          }),
        });
      }
    }

    if (activeConjunction) {
      const sec = catalogByNoradRef.current.get(activeConjunction.secondaryNoradId);
      if (sec) {
        const flatSec = computeNextPeriodOrbitCartesianMeters(
          sec.omm,
          simTimeMs,
          sec.periodMin,
          112
        );
        const positionsSec: Cesium.Cartesian3[] = [];
        for (let i = 0; i < flatSec.length; i += 3) {
          positionsSec.push(new Cesium.Cartesian3(flatSec[i], flatSec[i + 1], flatSec[i + 2]));
        }
        if (positionsSec.length > 1) {
          polyCol.add({
            positions: positionsSec,
            width: 2.0,
            material: Cesium.Material.fromType('Color', {
              color: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.9),
            }),
          });
        }
      }
    }
  }, [selectedObject, activeConjunction, Math.floor(simTimeMs / 60_000)]);

  // Region Overflight lat/lon rectangle overlay
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (regionEntityRef.current) {
      viewer.entities.remove(regionEntityRef.current);
      regionEntityRef.current = null;
    }
    if (regionBox) {
      regionEntityRef.current = viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            regionBox.minLon,
            regionBox.minLat,
            regionBox.maxLon,
            regionBox.maxLat
          ),
          material: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.14),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#34d399'),
          outlineWidth: 2,
          height: 15_000,
        },
      });
    }
  }, [regionBox]);

  // Optional 800 km Kessler Peak Debris Density Shell / Heatmap Ring
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    for (const ent of densityEntityRef.current) {
      viewer.entities.remove(ent);
    }
    densityEntityRef.current = [];
    if (showDensityHeatmap) {
      densityEntityRef.current.push(
        viewer.entities.add({
          position: Cesium.Cartesian3.ZERO,
          ellipsoid: {
            radii: new Cesium.Cartesian3(7_171_000, 7_171_000, 7_171_000),
            fill: false,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.24),
            slicePartitions: 24,
            stackPartitions: 18,
          },
        })
      );
    }
  }, [showDensityHeatmap]);

  // Fly camera to selected target / conjunction TCA
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !flyRequest) return;
    const camAltMeters = Math.max(2_200_000, (flyRequest.altKm + 2600) * 1000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        flyRequest.lonDeg,
        flyRequest.latDeg,
        camAltMeters
      ),
      duration: 1.1,
    });
  }, [flyRequest]);

  // Reset global view
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || resetViewNonce === 0) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(20, 22, 18_500_000),
      duration: 1.0,
    });
  }, [resetViewNonce]);

  return (
    <div className="relative w-full h-full bg-[#03050a]">
      <div ref={containerRef} className="w-full h-full" aria-label="DEBRISWATCH Cesium 3D Globe" />
      <div ref={creditRef} className="hidden" aria-hidden="true" />
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#03050a] p-6 z-20">
          <div className="max-w-md border border-white/10 bg-[#080C15] rounded-xl p-5 text-center">
            <h2 className="font-display text-base font-semibold text-white">
              Cesium WebGL Unavailable
            </h2>
            <p className="mt-2 text-xs text-slate-400">{webglError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
