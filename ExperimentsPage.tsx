import { EXPERIMENT_PRESETS } from '@/sim/presets';
import { SimulationConfig } from '@/sim/types';
import { useSimulation } from '@/hooks/useSimulation';
import { Beaker, Play, RotateCcw, ArrowRight, Info } from 'lucide-react';
import { PageId } from './Sidebar';

interface Props {
  sim: ReturnType<typeof useSimulation>;
  onNavigate: (page: PageId) => void;
}

export function ExperimentsPage({ sim, onNavigate }: Props) {
  const handleLoadAndRun = (config: SimulationConfig) => {
    sim.loadConfig(config);
    setTimeout(() => sim.run(config), 100);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Beaker size={22} className="text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-800">Predefined Experiments</h1>
        </div>
        <p className="text-sm text-slate-500">
          Load a preset scenario to see specific aspects of the de-duplication engine in action.
          Each experiment loads configuration values and can be run immediately.
        </p>
      </div>

      <div className="space-y-4">
        {EXPERIMENT_PRESETS.map((preset) => (
          <div key={preset.id} className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-1">{preset.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{preset.description}</p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded p-3 mb-3">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Hypothesis</p>
              <p className="text-xs text-slate-600 leading-relaxed">{preset.hypothesis}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <ConfigChip label="Events" value={String(preset.config.totalEvents)} />
              <ConfigChip label="Dup Rate" value={`${preset.config.duplicateRate}%`} />
              <ConfigChip label="Workers" value={String(preset.config.workerCount)} />
              <ConfigChip label="Dedup" value={preset.config.deduplicationEnabled ? 'ON' : 'OFF'} />
              <ConfigChip label="Ordering" value={preset.config.ordering === 'ordered' ? 'Ordered' : 'Shuffled'} />
              <ConfigChip label="Failures" value={preset.config.failureInjection === 'none' ? 'None' : 'Crash'} />
              <ConfigChip label="Speed" value={preset.config.speed} />
              <ConfigChip label="Seed" value={String(preset.config.seed)} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleLoadAndRun(preset.config)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-xs font-semibold rounded-md hover:bg-slate-900 transition-colors"
              >
                <Play size={14} />
                Load & Run
              </button>
              <button
                onClick={() => {
                  sim.loadConfig(preset.config);
                  onNavigate('simulator');
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-slate-600 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                Load Config Only
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-slate-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-500">
            All experiments use deterministic seeds, so results are reproducible.
            Running the same configuration always produces the same events and duplicates.
          </p>
        </div>
        <button
          onClick={() => {
            sim.loadConfig({
              totalEvents: 100,
              duplicateRate: 30,
              workerCount: 2,
              deduplicationEnabled: true,
              ordering: 'ordered',
              failureInjection: 'none',
              speed: 'normal',
              seed: 42,
            });
            onNavigate('simulator');
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-white transition-colors flex-shrink-0"
        >
          <RotateCcw size={14} />
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function ConfigChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-100 rounded px-2.5 py-1.5 bg-white">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-xs font-semibold text-slate-700 capitalize">{value}</p>
    </div>
  );
}
