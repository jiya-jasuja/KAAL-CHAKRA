import * as THREE from 'three';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Geometry, MultiPolygon, Polygon } from 'geojson';
import landAtlas from 'world-atlas/land-50m.json';
import countriesAtlas from 'world-atlas/countries-110m.json';

export interface EarthTextureSet {
  albedoMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  cloudMap: THREE.CanvasTexture;
  dispose: () => void;
}

function hash2(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicNoise(u: number, v: number, freqX: number, freqY: number): number {
  const x = u * freqX;
  const y = v * freqY;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const ix0 = ((ix % freqX) + freqX) % freqX;
  const ix1 = (ix0 + 1) % freqX;
  const iy0 = iy;
  const iy1 = iy + 1;

  const a = hash2(ix0, iy0);
  const b = hash2(ix1, iy0);
  const c = hash2(ix0, iy1);
  const d = hash2(ix1, iy1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmPeriodic(u: number, v: number, baseFreqX: number, baseFreqY: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = baseFreqX;
  let fy = baseFreqY;
  for (let i = 0; i < octaves; i++) {
    value += amp * periodicNoise(u, v, fx, fy);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return value / norm;
}

function lonLatToXY(lon: number, lat: number, width: number, height: number): [number, number] {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

function tracePolygonRings(
  ctx: CanvasRenderingContext2D,
  rings: number[][][],
  width: number,
  height: number,
  mode: 'fill' | 'stroke'
) {
  for (const ring of rings) {
    ctx.beginPath();
    let prevLon: number | null = null;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        const [x, y] = lonLatToXY(lon, lat, width, height);
        ctx.moveTo(x, y);
      } else {
        const [x, y] = lonLatToXY(lon, lat, width, height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      prevLon = lon;
    }
    if (mode === 'fill') {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

function drawGeo(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  width: number,
  height: number,
  mode: 'fill' | 'stroke'
) {
  if (geometry.type === 'Polygon') {
    tracePolygonRings(ctx, (geometry as Polygon).coordinates, width, height, mode);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of (geometry as MultiPolygon).coordinates) {
      tracePolygonRings(ctx, poly, width, height, mode);
    }
  } else if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) {
      drawGeo(ctx, g, width, height, mode);
    }
  }
}

// Major metropolitan hubs [lon, lat, intensity] for crisp pinpoint tactical city lights
const CITY_NODES: Array<[number, number, number]> = [
  [-74.0, 40.7, 1.0], [-71.1, 42.3, 0.85], [-77.0, 38.9, 0.9], [-87.6, 41.8, 0.95],
  [-79.4, 43.6, 0.85], [-84.4, 33.7, 0.8], [-95.4, 29.7, 0.85], [-96.8, 32.8, 0.85],
  [-118.2, 34.0, 1.0], [-122.4, 37.7, 0.85], [-122.3, 47.6, 0.75], [-99.1, 19.4, 0.95],
  [-80.2, 25.8, 0.8], [-46.6, -23.5, 0.95], [-43.2, -22.9, 0.85], [-58.4, -34.6, 0.9],
  [-70.6, -33.4, 0.75], [-74.1, 4.7, 0.8], [-0.1, 51.5, 1.0], [2.35, 48.85, 1.0],
  [4.9, 52.35, 0.95], [9.2, 45.5, 0.9], [13.4, 52.5, 0.9], [12.5, 41.9, 0.85],
  [-3.7, 40.4, 0.85], [21.0, 52.2, 0.8], [37.6, 55.75, 0.98], [30.3, 59.9, 0.8],
  [28.9, 41.0, 0.9], [31.2, 30.0, 1.0], [3.4, 6.5, 0.8], [28.0, -26.2, 0.85],
  [46.7, 24.7, 0.85], [55.3, 25.2, 0.95], [51.4, 35.7, 0.85], [67.0, 24.8, 0.85],
  [77.2, 28.6, 1.0], [72.8, 19.0, 1.0], [77.6, 13.0, 0.9], [88.3, 22.5, 0.9],
  [100.5, 13.7, 0.9], [103.8, 1.35, 0.9], [106.8, -6.2, 0.9], [116.4, 39.9, 1.0],
  [121.4, 31.2, 1.0], [114.1, 22.3, 1.0], [104.1, 30.6, 0.9], [126.9, 37.5, 1.0],
  [139.7, 35.7, 1.0], [135.5, 34.7, 0.95], [151.2, -33.8, 0.85], [144.9, -37.8, 0.85],
];

export function createEarthTextures(maxAnisotropy: number): EarthTextureSet {
  const width = 2048;
  const height = 1024;

  const landTopology = landAtlas as unknown as Topology;
  const landGeo = feature(landTopology, landTopology.objects.land) as unknown as {
    type: string;
    geometry?: Geometry;
    features?: Array<{ geometry: Geometry }>;
  };

  const countriesTopology = countriesAtlas as unknown as Topology;
  const countriesGeo = feature(countriesTopology, countriesTopology.objects.countries) as unknown as {
    type: string;
    geometry?: Geometry;
    features?: Array<{ geometry: Geometry }>;
  };

  const renderLand = (ctx: CanvasRenderingContext2D, w: number, h: number, mode: 'fill' | 'stroke') => {
    if (landGeo.geometry) {
      drawGeo(ctx, landGeo.geometry, w, h, mode);
    } else if (landGeo.features) {
      for (const f of landGeo.features) {
        drawGeo(ctx, f.geometry, w, h, mode);
      }
    }
  };

  const renderCountries = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (countriesGeo.geometry) {
      drawGeo(ctx, countriesGeo.geometry, w, h, 'stroke');
    } else if (countriesGeo.features) {
      for (const f of countriesGeo.features) {
        drawGeo(ctx, f.geometry, w, h, 'stroke');
      }
    }
  };

  // 1. Land Mask for crisp matte continent elevation & night-light clipping
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const mctx = maskCanvas.getContext('2d')!;
  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, width, height);
  mctx.fillStyle = '#ffffff';
  renderLand(mctx, width, height, 'fill');
  const maskData = mctx.getImageData(0, 0, width, height).data;

  // 2. Argos Atlas Matte Tactical Cartography Albedo Canvas
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = width;
  albedoCanvas.height = height;
  const actx = albedoCanvas.getContext('2d')!;
  const albedoImg = actx.createImageData(width, height);
  const aPixels = albedoImg.data;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bctx = bumpCanvas.getContext('2d')!;
  const bumpImg = bctx.createImageData(width, height);
  const bPixels = bumpImg.data;

  // 512x256 terrain & bathymetry subtle micro-texture
  const nw = 512;
  const nh = 256;
  const noiseGrid = new Float32Array(nw * nh);
  for (let ny = 0; ny < nh; ny++) {
    const v = ny / nh;
    for (let nx = 0; nx < nw; nx++) {
      noiseGrid[ny * nw + nx] = fbmPeriodic(nx / nw, v, 10, 5, 4);
    }
  }

  const sampleNoise = (u: number, v: number): number => {
    const gx = u * nw;
    const gy = Math.min(nh - 1.001, Math.max(0, v * nh));
    const ix = Math.floor(gx) % nw;
    const ix1 = (ix + 1) % nw;
    const iy = Math.floor(gy);
    const iy1 = Math.min(nh - 1, iy + 1);
    const fx = gx - Math.floor(gx);
    const fy = gy - iy;
    const a = noiseGrid[iy * nw + ix];
    const b = noiseGrid[iy * nw + ix1];
    const c = noiseGrid[iy1 * nw + ix];
    const d = noiseGrid[iy1 * nw + ix1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const u = x / width;
      const n = sampleNoise(u, v);
      const isLand = maskData[idx] > 110;

      if (!isLand) {
        // Deep matte midnight-navy ocean (Argos dark cartography, zero glare)
        const depthShade = 0.88 + n * 0.22;
        aPixels[idx] = Math.round(9 * depthShade);
        aPixels[idx + 1] = Math.round(16 * depthShade);
        aPixels[idx + 2] = Math.round(30 * depthShade);
        aPixels[idx + 3] = 255;

        bPixels[idx] = bPixels[idx + 1] = bPixels[idx + 2] = 16;
        bPixels[idx + 3] = 255;
      } else {
        // Crisp dark slate-graphite landmasses with subtle latitude/topography tonal variation
        const polarTint = absLat > 68 ? (absLat - 68) * 0.45 : 0;
        const elev = n * 16 + polarTint;
        aPixels[idx] = Math.min(255, Math.round(24 + elev * 0.85));
        aPixels[idx + 1] = Math.min(255, Math.round(35 + elev * 0.95));
        aPixels[idx + 2] = Math.min(255, Math.round(54 + elev * 1.1));
        aPixels[idx + 3] = 255;

        const bump = Math.min(255, Math.round(70 + n * 140));
        bPixels[idx] = bPixels[idx + 1] = bPixels[idx + 2] = bump;
        bPixels[idx + 3] = 255;
      }
    }
  }

  actx.putImageData(albedoImg, 0, 0);
  bctx.putImageData(bumpImg, 0, 0);

  // Overlay crisp Argos Atlas tactical graticule (15° grid + bright Equator)
  actx.strokeStyle = 'rgba(56, 189, 248, 0.075)';
  actx.lineWidth = 1;
  for (let lon = -165; lon <= 180; lon += 15) {
    const [gx] = lonLatToXY(lon, 0, width, height);
    actx.beginPath();
    actx.moveTo(gx, 0);
    actx.lineTo(gx, height);
    actx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const [, gy] = lonLatToXY(0, lat, width, height);
    actx.strokeStyle = lat === 0 ? 'rgba(56, 189, 248, 0.16)' : 'rgba(56, 189, 248, 0.075)';
    actx.beginPath();
    actx.moveTo(0, gy);
    actx.lineTo(width, gy);
    actx.stroke();
  }

  // Overlay faint geopolitical country borders (countries-110m)
  actx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  actx.lineWidth = 1.0;
  renderCountries(actx, width, height);

  // Overlay crisp luminous coastline outlines (land-50m)
  actx.strokeStyle = 'rgba(56, 189, 248, 0.58)';
  actx.lineWidth = 1.5;
  renderLand(actx, width, height, 'stroke');

  // 3. Pure Matte Roughness Map (242/255 = 0.95 roughness everywhere -> zero plastic ball shine!)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 64;
  roughCanvas.height = 32;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#f2f2f2';
  rctx.fillRect(0, 0, 64, 32);

  // 4. Crisp Pinpoint Urban Light Nodes (Argos dark night-side hubs, no blurry smudges)
  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = width;
  emissiveCanvas.height = height;
  const ectx = emissiveCanvas.getContext('2d')!;
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, width, height);

  for (let i = 0; i < CITY_NODES.length; i++) {
    const [lon, lat, intensity] = CITY_NODES[i];
    const [cx, cy] = lonLatToXY(lon, lat, width, height);

    // Tight pinpoint core + subtle halo
    const glow = ectx.createRadialGradient(cx, cy, 0, cx, cy, 8);
    glow.addColorStop(0, `rgba(251, 191, 36, ${0.85 * intensity})`);
    glow.addColorStop(0.45, `rgba(245, 158, 11, ${0.28 * intensity})`);
    glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ectx.fillStyle = glow;
    ectx.beginPath();
    ectx.arc(cx, cy, 8, 0, Math.PI * 2);
    ectx.fill();

    // Crisp urban satellite points
    for (let s = 0; s < 12; s++) {
      const a = hash2(i * 19 + s, s * 37) * Math.PI * 2;
      const dist = 2 + hash2(s * 11, i * 23) * 14;
      const sx = Math.round(cx + Math.cos(a) * dist);
      const sy = Math.round(cy + Math.sin(a) * dist * 0.7);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const mIdx = (sy * width + sx) * 4;
        if (maskData[mIdx] > 100) {
          ectx.fillStyle = 'rgba(253, 224, 71, 0.72)';
          ectx.fillRect(sx, sy, 1.5, 1.5);
        }
      }
    }
  }

  // 5. Ultra-subtle faint atmospheric wisp texture (kept super clean so coastlines stay sharp)
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 512;
  cloudCanvas.height = 256;
  const cctx = cloudCanvas.getContext('2d')!;
  cctx.clearRect(0, 0, 512, 256);

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = maxAnisotropy;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.anisotropy = maxAnisotropy;

  const cloudMap = new THREE.CanvasTexture(cloudCanvas);
  cloudMap.colorSpace = THREE.SRGBColorSpace;
  cloudMap.anisotropy = maxAnisotropy;

  return {
    albedoMap,
    bumpMap,
    roughnessMap,
    emissiveMap,
    cloudMap,
    dispose: () => {
      albedoMap.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
      emissiveMap.dispose();
      cloudMap.dispose();
    },
  };
}

/**
 * Fetches Esri World Imagery z=2 tiles (4x4 Mercator grid) via our cached /api/basemap/esri proxy
 * and reprojects Web Mercator pixels cleanly onto an equirectangular 2048x1024 Earth texture.
 */
export async function loadEsriSatelliteAlbedoTexture(
  maxAnisotropy: number
): Promise<THREE.CanvasTexture | null> {
  const z = 2;
  const grid = 1 << z; // 4x4
  const tileSize = 256;
  const srcSize = grid * tileSize; // 1024x1024

  const mercCanvas = document.createElement('canvas');
  mercCanvas.width = srcSize;
  mercCanvas.height = srcSize;
  const mctx = mercCanvas.getContext('2d');
  if (!mctx) return null;

  let loadedCount = 0;
  await Promise.all(
    Array.from({ length: grid * grid }, async (_, idx) => {
      const tx = idx % grid;
      const ty = Math.floor(idx / grid);
      try {
        const res = await fetch(`/api/basemap/esri/${z}/${ty}/${tx}`);
        if (!res.ok || res.status === 204) return;
        const blob = await res.blob();
        if (blob.size < 200) return;
        const bmp = await createImageBitmap(blob);
        mctx.drawImage(bmp, tx * tileSize, ty * tileSize, tileSize, tileSize);
        bmp.close();
        loadedCount++;
      } catch {
        // Ignore single tile failure
      }
    })
  );

  if (loadedCount < 8) {
    return null;
  }

  const mercData = mctx.getImageData(0, 0, srcSize, srcSize).data;

  const outW = 2048;
  const outH = 1024;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const octx = outCanvas.getContext('2d');
  if (!octx) return null;

  const outImg = octx.createImageData(outW, outH);
  const outPx = outImg.data;
  const maxMercLatRad = 85.05112878 * (Math.PI / 180);

  for (let y = 0; y < outH; y++) {
    const latDeg = 90 - (y / outH) * 180;
    const clampedLat = Math.max(-85.05, Math.min(85.05, latDeg));
    const latRad = (clampedLat * Math.PI) / 180;
    const mercYNorm =
      (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5;
    const sy = Math.min(srcSize - 1, Math.max(0, Math.floor(mercYNorm * srcSize)));
    const polarBlend = Math.abs(latDeg) > 84 ? Math.min(1, (Math.abs(latDeg) - 84) / 6) : 0;

    for (let x = 0; x < outW; x++) {
      const sx = Math.min(srcSize - 1, Math.floor((x / outW) * srcSize));
      const sIdx = (sy * srcSize + sx) * 4;
      const dIdx = (y * outW + x) * 4;

      // Subtly grade satellite brightness so orbital debris tracks remain high-contrast
      let r = mercData[sIdx] * 0.78;
      let g = mercData[sIdx + 1] * 0.80;
      let b = mercData[sIdx + 2] * 0.84;

      if (polarBlend > 0) {
        r = r * (1 - polarBlend) + 26 * polarBlend;
        g = g * (1 - polarBlend) + 36 * polarBlend;
        b = b * (1 - polarBlend) + 52 * polarBlend;
      }

      outPx[dIdx] = Math.round(r);
      outPx[dIdx + 1] = Math.round(g);
      outPx[dIdx + 2] = Math.round(b);
      outPx[dIdx + 3] = 255;
    }
  }
  void maxMercLatRad;
  octx.putImageData(outImg, 0, 0);

  // Subtle vector coastlines overlay for tactical legibility over satellite imagery
  const landTopology = landAtlas as unknown as Topology;
  const landGeo = feature(landTopology, landTopology.objects.land) as unknown as {
    geometry?: Geometry;
    features?: Array<{ geometry: Geometry }>;
  };
  octx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
  octx.lineWidth = 1.0;
  if (landGeo.geometry) {
    drawGeo(octx, landGeo.geometry, outW, outH, 'stroke');
  } else if (landGeo.features) {
    for (const f of landGeo.features) {
      drawGeo(octx, f.geometry, outW, outH, 'stroke');
    }
  }

  const tex = new THREE.CanvasTexture(outCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

