import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as satellite from 'satellite.js';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landAtlas from 'world-atlas/land-50m.json';
import countriesAtlas from 'world-atlas/countries-110m.json';
import { GROUND_STATIONS } from '../data/tleCatalog.ts';
import type {
  CompiledOrbitalObject,
  ConjunctionEvent,
  GlobeBasemapStyle,
  LayerVisibility,
  OrbitalHotspot,
  PropagatedState,
} from '../types/orbital.ts';
import {
  computeOrbitGroundTrackSegments,
  computeShellIntelligence,
  propagateObjectAtDate,
} from '../utils/orbitalMath.ts';
import type { CameraFlyTarget } from './OrbitalGlobeCanvas.tsx';

interface OrbitalMap2DProps {
  objects: CompiledOrbitalObject[];
  conjunctions: ConjunctionEvent[];
  selectedId: number | null;
  selectedStationId: string | null;
  activeHotspot: OrbitalHotspot | null;
  flyRequest: CameraFlyTarget | null;
  timeScale: number;
  paused: boolean;
  layers: LayerVisibility;
  basemapStyle: GlobeBasemapStyle;
  onSelectObject: (noradId: number | null) => void;
  onSelectStation: (stationId: string) => void;
  onTelemetryTick: (
    simTime: Date,
    selectedState: PropagatedState | null,
    visibleCount: number
  ) => void;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function OrbitalMap2D({
  objects,
  conjunctions,
  selectedId,
  selectedStationId,
  activeHotspot,
  flyRequest,
  timeScale,
  paused,
  layers,
  basemapStyle,
  onSelectObject,
  onSelectStation,
  onTelemetryTick,
}: OrbitalMap2DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const objectsRef = useRef(objects);
  const conjunctionsRef = useRef(conjunctions);
  const selectedIdRef = useRef(selectedId);
  const selectedStationIdRef = useRef(selectedStationId);
  const timeScaleRef = useRef(timeScale);
  const pausedRef = useRef(paused);
  const layersRef = useRef(layers);
  const basemapStyleRef = useRef(basemapStyle);
  const onSelectObjectRef = useRef(onSelectObject);
  const onSelectStationRef = useRef(onSelectStation);
  const onTickRef = useRef(onTelemetryTick);

  objectsRef.current = objects;
  conjunctionsRef.current = conjunctions;
  selectedIdRef.current = selectedId;
  selectedStationIdRef.current = selectedStationId;
  timeScaleRef.current = timeScale;
  pausedRef.current = paused;
  layersRef.current = layers;
  basemapStyleRef.current = basemapStyle;
  onSelectObjectRef.current = onSelectObject;
  onSelectStationRef.current = onSelectStation;
  onTickRef.current = onTelemetryTick;

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

    const stationFeatures: GeoJSON.Feature<GeoJSON.Point>[] = GROUND_STATIONS.map((st) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [st.lonDeg, st.latDeg] },
      properties: {
        id: st.id,
        code: st.code,
        name: st.name,
        isOptical: st.sensorType.includes('Optical') ? 1 : 0,
        selected: st.id === selectedStationIdRef.current ? 1 : 0,
      },
    }));

    const map = new maplibregl.Map({
      container: host,
      center: [12, 22],
      zoom: 1.75,
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
          'convergence-zones': { type: 'geojson', data: EMPTY_FC },
          'ground-tracks': { type: 'geojson', data: EMPTY_FC },
          'conjunction-arcs': { type: 'geojson', data: EMPTY_FC },
          'ground-stations': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: stationFeatures },
          },
          'debris-points': { type: 'geojson', data: EMPTY_FC },
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#060a14' },
          },
          {
            id: 'esri-sat-layer',
            type: 'raster',
            source: 'esri-satellite',
            layout: {
              visibility: basemapStyleRef.current === 'esri-satellite' ? 'visible' : 'none',
            },
            paint: { 'raster-opacity': 0.84, 'raster-brightness-max': 0.85 },
          },
          {
            id: 'land-fill',
            type: 'fill',
            source: 'world-land',
            layout: {
              visibility: basemapStyleRef.current === 'dark-vector' ? 'visible' : 'none',
            },
            paint: { 'fill-color': '#141d2e' },
          },
          {
            id: 'country-borders',
            type: 'line',
            source: 'world-countries',
            paint: { 'line-color': 'rgba(148, 163, 184, 0.22)', 'line-width': 0.8 },
          },
          {
            id: 'land-coastline',
            type: 'line',
            source: 'world-land',
            paint: { 'line-color': 'rgba(56, 189, 248, 0.45)', 'line-width': 1.1 },
          },
          {
            id: 'convergence-polygons',
            type: 'fill',
            source: 'convergence-zones',
            paint: {
              'fill-color': '#ef4444',
              'fill-opacity': 0.14,
            },
          },
          {
            id: 'convergence-outlines',
            type: 'line',
            source: 'convergence-zones',
            paint: {
              'line-color': 'rgba(239, 68, 68, 0.6)',
              'line-width': 1.2,
              'line-dasharray': [3, 2],
            },
          },
          {
            id: 'ground-track-lines',
            type: 'line',
            source: 'ground-tracks',
            paint: {
              'line-color': '#22d3ee',
              'line-width': 2.0,
              'line-opacity': 0.88,
            },
          },
          {
            id: 'conjunction-lines',
            type: 'line',
            source: 'conjunction-arcs',
            paint: {
              'line-color': '#f43f5e',
              'line-width': 1.4,
              'line-opacity': 0.72,
              'line-dasharray': [2, 2],
            },
          },
          {
            id: 'ground-station-circles',
            type: 'circle',
            source: 'ground-stations',
            paint: {
              'circle-radius': [
                'case',
                ['==', ['get', 'selected'], 1],
                8.5,
                5.5,
              ],
              'circle-color': [
                'case',
                ['==', ['get', 'isOptical'], 1],
                '#22d3ee',
                '#f59e0b',
              ],
              'circle-stroke-color': '#05070c',
              'circle-stroke-width': 1.5,
            },
          },
          {
            id: 'debris-circles',
            type: 'circle',
            source: 'debris-points',
            paint: {
              'circle-radius': [
                'case',
                ['==', ['get', 'selected'], 1],
                7.5,
                ['==', ['get', 'rcsSize'], 'LARGE'],
                4.8,
                3.3,
              ],
              'circle-color': [
                'match',
                ['get', 'category'],
                'FRAGMENTATION',
                '#ef4444',
                'ROCKET_BODY',
                '#f59e0b',
                'PAYLOAD',
                '#38bdf8',
                'STATION',
                '#34d399',
                '#94a3b8',
              ],
              'circle-stroke-color': [
                'case',
                ['==', ['get', 'selected'], 1],
                '#ffffff',
                'rgba(5, 7, 12, 0.7)',
              ],
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.0, 0.8],
            },
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('click', 'debris-circles', (e: maplibregl.MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      const norad = Number(feat?.properties?.noradId);
      if (Number.isFinite(norad)) {
        onSelectObjectRef.current(norad);
      }
    });

    map.on('click', 'ground-station-circles', (e: maplibregl.MapLayerMouseEvent) => {
      const feat = e.features?.[0];
      const stId = feat?.properties?.id;
      if (typeof stId === 'string') {
        onSelectStationRef.current(stId);
      }
    });

    map.on('mouseenter', 'debris-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'debris-circles', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'ground-station-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'ground-station-circles', () => {
      map.getCanvas().style.cursor = '';
    });

    let simTimeMs = Date.now();
    let lastStepMs = performance.now();
    let disposed = false;

    const updateSimulation = () => {
      if (disposed || !map.isStyleLoaded()) return;
      const nowPerf = performance.now();
      const dt = Math.min((nowPerf - lastStepMs) / 1000, 0.25);
      lastStepMs = nowPerf;

      if (!pausedRef.current) {
        simTimeMs += dt * 1000 * timeScaleRef.current;
      }
      const simDate = new Date(simTimeMs);
      const gmst = satellite.gstime(simDate);
      const activeLayers = layersRef.current;
      const selId = selectedIdRef.current;

      const pointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
      const posByNorad = new Map<number, [number, number]>();
      let selectedState: PropagatedState | null = null;
      let selectedObj: CompiledOrbitalObject | null = null;

      for (const obj of objectsRef.current) {
        const visible =
          (obj.category === 'FRAGMENTATION' && activeLayers.fragmentation) ||
          (obj.category === 'ROCKET_BODY' && activeLayers.rocketBodies) ||
          ((obj.category === 'PAYLOAD' || obj.category === 'STATION') && activeLayers.payloads) ||
          obj.noradId === selId;
        if (!visible) continue;

        const st = propagateObjectAtDate(obj, simDate, gmst);
        if (!st) continue;
        posByNorad.set(obj.noradId, [st.lonDeg, st.latDeg]);

        const isSel = obj.noradId === selId;
        if (isSel) {
          selectedState = st;
          selectedObj = obj;
        }

        pointFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [st.lonDeg, st.latDeg] },
          properties: {
            noradId: obj.noradId,
            category: obj.category,
            rcsSize: obj.rcsSize,
            selected: isSel ? 1 : 0,
          },
        });
      }

      const debrisSrc = map.getSource('debris-points') as maplibregl.GeoJSONSource | undefined;
      debrisSrc?.setData({ type: 'FeatureCollection', features: pointFeatures });

      // Selected Orbit Ground Track
      const trackFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (selectedObj && activeLayers.orbitTrack) {
        const segments = computeOrbitGroundTrackSegments(selectedObj, simDate, 96);
        for (const coords of segments) {
          trackFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { noradId: selectedObj.noradId },
          });
        }
      }
      const trackSrc = map.getSource('ground-tracks') as maplibregl.GeoJSONSource | undefined;
      trackSrc?.setData({ type: 'FeatureCollection', features: trackFeatures });

      // Conjunction Hazard Lines
      const cdmFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      if (activeLayers.conjunctionArcs) {
        for (const cdm of conjunctionsRef.current.slice(0, 12)) {
          const a = posByNorad.get(cdm.primaryNoradId);
          const b = posByNorad.get(cdm.secondaryNoradId);
          if (!a || !b || Math.abs(a[0] - b[0]) > 170) continue;
          cdmFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [a, b] },
            properties: { id: cdm.id },
          });
        }
      }
      const cdmSrc = map.getSource('conjunction-arcs') as maplibregl.GeoJSONSource | undefined;
      cdmSrc?.setData({ type: 'FeatureCollection', features: cdmFeatures });

      // Convergence Risk Polygons (when Kessler Shell / hazard overlay is enabled)
      const convFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
      if (activeLayers.kesslerBands || activeLayers.conjunctionArcs) {
        const { convergences } = computeShellIntelligence(
          objectsRef.current,
          conjunctionsRef.current
        );
        for (const conv of convergences) {
          const dLon = 11;
          const dLat = 6.5;
          convFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [conv.lonDeg - dLon, conv.latDeg - dLat],
                  [conv.lonDeg + dLon, conv.latDeg - dLat],
                  [conv.lonDeg + dLon, conv.latDeg + dLat],
                  [conv.lonDeg - dLon, conv.latDeg + dLat],
                  [conv.lonDeg - dLon, conv.latDeg - dLat],
                ],
              ],
            },
            properties: { id: conv.id, name: conv.name },
          });
        }
      }
      const convSrc = map.getSource('convergence-zones') as maplibregl.GeoJSONSource | undefined;
      convSrc?.setData({ type: 'FeatureCollection', features: convFeatures });

      onTickRef.current(simDate, selectedState, pointFeatures.length);
    };

    map.on('load', updateSimulation);
    const intervalId = window.setInterval(updateSimulation, 240);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync Basemap Style (CARTO Dark Vector vs Esri Satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty(
      'esri-sat-layer',
      'visibility',
      basemapStyle === 'esri-satellite' ? 'visible' : 'none'
    );
    map.setLayoutProperty(
      'land-fill',
      'visibility',
      basemapStyle === 'dark-vector' ? 'visible' : 'none'
    );
  }, [basemapStyle]);

  // Sync Ground Station selection highlight & visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const stSrc = map.getSource('ground-stations') as maplibregl.GeoJSONSource | undefined;
    if (stSrc) {
      stSrc.setData({
        type: 'FeatureCollection',
        features: GROUND_STATIONS.map((st) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [st.lonDeg, st.latDeg] },
          properties: {
            id: st.id,
            code: st.code,
            name: st.name,
            isOptical: st.sensorType.includes('Optical') ? 1 : 0,
            selected: st.id === selectedStationId ? 1 : 0,
          },
        })),
      });
    }
    map.setLayoutProperty(
      'ground-station-circles',
      'visibility',
      layers.groundStations ? 'visible' : 'none'
    );
    map.setLayoutProperty(
      'convergence-polygons',
      'visibility',
      layers.kesslerBands || layers.conjunctionArcs ? 'visible' : 'none'
    );
    map.setLayoutProperty(
      'convergence-outlines',
      'visibility',
      layers.kesslerBands || layers.conjunctionArcs ? 'visible' : 'none'
    );
  }, [selectedStationId, layers.groundStations, layers.kesslerBands, layers.conjunctionArcs]);

  // Fly MapLibre camera when user clicks a target, station, or hotspot
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyRequest) return;

    if (flyRequest.id === 'global-reset') {
      map.flyTo({ center: [12, 22], zoom: 1.75, duration: 900 });
      return;
    }

    if (selectedStationId) {
      const st = GROUND_STATIONS.find((s) => s.id === selectedStationId);
      if (st) {
        map.flyTo({ center: [st.lonDeg, st.latDeg], zoom: 4.2, duration: 900 });
        return;
      }
    }

    if (selectedId) {
      const obj = objects.find((o) => o.noradId === selectedId);
      if (obj) {
        const now = new Date();
        const st = propagateObjectAtDate(obj, now, satellite.gstime(now));
        if (st) {
          map.flyTo({ center: [st.lonDeg, st.latDeg], zoom: 3.4, duration: 900 });
          return;
        }
      }
    }

    if (activeHotspot) {
      map.flyTo({
        center: [activeHotspot.cameraLon, activeHotspot.cameraLat],
        zoom: 3.1,
        duration: 900,
      });
    }
  }, [flyRequest, selectedId, selectedStationId, activeHotspot, objects]);

  return (
    <div className="relative w-full h-full bg-[#060a14]">
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-label="Interactive 2D MapLibre Orbital Ground Track Map"
      />
      <div className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] font-mono text-slate-500">
        {basemapStyle === 'esri-satellite'
          ? 'MapLibre GL · Esri World Imagery (Proxied)'
          : 'MapLibre GL · Dark Vector Cartography · World Atlas'}
      </div>
    </div>
  );
}
