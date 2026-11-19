import { SimulationConfig, SimPhase } from '@/sim/types';

interface Props {
  config: SimulationConfig;
  phase: SimPhase;
  onChange: (partial: Partial<SimulationConfig>) => void;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onCompare: () => void;
}

const SPEED_LABELS: Record<string, string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

export function ConfigPanel({ config, phase, onChange, onRun, onPause, onResume, onReset, onCompare }: Props) {
  const isRunning = phase === 'running';
  const isPaused = phase === 'paused';
  const isCompleted = phase === 'completed';
  const canRun = phase === 'idle' || isCompleted;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Configuration</h3>

      <div className="space-y-4">
        {/* Total Events */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-600">Total Logical Events</label>
            <span className="text-xs font-semibold text-slate-800 tabular-nums">{config.totalEvents}</span>
          </div>
          <input
            type="range"
            min={10}
            max={1000}
            step={10}
            value={config.totalEvents}
            onChange={(e) => onChange({ totalEvents: Number(e.target.value) })}
            className="w-full accent-slate-600 cursor-pointer"
            disabled={isRunning || isPaused}
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>10</span>
            <span>1000</span>
          </div>
        </div>

        {/* Duplicate Rate */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-600">Duplicate Delivery Rate</label>
            <span className="text-xs font-semibold text-slate-800 tabular-nums">{config.duplicateRate}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={config.duplicateRate}
            onChange={(e) => onChange({ duplicateRate: Number(e.target.value) })}
            className="w-full accent-slate-600 cursor-pointer"
            disabled={isRunning || isPaused}
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>0%</span>
            <span>80%</span>
          </div>
        </div>

        {/* Worker Count */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Worker Count</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => onChange({ workerCount: n })}
                disabled={isRunning || isPaused}
                className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                  config.workerCount === n
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Dedup Toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-600">De-duplication Engine</label>
          <button
            onClick={() => onChange({ deduplicationEnabled: !config.deduplicationEnabled })}
            disabled={isRunning || isPaused}
            className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${
              config.deduplicationEnabled ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                config.deduplicationEnabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        {/* Ordering */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Event Ordering</label>
          <div className="flex gap-1.5">
            {(['ordered', 'out-of-order'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => onChange({ ordering: opt })}
                disabled={isRunning || isPaused}
                className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                  config.ordering === opt
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {opt === 'ordered' ? 'Ordered' : 'Out of Order'}
              </button>
            ))}
          </div>
        </div>

        {/* Failure Injection */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Failure Injection</label>
          <div className="flex gap-1.5">
            {(['none', 'worker-crash'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => onChange({ failureInjection: opt })}
                disabled={isRunning || isPaused}
                className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                  config.failureInjection === opt
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {opt === 'none' ? 'None' : 'Worker Crash'}
              </button>
            ))}
          </div>
        </div>

        {/* Speed */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Simulation Speed</label>
          <div className="flex gap-1.5">
            {(['slow', 'normal', 'fast'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => onChange({ speed: opt })}
                className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                  config.speed === opt
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {SPEED_LABELS[opt]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
        {canRun && (
          <button
            onClick={onRun}
            className="w-full py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-md transition-colors"
          >
            {isCompleted ? 'Run New Simulation' : 'Run Simulation'}
          </button>
        )}
        {isRunning && (
          <button
            onClick={onPause}
            className="w-full py-2 text-sm font-semibold text-slate-700 bg-amber-100 hover:bg-amber-200 border border-amber-200 rounded-md transition-colors"
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={onResume}
            className="w-full py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
          >
            Resume
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={onReset}
            className="flex-1 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onCompare}
            disabled={phase === 'idle'}
            className="flex-1 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Compare Results
          </button>
        </div>
      </div>

      {(isCompleted || isPaused) && (
        <div className="mt-3 p-2 bg-amber-50 border border-amber-100 rounded text-[11px] text-amber-700">
          Configuration changes require a new run to take effect.
        </div>
      )}
    </div>
  );
}
