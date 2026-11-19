import { ComparisonResult } from '@/sim/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  comparison: ComparisonResult;
}

export function ComparisonView({ comparison }: Props) {
  const {
    metricsWithout,
    metricsWith,
    eventsGenerated,
    duplicateDeliveries,
  } = comparison;

  const chartData = [
    {
      name: 'Delivery Attempts',
      'Dedup Off': metricsWithout.totalDeliveryAttempts,
      'Dedup On': metricsWith.totalDeliveryAttempts,
    },
    {
      name: 'Business Effects',
      'Dedup Off': metricsWithout.businessEffects,
      'Dedup On': metricsWith.businessEffects,
    },
    {
      name: 'Duplicates Suppressed',
      'Dedup Off': metricsWithout.duplicatesSuppressed,
      'Dedup On': metricsWith.duplicatesSuppressed,
    },
    {
      name: 'Failed Attempts',
      'Dedup Off': metricsWithout.failedAttempts,
      'Dedup On': metricsWith.failedAttempts,
    },
    {
      name: 'Retries',
      'Dedup Off': metricsWithout.retryCount,
      'Dedup On': metricsWith.retryCount,
    },
  ];

  const comparisonRows = [
    { label: 'Total Delivery Attempts', without: metricsWithout.totalDeliveryAttempts, with: metricsWith.totalDeliveryAttempts },
    { label: 'Unique Logical Events', without: metricsWithout.uniqueLogicalEvents, with: metricsWith.uniqueLogicalEvents },
    { label: 'Processed Logical Events', without: metricsWithout.processedLogicalEvents, with: metricsWith.processedLogicalEvents },
    { label: 'Business Effects', without: metricsWithout.businessEffects, with: metricsWith.businessEffects },
    { label: 'Duplicates Suppressed', without: metricsWithout.duplicatesSuppressed, with: metricsWith.duplicatesSuppressed },
    { label: 'Failed Attempts', without: metricsWithout.failedAttempts, with: metricsWith.failedAttempts },
    { label: 'Retry Count', without: metricsWithout.retryCount, with: metricsWith.retryCount },
    { label: 'Average Latency (ms)', without: metricsWithout.averageLatency, with: metricsWith.averageLatency },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
          Before & After Comparison
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Same workload of {eventsGenerated} unique events with {duplicateDeliveries} duplicate deliveries
          ({eventsGenerated + duplicateDeliveries} total attempts), run with de-duplication off vs on.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '4px' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="Dedup Off" fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Dedup On" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left font-medium text-slate-500 px-3 py-2">Metric</th>
                  <th className="text-right font-medium text-slate-500 px-3 py-2">Dedup Off</th>
                  <th className="text-right font-medium text-slate-500 px-3 py-2">Dedup On</th>
                  <th className="text-right font-medium text-slate-500 px-3 py-2">Delta</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => {
                  const delta = row.with - row.without;
                  const showDelta = delta !== 0;
                  return (
                    <tr key={row.label} className="border-b border-slate-50">
                      <td className="px-3 py-2 text-slate-600">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.without}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.with}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${showDelta ? (delta < 0 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-300'}`}>
                        {showDelta ? (delta > 0 ? '+' : '') + delta : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Key Observations</h4>
        <ul className="space-y-1.5 text-xs text-slate-600">
          <li>
            With de-duplication <strong>disabled</strong>, {metricsWithout.businessEffects} business effects were applied
            from {metricsWithout.totalDeliveryAttempts} delivery attempts — duplicates caused repeated effects.
          </li>
          <li>
            With de-duplication <strong>enabled</strong>, only {metricsWith.businessEffects} business effects were applied
            — {metricsWith.duplicatesSuppressed} duplicate deliveries were suppressed by the registry.
          </li>
          {duplicateDeliveries > 0 && (
            <li>
              {duplicateDeliveries} duplicate deliveries were generated. Without dedup, these caused{' '}
              {metricsWithout.businessEffects - eventsGenerated} extra business effects.
              With dedup, they were all suppressed.
            </li>
          )}
          <li className="text-slate-400 pt-1">
            Note: These results assume an in-memory registry. Production systems need durable storage and
            transactional coordination to guarantee exactly-once semantics.
          </li>
        </ul>
      </div>
    </div>
  );
}
