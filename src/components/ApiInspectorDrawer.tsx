import { useEffect, useState } from 'react';
import { Check, Code2, Copy, RefreshCw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ApiInspectorDrawerProps {
  selectedObject: { noradId: number; name: string } | null;
  simTimeMs?: number;
  onClose: () => void;
}

type EndpointKey =
  | 'vector-track'
  | 'vector-field'
  | 'orbital-data'
  | 'layer-snapshot'
  | 'computed-intel'
  | 'debris-detail'
  | 'conjunctions'
  | 'hotspots';

export function ApiInspectorDrawer({
  selectedObject,
  simTimeMs,
  onClose,
}: ApiInspectorDrawerProps) {
  const [endpoint, setEndpoint] = useState<EndpointKey>('vector-track');
  const [regimeFilter, setRegimeFilter] = useState<string>('all');
  const [limitFilter, setLimitFilter] = useState<number>(12);
  const [jsonZoomPx, setJsonZoomPx] = useState<number>(13);
  const [loading, setLoading] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const activeNorad = selectedObject?.noradId ?? 25544;
  const epochQuery = simTimeMs ? `?t=${Math.round(simTimeMs)}` : '';

  const resolvedPath =
    endpoint === 'vector-track'
      ? `/api/vector-track/${activeNorad}${epochQuery}`
      : endpoint === 'vector-field'
        ? `/api/vector-field?regime=${regimeFilter}&limit=${limitFilter}`
        : endpoint === 'orbital-data'
          ? `/api/orbital-data?regime=${regimeFilter}&limit=${limitFilter}`
          : endpoint === 'layer-snapshot'
            ? `/api/layer-snapshot?bbox=-180,-90,180,90`
            : endpoint === 'computed-intel'
              ? `/api/computed-intel`
              : endpoint === 'debris-detail'
                ? `/api/debris/${activeNorad}`
                : endpoint === 'conjunctions'
                  ? `/api/conjunctions`
                  : `/api/hotspots`;

  const fetchEndpoint = async (path: string) => {
    setLoading(true);
    setErrorMsg(null);
    const t0 = performance.now();
    try {
      const res = await fetch(path);
      const data = await res.json();
      setLatencyMs(Math.round(performance.now() - t0));
      if (!res.ok) {
        setErrorMsg(data.error || `HTTP ${res.status}`);
        setPayload(data);
      } else {
        setPayload(data);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEndpoint(resolvedPath);
  }, [resolvedPath]);

  const formattedJson = payload ? JSON.stringify(payload, null, 2) : '';

  const handleCopy = () => {
    if (!formattedJson) return;
    navigator.clipboard?.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#080C15] border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-[#0A0F1A]">
        <div className="flex items-center gap-3">
          <Code2 className="w-4 h-4 text-cyan-400" />
          <h2 className="font-display text-sm font-semibold text-white">
            Live Vector &amp; Telemetry API Explorer
          </h2>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs font-mono text-slate-400">
            REST / GeoJSON / SGP4 State Vectors
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoomable API presentation controls */}
          <div className="flex items-center gap-1 bg-[#05070C] border border-white/10 rounded-lg px-2 py-1">
            <button
              type="button"
              onClick={() => setJsonZoomPx((z) => Math.max(10, z - 2))}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              aria-label="Zoom out API JSON"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono tabular-nums text-cyan-300 px-1.5">
              {Math.round((jsonZoomPx / 13) * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setJsonZoomPx((z) => Math.min(24, z + 2))}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              aria-label="Zoom in API JSON"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white border border-white/10 rounded-lg bg-[#05070C] flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white border border-white/10 rounded-lg bg-[#05070C] transition-colors"
            aria-label="Close API Explorer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Endpoint & Query Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-[#070B13]">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: 'vector-track', label: `GET /api/vector-track/${activeNorad}` },
              { key: 'vector-field', label: 'GET /api/vector-field (GeoJSON)' },
              { key: 'layer-snapshot', label: 'GET /api/layer-snapshot' },
              { key: 'orbital-data', label: 'GET /api/orbital-data' },
              { key: 'computed-intel', label: 'GET /api/computed-intel' },
              { key: 'debris-detail', label: `GET /api/debris/${activeNorad}` },
              { key: 'conjunctions', label: 'GET /api/conjunctions' },
              { key: 'hotspots', label: 'GET /api/hotspots' },
            ] as Array<{ key: EndpointKey; label: string }>
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setEndpoint(item.key)}
              className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap ${
                endpoint === item.key
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-[#05070C] text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {(endpoint === 'orbital-data' || endpoint === 'vector-field') && (
            <>
              <select
                value={regimeFilter}
                onChange={(e) => setRegimeFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-[#05070C] border border-white/10 rounded-lg text-slate-200"
                aria-label="Filter API by orbital regime"
              >
                <option value="all">Regime: ALL</option>
                <option value="LEO">Regime: LEO</option>
                <option value="MEO">Regime: MEO</option>
                <option value="GEO">Regime: GEO</option>
              </select>
              <select
                value={limitFilter}
                onChange={(e) => setLimitFilter(Number(e.target.value))}
                className="px-2.5 py-1.5 text-xs font-mono bg-[#05070C] border border-white/10 rounded-lg text-slate-200"
                aria-label="Limit API results"
              >
                <option value={5}>Limit: 5</option>
                <option value={12}>Limit: 12</option>
                <option value={40}>Limit: 40</option>
                <option value={100}>Limit: 100</option>
              </select>
            </>
          )}
          <button
            type="button"
            onClick={() => fetchEndpoint(resolvedPath)}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Run Query
          </button>
        </div>
      </div>

      {/* Request Summary Bar */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-white/5 bg-[#05070C] text-xs font-mono text-slate-400">
        <span className="truncate text-slate-300">{resolvedPath}</span>
        <div className="flex items-center gap-3 shrink-0 tabular-nums">
          {latencyMs !== null && <span>{latencyMs} ms</span>}
          {errorMsg ? (
            <span className="text-rose-400">Error: {errorMsg}</span>
          ) : (
            <span className="text-emerald-400">200 OK</span>
          )}
        </div>
      </div>

      {/* Zoomable JSON Viewer */}
      <div
        className="flex-1 overflow-auto p-5 bg-[#04060A] font-mono leading-relaxed text-slate-200"
        style={{ fontSize: `${jsonZoomPx}px` }}
      >
        {loading && !payload ? (
          <div className="text-slate-400">Fetching live orbital payload...</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words">{formattedJson}</pre>
        )}
      </div>
    </div>
  );
}
