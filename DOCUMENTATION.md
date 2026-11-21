# DEBRISWATCH — Technical Architecture, Vector Tracking & API Documentation

## 1. Executive Summary

**DEBRISWATCH** is a real-time space debris situational awareness, orbital state-vector tracking, conjunction screening, and fragmentation simulation platform built with **React 19**, **TypeScript**, **Tailwind CSS**, **CesiumJS**, **MapLibre GL**, **Three.js**, **satellite.js**, and **Express**.

It unifies:
1. **Tokenless 3D CesiumJS Globe** (`PointPrimitiveCollection` rendering up to 10,000+ objects smoothly with NASA GIBS Blue Marble, OpenStreetMap Dark, and NASA VIIRS Night Lights imagery).
2. **Synchronized 2D MapLibre Vector Map** (CARTO-Dark-inspired vector cartography via `world-atlas` TopoJSON, antimeridian-safe ground tracks, and real-time GeoJSON velocity needles).
3. **3D & 2D Live State Vector Tracking** (ECI & ECEF position/velocity vectors, Radial–Transverse–Normal `RTN` triads, heading azimuth, flight-path angle $\gamma$, and specific angular momentum $\vec{h}$).
4. **Zoomable Optical Chase Camera & Live Hardware Camera** (`1×–24×` telephoto Three.js orbital telescope with Optical/Thermal/Radar spectral filters and `getUserMedia` live camera mode).
5. **Three Dedicated Web Workers** (10-float transferable SGP4 propagation, two-stage conjunction screening, and Two-Body + J2 fragmentation simulation).
6. **REST & GeoJSON Vector Tracking API** (`GET /api/vector-track/:noradId`, `GET /api/vector-field`, `GET /api/layer-snapshot`, `GET /api/conjunctions`, `POST /api/briefing`, etc.) inspectable in-app via a zoomable presentation JSON Explorer.

---

## 2. Data Pipeline & Fair-Use Caching

### CelesTrak OMM Feeds (No API Key Required)
The client service (`src/services/celestrak.ts`) fetches Orbit Mean-Elements Message (OMM) JSON records directly from CelesTrak:

```
https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=json
```

Supported groups:
- `stations` — Crewed stations (`ISS`, `CSS/TIANHE`) → **Gold** (`STATION`)
- `resource` — Earth observation (`Sentinel`, `Landsat`, `Terra`, etc.) → **Green** (`EO`)
- `weather` & `active` — Weather & active constellations → **Cyan** (`ACTIVE`)
- `cosmos-1408-debris`, `fengyun-1c-debris`, `iridium-33-debris`, `cosmos-2251-debris` → **Red** (`DEBRIS`)

### 2-Hour Local Cache & Fallback
- Each group is stored under `localStorage` key `debriswatch_celestrak_v1_<group>` with a `fetchedAtMs` timestamp.
- Automatic loads reuse cached groups for **2 hours** (`CACHE_TTL_MS = 7,200,000 ms`) in compliance with CelesTrak's fair-use policy.
- If network or CORS prevents live fetching and no cache is present, DEBRISWATCH displays a **visible dismissible error banner**, switches the status chip to **`SAMPLE DATA`**, and loads a ~56-object curated OMM catalog (`src/data/sampleCatalog.ts`).

---

## 3. State Vector Tracking & Astrodynamics

### SGP4 Worker Buffer (`stride = 10`)
`src/workers/propagation.worker.ts` compiles every OMM record via `satellite.json2satrec(omm)` and writes a zero-copy transferable `Float32Array` per simulation tick:

| Index | Field | Units / Frame |
| :--- | :--- | :--- |
| `+0..+2` | `ecefX, ecefY, ecefZ` | Meters (ECEF, fed directly to `Cesium.Cartesian3`) |
| `+3, +4` | `latDeg, lonDeg` | Degrees (WGS-84 geodetic via `gstime`) |
| `+5` | `altKm` | Kilometers above Earth ellipsoid |
| `+6` | `speedKmS` | Inertial speed $\|\vec{v}_{\text{ECI}}\|$ (km/s) |
| `+7..+9` | `vxEcefKmS, vyEcefKmS, vzEcefKmS` | Kilometers/sec (ECEF velocity vector) |

### Coordinate & Kinematic Equations (`src/utils/orbitMath.ts`)
1. **Earth-Rotation Transport Theorem (ECI → ECEF Velocity)**:
   $$\vec{v}_{\text{ECEF}} = R_z(\theta_{\text{GMST}})\,\vec{v}_{\text{ECI}} - \vec{\omega}_\oplus \times \vec{r}_{\text{ECEF}}, \quad \omega_\oplus = 7.2921150 \times 10^{-5}\,\text{rad/s}$$
2. **Specific Angular Momentum**:
   $$\vec{h} = \vec{r}_{\text{ECI}} \times \vec{v}_{\text{ECI}}$$
3. **Flight-Path Angle ($\gamma$)**:
   $$\gamma = \arcsin\left(\frac{\vec{r}_{\text{ECI}} \cdot \vec{v}_{\text{ECI}}}{\|\vec{r}_{\text{ECI}}\|\,\|\vec{v}_{\text{ECI}}\|}\right)$$
4. **RTN (Radial–Transverse–Normal) Orthonormal Basis in ECEF**:
   $$\hat{R} = \frac{\vec{r}_{\text{ECEF}}}{\|\vec{r}_{\text{ECEF}}\|}, \quad \hat{N} = \frac{\vec{r}_{\text{ECEF}} \times \vec{v}_{\text{ECEF}}}{\|\vec{r}_{\text{ECEF}} \times \vec{v}_{\text{ECEF}}\|}, \quad \hat{T} = \hat{N} \times \hat{R}$$
5. **Local Ground Heading Azimuth**:
   Projected into local East–North–Up (`ENU`) frame at `(latDeg, lonDeg)` via `atan2(vEast, vNorth)`.

### On-Globe & 2D Map Vector Rendering
- **3D CesiumJS Globe**: Pre-allocated `PolylineCollection` renders the selected object's **Velocity Vector** ($\vec{v}$, cyan arrow), **Radial Vector** ($\hat{R}$, emerald), and **Orbit-Normal Vector** ($\hat{N}$, violet), plus up to 140 live tangential velocity field vectors across active orbital shells when **Vectors** is enabled.
- **2D MapLibre Vector Map**: Projects `(vxEcefKmS, vyEcefKmS, vzEcefKmS)` onto local ENU ground vectors (`velocity-vectors` GeoJSON `LineString` layer) synchronized with antimeridian-split next-period ground tracks (`computeVectorGroundTrackSegments`).

---

## 4. Conjunction Screening & Fragmentation Simulation

### Two-Stage Conjunction Screening (`src/workers/conjunction.worker.ts`)
1. **Stage 1 (Band Overlap Filter)**: Eliminates pairs whose `[perigee - pad, apogee + pad]` altitude envelopes do not intersect.
2. **Stage 2 (Coarse Sweep)**: Steps primary and candidate satellites every `30 s` across the selected window (`6h / 12h / 24h / 48h`), reporting progress percentage to the main thread.
3. **Stage 3 (Fine Search)**: Refines every candidate close approach within `±34 s` at **`0.5 s`** resolution to capture exact Time of Closest Approach (TCA), miss distance (km), and relative velocity (km/s).
4. **Risk Classification**: `HIGH` (`< 1 km`), `MEDIUM` (`< 5 km`), `LOW` (`<= threshold`). Clicking a row pauses the clock at TCA, zooms the camera, and renders both orbital paths.

> **TLE Uncertainty Disclaimer**: SGP4 propagation from public GP/OMM elements carries kilometer-level positional uncertainty. DEBRISWATCH screening is strictly for education and situational awareness.

### What-If Fragmentation Tool (`src/workers/fragmentation.worker.ts`)
- Propagates parent object to `(r0, v0)` at the breakup epoch and samples Gaussian velocity perturbations (`deltaVSigmaMS`, `isotropic` or `directional` jet mode).
- Converts each perturbed state `(r0, v0 + dv)` to classical Keplerian elements (`a, e, i, Ω, ω, M0`) and propagates secular **Two-Body + J2** nodal regression ($\dot{\Omega}$) and apsidal precession ($\dot{\omega}$).
- Outputs an orange spreading fragment cloud, a 0–4 orbit dispersion curve, and a 24-hour tracked-object proximity exposure count, explicitly badged **`SIMULATED`**.

---

## 5. REST & GeoJSON API Reference

All endpoints are served by Express on port `3000` (`server.ts`) and can be tested interactively inside the **API** drawer.

### `GET /api/vector-track/:noradId`
Returns live SGP4 state vectors (`ECI`, `ECEF`, `RTN`, kinematics, and 30-minute vector ephemeris sample). Automatically falls back to CelesTrak `CATNR` lookup if the NORAD ID is not in the initial slice.
- **Query Params**: `?t=<epochMs>` (optional UTC timestamp in ms)
- **Example Response (abbreviated)**:
```json
{
  "source": "celestrak-live",
  "noradId": 25544,
  "name": "ISS (ZARYA)",
  "epochUtc": "2026-11-21T12:50:00.000Z",
  "geodetic": { "latDeg": 34.1821, "lonDeg": -118.4102, "altKm": 417.64 },
  "eci": {
    "positionKm": { "x": -2411.821, "y": -4892.314, "z": 3810.502 },
    "velocityKmS": { "x": 6.1821, "y": -0.9412, "z": 4.4105 }
  },
  "ecef": {
    "positionKm": { "x": -2514.112, "y": -4641.201, "z": 3810.502 },
    "velocityKmS": { "x": 5.8442, "y": -1.1246, "z": 4.4105 }
  },
  "kinematics": {
    "inertialSpeedKmS": 7.6512,
    "ecefSpeedKmS": 7.3198,
    "flightPathAngleDeg": 0.041,
    "headingDeg": 43.28,
    "angularMomentumMagKm2S": 51984.12,
    "specificEnergyKm2S2": -29.342,
    "semiMajorAxisKm": 6795.41
  }
}
```

### `GET /api/vector-field`
Returns a GeoJSON `FeatureCollection` of velocity tangent `LineString` vectors across tracked objects.
- **Query Params**: `?regime=all|LEO|MEO|GEO&limit=40&t=<epochMs>`

### `GET /api/layer-snapshot`
Returns a bounding-box-filtered GeoJSON `FeatureCollection` containing orbital object points, ground tracking stations, conjunction hazard lines, and convergence zone polygons.
- **Query Params**: `?bbox=-180,-90,180,90`

### `GET /api/orbital-data`
Returns filtered catalog metadata.
- **Query Params**: `?group=all|<group>&regime=all|LEO|MEO|GEO&limit=260&refresh=1`

### `GET /api/debris/:noradId`
Returns object metadata, reliability score, and live SGP4 telemetry snapshot.

### `GET /api/conjunctions`
Returns top close-approach candidates screened across LEO satellites and debris.

### `GET /api/computed-intel`
Returns orbital shell instability indices (0–100), spatial convergence clusters, and open-data attributions.

### `POST /api/briefing`
Generates a plain-language executive orbital safety briefing using **`gemini-4-hydrogen`** (`@google/genai`), strictly grounded to the computed JSON telemetry payload (`countsByClass`, `countsByBand`, `mostCrowdedShell`, `topConjunctions`, `fragmentation`, `regionOverflight`).

### `GET /api/health`
Returns `{ "status": "operational", "service": "debriswatch-api" }`.

---

## 6. Controls, Shortcuts & Deployment

- **Keyboard Shortcuts**:
  - `Space`: Play / Pause simulation clock
  - `ArrowLeft` / `ArrowRight`: Scrub time by `±15 min` (hold `Shift` for `±1 hour`)
  - `Esc`: Exit region drawing mode or close active modals (`Optics`, `API`, `Docs`)
- **Build & Run**:
  - Development: `npm run dev` (`tsx server.ts` on port `3000`, serving `/cesium` static assets and Vite middleware)
  - Typecheck / Lint: `npm run lint` (`tsc --noEmit`)
  - Production Build: `npm run build` (`vite build`, bundling `dist/` and copying Cesium `Assets`, `ThirdParty`, `Widgets`, `Workers` into `dist/cesium/`)
  - Production Start: `npm run start` (`node server.ts`)
