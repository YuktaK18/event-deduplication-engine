import { SimulationMetrics } from '@/sim/types';

interface Props {
  metrics: SimulationMetrics;
  deduplicationEnabled: boolean;
}

interface MetricItem {
  label: string;
  value: number | string;
  suffix?: string;
  highlight?: 'green' | 'amber' | 'red' | 'blue' | 'default';
}

export function MetricsPanel({ metrics, deduplicationEnabled }: Props) {
  const items: MetricItem[] = [
    { label: 'Delivery Attempts', value: metrics.totalDeliveryAttempts, highlight: 'default' },
    { label: 'Unique Logical Events', value: metrics.uniqueLogicalEvents, highlight: 'blue' },
    { label: 'Processed Events', value: metrics.processedLogicalEvents, highlight: 'green' },
    { label: 'Business Effects', value: metrics.businessEffects, highlight: deduplicationEnabled ? 'green' : 'red' },
    { label: 'Duplicates Suppressed', value: metrics.duplicatesSuppressed, highlight: 'amber' },
    { label: 'Failed Attempts', value: metrics.failedAttempts, highlight: 'red' },
    { label: 'Retry Count', value: metrics.retryCount, highlight: 'blue' },
    { label: 'Avg Latency', value: metrics.averageLatency, suffix: 'ms', highlight: 'default' },
  ];

  const colorMap: Record<string, string> = {
    default: 'text-slate-700',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Metrics</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((item) => (
          <div key={item.label} className="border border-slate-100 rounded-md p-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{item.label}</p>
            <p className={`text-lg font-semibold tabular-nums ${colorMap[item.highlight || 'default']}`}>
              {item.value}
              {item.suffix && <span className="text-xs text-slate-400 ml-0.5">{item.suffix}</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
