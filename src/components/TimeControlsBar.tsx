import { Pause, Play, RotateCcw } from 'lucide-react';

interface TimeControlsBarProps {
  simTimeMs: number;
  baseRealTimeMs: number;
  paused: boolean;
  speedMultiplier: number;
  onTogglePause: () => void;
  onChangeSpeed: (mult: number) => void;
  onScrubOffsetHours: (hoursOffset: number) => void;
  onResetNow: () => void;
}

const SPEED_OPTIONS = [1, 10, 100, 1000] as const;

export function TimeControlsBar({
  simTimeMs,
  baseRealTimeMs,
  paused,
  speedMultiplier,
  onTogglePause,
  onChangeSpeed,
  onScrubOffsetHours,
  onResetNow,
}: TimeControlsBarProps) {
  const offsetHours = Math.max(-48, Math.min(48, (simTimeMs - baseRealTimeMs) / 3600_000));
  const simIso = new Date(simTimeMs).toISOString();
  const utcDate = simIso.slice(0, 10);
  const utcTime = simIso.slice(11, 19);

  return (
    <div className="bg-[#070B13]/94 border border-white/10 rounded-xl px-4 py-2.5 flex flex-col sm:flex-row items-center gap-3 text-slate-200">
      {/* Play / Pause & Prominent Monospace UTC Clock */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onTogglePause}
          className="px-3 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 rounded-lg transition-colors flex items-center gap-1.5"
          title="Play / Pause (Space)"
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          {paused ? 'Play' : 'Pause'}
        </button>

        <div className="px-2.5 py-1 bg-[#04060B] border border-white/10 rounded-lg font-mono tabular-nums leading-tight">
          <div className="text-[10px] text-slate-400">{utcDate}</div>
          <div className="text-sm font-semibold text-white">{utcTime} UTC</div>
        </div>
      </div>

      {/* ±48h Time Scrubber */}
      <div className="flex-1 w-full flex items-center gap-2.5 min-w-[200px]">
        <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">-48h</span>
        <input
          type="range"
          min={-48}
          max={48}
          step={0.25}
          value={offsetHours}
          onChange={(e) => onScrubOffsetHours(Number(e.target.value))}
          className="atlas-range flex-1"
          aria-label="Simulation time scrubber plus or minus 48 hours"
        />
        <span className="text-[10px] font-mono text-slate-400 tabular-nums shrink-0">+48h</span>
        <span className="text-[11px] font-mono text-cyan-300 tabular-nums w-14 text-right shrink-0">
          {offsetHours >= 0 ? `+${offsetHours.toFixed(1)}h` : `${offsetHours.toFixed(1)}h`}
        </span>
      </div>

      {/* Speed & Reset Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center bg-[#04060B] border border-white/10 rounded-lg p-0.5 font-mono tabular-nums">
          {SPEED_OPTIONS.map((mult) => (
            <button
              key={mult}
              type="button"
              onClick={() => onChangeSpeed(mult)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                speedMultiplier === mult
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {mult}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onResetNow}
          className="px-2.5 py-1.5 text-xs font-medium border border-white/10 bg-[#04060B] text-slate-300 hover:text-white rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap"
          title="Reset simulation clock to current UTC"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Now
        </button>
      </div>
    </div>
  );
}
