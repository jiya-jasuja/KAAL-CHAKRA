import { Info, X } from 'lucide-react';

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="About DEBRISWATCH Methodology and Attributions"
    >
      <div className="w-full max-w-2xl max-h-[86vh] flex flex-col bg-[#080C15] border border-white/15 rounded-xl overflow-hidden text-slate-200">
        <div className="px-5 py-3.5 border-b border-white/10 bg-[#0A101D] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400" />
            <h2 className="font-display text-base font-semibold text-white">
              About DEBRISWATCH — Physics, Accuracy & Attributions
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-md"
            aria-label="Close About dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs leading-relaxed text-slate-300">
          <section>
            <h3 className="font-display text-sm font-semibold text-white mb-1">
              1. SGP4 Orbital Propagation & TLE Accuracy Limits
            </h3>
            <p>
              All cataloged satellites and fragmentation debris are propagated in a dedicated Web
              Worker using the <strong>SGP4</strong> analytical perturbation model via{' '}
              <code>satellite.js</code> and Orbit Mean-Elements Message (OMM) JSON records from
              CelesTrak. General Perturbations (GP/TLE) elements carry inherent kilometer-level
              uncertainties (typically 1–5 km along-track, growing with epoch age and solar drag).
              DEBRISWATCH is strictly for visualization, education, and situational awareness — not
              operational collision avoidance or maneuver planning.
            </p>
          </section>

          <section>
            <h3 className="font-display text-sm font-semibold text-white mb-1">
              2. Two-Stage Conjunction Screening
            </h3>
            <p>
              Conjunction screening runs inside a dedicated Web Worker in two stages: first a
              coarse apogee/perigee altitude-band overlap filter eliminates impossible pairs, followed
              by a 30-second coarse ECI search across the selected window (up to 48 hours) and a
              0.5-second fine search around each close-approach minimum to refine miss distance and
              relative velocity.
            </p>
          </section>

          <section>
            <h3 className="font-display text-sm font-semibold text-white mb-1">
              3. What-If Fragmentation Model (Simulated)
            </h3>
            <p>
              The What-If Breakup simulator extracts the parent object&apos;s ECI position and
              velocity at the chosen simulation epoch, applies Gaussian velocity perturbations
              (1-sigma delta-v in isotropic or directional jet mode), converts perturbed state
              vectors into classical Keplerian elements, and propagates the cloud using a simplified{' '}
              <strong>Two-Body + J2 secular perturbation</strong> model (nodal regression and apsidal
              precession). Outputs are clearly marked <strong>SIMULATED</strong>.
            </p>
          </section>

          <section>
            <h3 className="font-display text-sm font-semibold text-white mb-1">
              4. Live State Vector Tracking &amp; REST / GeoJSON API
            </h3>
            <p className="mb-2">
              The SGP4 propagation worker streams 10-float state records (ECEF position, geodetic
              lat/lon/alt, inertial speed, and ECEF velocity vector via the Earth-rotation
              transport theorem) to render real-time 3D velocity needles, Radial-Transverse-Normal
              (RTN) triads, and synchronized 2D MapLibre vector tracks.
            </p>
            <ul className="space-y-1 text-cyan-200/90 font-mono text-[11px] bg-[#04060B] border border-white/10 rounded-lg p-2.5">
              <li>• GET /api/vector-track/:noradId — ECI/ECEF vectors, RTN basis, heading &amp; ephemeris</li>
              <li>• GET /api/vector-field — GeoJSON velocity tangent vectors across orbital regimes</li>
              <li>• GET /api/layer-snapshot — Bbox-filtered GeoJSON points, arcs &amp; convergence zones</li>
              <li>• GET /api/conjunctions &amp; POST /api/briefing — Conjunctions &amp; Gemini safety brief</li>
            </ul>
          </section>

          <section className="pt-2 border-t border-white/10">
            <h3 className="font-display text-sm font-semibold text-white mb-1.5">
              5. Open Data &amp; Software Attributions
            </h3>
            <ul className="space-y-1 text-slate-400 font-mono text-[11px]">
              <li>• CelesTrak — NORAD GP/OMM orbital element feeds (cached locally every 2 hours)</li>
              <li>• satellite.js — SGP4/SDP4 propagation, GMST, ECI/ECF &amp; look-angle transforms</li>
              <li>• CesiumJS (Apache 2.0) &amp; MapLibre GL — 3D globe &amp; 2D vector cartography</li>
              <li>• NASA GIBS, Esri &amp; OpenStreetMap (ODbL) — Free Earth base imagery</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
