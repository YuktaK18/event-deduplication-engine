import { SimulationMetrics } from '@/sim/types';

interface Props {
  metrics: SimulationMetrics;
  deduplicationEnabled: boolean;
}

interface MetricItem {
  label: string;
  value: number | string;
  suffix?: string;
  highlight?: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'default';
}

export function MetricsPanel({ metrics, deduplicationEnabled }: Props) {
  const baseItems: MetricItem[] = [
    { label: 'Delivery Attempts', value: metrics.totalDeliveryAttempts, highlight: 'default' },
    { label: 'Unique Logical Events', value: metrics.uniqueLogicalEvents, highlight: 'blue' },
    { label: 'Processed Events', value: metrics.processedLogicalEvents, highlight: 'green' },
    { label: 'Business Effects', value: metrics.businessEffects, highlight: deduplicationEnabled ? 'green' : 'red' },
    { label: 'Duplicates Suppressed', value: metrics.duplicatesSuppressed, highlight: 'amber' },
    { label: 'Failed Attempts', value: metrics.failedAttempts, highlight: 'red' },
    { label: 'Retry Count', value: metrics.retryCount, highlight: 'blue' },
    { label: 'Avg Latency', value: metrics.averageLatency, suffix: 'ms', highlight: 'default' },
  ];

  const lateItems: MetricItem[] = [
    { label: 'Total Late Events', value: metrics.totalLateEvents, highlight: 'amber' },
    { label: 'Accepted Late', value: metrics.acceptedLateEvents, highlight: 'green' },
    { label: 'Rejected Late (Past Watermark)', value: metrics.rejectedLateEvents, highlight: 'purple' },
    { label: 'Late Duplicates', value: metrics.lateDuplicates, highlight: 'amber' },
  ];

  const burstItems: MetricItem[] = [
    { label: 'Total Burst Events', value: metrics.totalBurstEvents, highlight: 'purple' },
    { label: 'Peak Incoming Rate', value: metrics.peakIncomingRate, suffix: 'ev/t', highlight: 'purple' },
    { label: 'Max Queue Backlog', value: metrics.maxQueueBacklog, highlight: 'red' },
    { label: 'Throughput', value: metrics.processingThroughput, suffix: 'ev/t', highlight: 'green' },
  ];

  const colorMap: Record<string, string> = {
    default: 'text-slate-700',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
  };

  const showLate = metrics.totalLateEvents > 0;
  const showBurst = metrics.totalBurstEvents > 0 || metrics.maxQueueBacklog > 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Core Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {baseItems.map((item) => (
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

      {showLate && (
        <div className="pt-3 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Late-Arriving Event Metrics
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {lateItems.map((item) => (
              <div key={item.label} className="border border-amber-50/80 bg-amber-50/20 rounded-md p-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{item.label}</p>
                <p className={`text-lg font-semibold tabular-nums ${colorMap[item.highlight || 'default']}`}>
                  {item.value}
                  {item.suffix && <span className="text-xs text-slate-400 ml-0.5">{item.suffix}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showBurst && (
        <div className="pt-3 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
            Burst Stream & Backlog Metrics
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {burstItems.map((item) => (
              <div key={item.label} className="border border-purple-50/80 bg-purple-50/20 rounded-md p-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{item.label}</p>
                <p className={`text-lg font-semibold tabular-nums ${colorMap[item.highlight || 'default']}`}>
                  {item.value}
                  {item.suffix && <span className="text-xs text-slate-400 ml-0.5">{item.suffix}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
