import { BarChart3, FlaskConical } from 'lucide-react';
import { useSimulation } from '@/hooks/useSimulation';
import { ComparisonView } from './ComparisonView';
import { PageId } from './Sidebar';

interface Props {
  sim: ReturnType<typeof useSimulation>;
  onNavigate: (page: PageId) => void;
}

export function ResultsPage({ sim, onNavigate }: Props) {
  const { comparison, state, phase } = sim;

  const hasRunData = state.deliveries.length > 0 && state.deliveries.some((d) => d.decision !== 'Pending');

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 size={22} className="text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-800">Results & Comparison</h1>
        </div>
        <p className="text-sm text-slate-500">
          View results from simulation runs and compare de-duplication enabled vs disabled on the same workload.
        </p>
      </div>

      {/* Current Run Summary */}
      {hasRunData && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
            Current Run Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <SummaryItem label="Phase" value={phase} />
            <SummaryItem label="Deliveries" value={String(state.metrics.totalDeliveryAttempts)} />
            <SummaryItem label="Business Effects" value={String(state.metrics.businessEffects)} />
            <SummaryItem label="Duplicates Suppressed" value={String(state.metrics.duplicatesSuppressed)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryItem label="Unique Events" value={String(state.metrics.uniqueLogicalEvents)} />
            <SummaryItem label="Processed" value={String(state.metrics.processedLogicalEvents)} />
            <SummaryItem label="Failed" value={String(state.metrics.failedAttempts)} />
            <SummaryItem label="Retries" value={String(state.metrics.retryCount)} />
          </div>
        </div>
      )}

      {/* Comparison */}
      {comparison ? (
        <ComparisonView comparison={comparison} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <FlaskConical size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-2">No comparison generated yet.</p>
          <p className="text-xs text-slate-400 mb-4">
            Run a simulation first, then use the "Compare Results" button to see a side-by-side
            comparison of de-duplication enabled vs disabled.
          </p>
          <button
            onClick={() => onNavigate('simulator')}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-xs font-semibold rounded-md hover:bg-slate-900 transition-colors"
          >
            Go to Simulator
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-100 rounded-md p-3">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-700 capitalize tabular-nums">{value}</p>
    </div>
  );
}
