import { useState } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { ArchitectureDiagram } from './ArchitectureDiagram';
import { ConfigPanel } from './ConfigPanel';
import { EventTraceTable } from './EventTraceTable';
import { MetricsPanel } from './MetricsPanel';
import { SimulationCharts } from './SimulationCharts';
import { WorkerPanel } from './WorkerPanel';

interface Props {
  sim: ReturnType<typeof useSimulation>;
}

export function SimulatorPage({ sim }: Props) {
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const { state, phase, config } = sim;

  const processedInRegistry = Array.from(state.registry.values()).filter(
    (e) => e.state === 'Processed'
  ).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Simulation Lab</h1>
            <p className="text-xs text-slate-500">
              Configure parameters, run the simulation, and inspect event processing in real time.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${
                phase === 'running' ? 'bg-emerald-500' :
                phase === 'paused' ? 'bg-amber-500' :
                phase === 'completed' ? 'bg-blue-500' : 'bg-slate-300'
              }`} />
              <span className="capitalize">{phase}</span>
            </div>
            <div className="text-xs text-slate-400 tabular-nums">
              {state.currentDeliveryIndex} / {state.deliveries.length} deliveries
            </div>
            {state.crashInfo && (
              <div className="text-xs text-red-500 font-medium">
                Worker {state.crashInfo.workerId} crashed at delivery #{state.crashInfo.deliveryIndex}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Config Panel */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <ConfigPanel
            config={config}
            phase={phase}
            onChange={sim.updateConfig}
            onRun={() => sim.run()}
            onPause={sim.pause}
            onResume={sim.resume}
            onReset={sim.reset}
            onCompare={sim.compareResults}
          />
        </div>

        {/* Right: Main content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <ArchitectureDiagram
            state={state}
            onComponentClick={setSelectedComponent}
            selectedComponent={selectedComponent}
          />

          <WorkerPanel
            workers={state.workers}
            configDedupEnabled={config.deduplicationEnabled}
            registrySize={state.registry.size}
            processedCount={processedInRegistry}
          />

          <MetricsPanel metrics={state.metrics} deduplicationEnabled={config.deduplicationEnabled} />

          <SimulationCharts outcomes={state.outcomes} activityData={state.activityData} />

          <EventTraceTable deliveries={state.deliveries} />
        </div>
      </div>
    </div>
  );
}
