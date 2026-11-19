import { DeliveryAttempt, ActivityDataPoint } from '@/sim/types';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';

interface Props {
  outcomes: { name: string; value: number; color: string }[];
  activityData: ActivityDataPoint[];
}

export function SimulationCharts({ outcomes, activityData }: Props) {
  const hasData = outcomes.length > 0 && outcomes.some((o) => o.value > 0);
  const hasActivity = activityData.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Outcome Breakdown */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Processing Outcome Breakdown
        </h3>
        {hasData ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={outcomes}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={75}
                innerRadius={40}
                paddingAngle={2}
              >
                {outcomes.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  fontSize: '12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: '11px' }}
                formatter={(value: string) => <span className="text-slate-600">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-xs text-slate-400">
            No outcome data yet. Run a simulation to see the breakdown.
          </div>
        )}
      </div>

      {/* Activity Over Time */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Processing Activity Over Simulated Time
        </h3>
        {hasActivity ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={activityData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
              <defs>
                <linearGradient id="gProcessed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gDupes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                label={{ value: 'Sim Time', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: '#94a3b8' } }}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{
                  fontSize: '12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                }}
                labelFormatter={(v) => `T${v}`}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
              <Area
                type="monotone"
                dataKey="processed"
                name="Processed"
                stroke="#10b981"
                fill="url(#gProcessed)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="duplicates"
                name="Duplicates"
                stroke="#f59e0b"
                fill="url(#gDupes)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="failed"
                name="Failed"
                stroke="#ef4444"
                fill="url(#gFailed)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-xs text-slate-400">
            No activity data yet. Run a simulation to see the timeline.
          </div>
        )}
      </div>
    </div>
  );
}
