import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landAtlas from 'world-atlas/land-50m.json';
import countriesAtlas from 'world-atlas/countries-110m.json';
import type {
  BaseImageryMode,
  CatalogObject,
  ConjunctionCandidate,
  RegionBox,
} from '../types/debriswatch.ts';
import { computeVectorGroundTrackSegments } from '../utils/orbitMath.ts';
import type { CameraTargetRequest } from './CesiumGlobe.tsx';

interface VectorMap2DProps {
  catalog: CatalogObject[];
  visibleNoradIds: Set<number>;
  positionsRef: React.MutableRefObject<Float32Array | null>;
  noradIndexMapRef: React.MutableRefObject<Map<number, number>>;
  selectedObject: CatalogObject | null;
  activeConjunction: ConjunctionCandidate | null;
  simTimeMs: number;
  imageryMode: BaseImageryMode;
  showVectorOverlay: boolean;
  regionBox: RegionBox | null;
  drawRegionMode: boolean;
  flyRequest: CameraTargetRequest | null;
  resetViewNonce: number;
  onSelectObject: (noradId: number | null) => void;
  onRegionDrawn: (box: RegionBox) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export default function VectorMap2D({
  catalog,
  visibleNoradIds,
  positionsRef,
  noradIndexMapRef,
  selectedObject,
  activeConjunction,
  simTimeMs,
  imageryMode,
  showVectorOverlay,
  regionBox,
  drawRegionMode,
  flyRequest,
  resetViewNonce,
  onSelectObject,
  onRegionDrawn,
}: VectorMap2DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const catalogRef = useRef(catalog);
  const visibleSetRef = useRef(visibleNoradIds);
  const selectedRef = useRef(selectedObject);
  const activeConjRef = useRef(activeConjunction);
  const simTimeRef = useRef(simTimeMs);
  const showVecRef = useRef(showVectorOverlay);
  const drawModeRef = useRef(drawRegionMode);
  const firstCornerRef = useRef<{ lat: number; lon: number } | null>(null);
  const onSelectRef = useRef(onSelectObject);
  const onRegionDrawnRef = useRef(onRegionDrawn);

  catalogRef.current = catalog;
  visibleSetRef.current = visibleNoradIds;
  selectedRef.current = selectedObject;
  activeConjRef.current = activeConjunction;
  simTimeRef.current = simTimeMs;
  showVecRef.current = showVectorOverlay;
  drawModeRef.current = drawRegionMode;
  onSelectRef.current = onSelectObject;
  onRegionDrawnRef.current = onRegionDrawn;

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const landTopo = landAtlas as unknown as Topology;
    const landGeo = feature(landTopo, landTopo.objects.land) as unknown as GeoJSON.GeoJSON;
    const countriesTopo = countriesAtlas as unknown as Topology;
    const countriesGeo = feature(
      countriesTopo,
      countriesTopo.objects.countries
    ) as unknown as GeoJSON.GeoJSON;

    const map = new maplibregl.Map({
      container: host,
      center: [12, 20],
      zoom: 1.65,
      minZoom: 1.0,
      maxZoom: 8.5,
      renderWorldCopies: true,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          'world-land': { type: 'geojson', data: landGeo },
          'world-countries': { type: 'geojson', data: countriesGeo },
          'esri-satellite': {
            type: 'raster',
            tiles: ['/api/basemap/esri/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 4,
          },
          'region-aoi': { type: 'geojson', data: EMPTY_FC },
          'ground-tracks': { type: 'geojson', data: EMPTY_FC },
          'conjunction-arcs': { type: 'geojson', data: EMPTY_FC },
          'velocity-vectors': { type: 'geojson', data: EMPTY_FC },
          'debris-points': { type: 'geojson', data: EMPTY_FC },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#050811' },
          },
          {
            id: 'esri-sat-layer',
            type: 'raster',
            source: 'esri-satellite',
            layout: {
              visibility: imageryMode === 'gibs-blue-marble' ? 'visible' : 'none',
            },
            paint: { 'raster-opacity': 0.55, 'raster-brightness-max': 0.72 },
          },
          {
            id: 'land-fill',
            type: 'fill',
            source: 'world-land',
            layout: {
              visibility: imageryMode === 'gibs-blue-marble' ? 'none' : 'visible',
            },
            paint: { 'fill-color': '#0e1626' },
          },
          {
            id: 'country-borders',
            type: 'line',
            source: 'world-countries',
            paint: { 'line-color': 'rgba(148, 163, 184, 0.2)', 'line-width': 0.7 },
          },
          {
            id: 'land-coastline',
            type: 'line',
            source: 'world-land',
            paint: { 'line-color': 'rgba(34, 211, 238, 0.35)', 'line-width': 1.0 },
          },
          {
            id: 'region-aoi-fill',
            type: 'fill',
            source: 'region-aoi',
            paint: { 'fill-color': '#34d399', 'fill-opacity': 0.14 },
          },
          {
            id: 'region-aoi-line',
            type: 'line',
            source: 'region-aoi',
            paint: { 'line-color': '#34d399', 'line-width': 1.6 },
          },
          {
            id: 'ground-track-lines',
            type: 'line',
            source: 'ground-tracks',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'isSecondary'], 1],
                '#f43f5e',
                '#22d3ee',
              ],
              'line-width': 2.0,
              'line-opacity': 0.9,
            },
          },
          {
            id: 'conjunction-lines',
            type: 'line',
            source: 'conjunction-arcs',
            paint: {
              'line-color': '#f59e0b',
              'line-width': 1.6,
              'line-dasharray': [2, 2],
            },
          },
          {
            id: 'velocity-vector-lines',
            type: 'line',
            source: 'velocity-vectors',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'selected'], 1],
                '#22d3ee',
                'rgba(56, 189, 248, 0.72)',
              ],
              'line-width': ['case', ['==', ['get', 'selected'], 1], 2.6, 1.3],
            },
          },
          {
            id: 'debris-circles',
            type: 'circle',
            source: 'debris-points',
            paint: {
              'circle-radius': ['case', ['==', ['get', 'selected'], 1], 6.5, 3.2],
              'circle-color': [
                'match',
                ['get', 'objectClass'],
                'DEBRIS',
                '#ef4444',
                'ACTIVE',
                '#22d3ee',
                'EO',
                '#34d399',
                'STATION',
                '#fbbf24',
                '#94a3b8',
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.0, 0],
            },
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      if (drawModeRef.current) {
        const lat = Number(e.lngLat.lat.toFixed(2));
        const lon = Number(e.lngLat.lng.toFixed(2));
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

      const hits = map.queryRenderedFeatures(e.point, { layers: ['debris-circles'] });
      const norad = Number(hits[0]?.properties?.noradId);
      if (Number.isFinite(norad)) {
        onSelectRef.current(norad);
      }
    });

    map.on('mouseenter', 'debris-circles', () => {
      map.getCanvas().style.cursor = drawModeRef.current ? 'crosshair' : 'pointer';
    });
    map.on('mouseleave', 'debris-circles', () => {
      map.getCanvas().style.cursor = drawModeRef.current ? 'crosshair' : '';
    });

    let disposed = false;
    const syncLayers = () => {
      if (disposed || !map.isStyleLoaded()) return;
      const buf = positionsRef.current;
      const idxMap = noradIndexMapRef.current;
      const vis = visibleSetRef.current;
      const sel = selectedRef.current;
      const selId = sel?.noradId ?? null;
      const list = catalogRef.current;

      const ptFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
      const vecFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const coordByNorad = new Map<number, [number, number]>();

      if (buf && idxMap.size > 0) {
        const stride = 10;
        const maxDrawPoints = 2200;
        const step = Math.max(1, Math.floor(list.length / maxDrawPoints));
        const vecStep = Math.max(1, Math.floor(list.length / 160));

        for (let i = 0; i < list.length; i++) {
          const obj = list[i];
          const isSel = obj.noradId === selId;
          if (!isSel && !vis.has(obj.noradId)) continue;
          if (!isSel && i % step !== 0 && ptFeatures.length >= maxDrawPoints) continue;

          const idx = idxMap.get(obj.noradId);
          if (idx === undefined) continue;
          const base = idx * stride;
          if (base + 9 >= buf.length || !Number.isFinite(buf[base])) continue;

          const lat = buf[base + 3];
          const lon = buf[base + 4];
          coordByNorad.set(obj.noradId, [lon, lat]);

          ptFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
              noradId: obj.noradId,
              objectClass: obj.objectClass,
              selected: isSel ? 1 : 0,
            },
          });

          if ((isSel || (showVecRef.current && i % vecStep === 0)) && vecFeatures.length < 180) {
            const vx = buf[base + 7];
            const vy = buf[base + 8];
            const vz = buf[base + 9];
            const latRad = (lat * Math.PI) / 180;
            const lonRad = (lon * Math.PI) / 180;
            const vEast = -Math.sin(lonRad) * vx + Math.cos(lonRad) * vy;
            const vNorth =
              -Math.sin(latRad) * Math.cos(lonRad) * vx -
              Math.sin(latRad) * Math.sin(lonRad) * vy +
              Math.cos(latRad) * vz;
            const vPlanar = Math.hypot(vEast, vNorth) || 1;
            const degScale = isSel ? 14 : 6.5;
            const dLon = (vEast / vPlanar) * degScale;
            const dLat = (vNorth / vPlanar) * degScale;
            const endLon = lon + dLon;
            const endLat = Math.max(-85, Math.min(85, lat + dLat));
            if (Math.abs(endLon - lon) < 120 && endLon >= -180 && endLon <= 180) {
              vecFeatures.push({
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [lon, lat],
                    [endLon, endLat],
                  ],
                },
                properties: { selected: isSel ? 1 : 0 },
              });
            }
          }
        }
      }

      const ptSrc = map.getSource('debris-points') as maplibregl.GeoJSONSource | undefined;
      ptSrc?.setData({ type: 'FeatureCollection', features: ptFeatures });

      const vecSrc = map.getSource('velocity-vectors') as maplibregl.GeoJSONSource | undefined;
      vecSrc?.setData({ type: 'FeatureCollection', features: vecFeatures });

      const trackFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (sel) {
        const segs = computeVectorGroundTrackSegments(sel.omm, simTimeRef.current, sel.periodMin, 96);
        for (const coords of segs) {
          trackFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { isSecondary: 0 },
          });
        }
      }
      const conj = activeConjRef.current;
      const conjArcFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (conj) {
        const sec = list.find((o) => o.noradId === conj.secondaryNoradId);
        if (sec) {
          const segsSec = computeVectorGroundTrackSegments(
            sec.omm,
            simTimeRef.current,
            sec.periodMin,
            96
          );
          for (const coords of segsSec) {
            trackFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords },
              properties: { isSecondary: 1 },
            });
          }
        }
        const a = coordByNorad.get(conj.primaryNoradId);
        const b = coordByNorad.get(conj.secondaryNoradId);
        if (a && b && Math.abs(a[0] - b[0]) < 170) {
          conjArcFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [a, b] },
            properties: {},
          });
        }
      }

      const trackSrc = map.getSource('ground-tracks') as maplibregl.GeoJSONSource | undefined;
      trackSrc?.setData({ type: 'FeatureCollection', features: trackFeatures });

      const conjSrc = map.getSource('conjunction-arcs') as maplibregl.GeoJSONSource | undefined;
      conjSrc?.setData({ type: 'FeatureCollection', features: conjArcFeatures });
    };

    map.on('load', syncLayers);
    const intervalId = window.setInterval(syncLayers, 200);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty(
      'esri-sat-layer',
      'visibility',
      imageryMode === 'gibs-blue-marble' ? 'visible' : 'none'
    );
    map.setLayoutProperty(
      'land-fill',
      'visibility',
      imageryMode === 'gibs-blue-marble' ? 'none' : 'visible'
    );
  }, [imageryMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('region-aoi') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!regionBox) {
      src.setData(EMPTY_FC);
    } else {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [regionBox.minLon, regionBox.minLat],
                  [regionBox.maxLon, regionBox.minLat],
                  [regionBox.maxLon, regionBox.maxLat],
                  [regionBox.minLon, regionBox.maxLat],
                  [regionBox.minLon, regionBox.minLat],
                ],
              ],
            },
            properties: { name: regionBox.name },
          },
        ],
      });
    }
  }, [regionBox]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyRequest) return;
    map.flyTo({ center: [flyRequest.lonDeg, flyRequest.latDeg], zoom: 3.4, duration: 900 });
  }, [flyRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || resetViewNonce === 0) return;
    map.flyTo({ center: [12, 20], zoom: 1.65, duration: 850 });
  }, [resetViewNonce]);

  return (
    <div className="relative w-full h-full bg-[#050811]">
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-label="DEBRISWATCH 2D MapLibre Vector Ground Track Map"
      />
    </div>
  );
}
