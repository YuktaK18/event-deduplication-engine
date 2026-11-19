import { useState, useMemo } from 'react';
import { DeliveryAttempt, ProcessingDecision } from '@/sim/types';
import { Search, Filter } from 'lucide-react';

interface Props {
  deliveries: DeliveryAttempt[];
  maxRows?: number;
}

const DECISION_COLORS: Record<string, string> = {
  Processed: 'text-emerald-600 bg-emerald-50',
  'Duplicate Suppressed': 'text-amber-600 bg-amber-50',
  Failed: 'text-red-600 bg-red-50',
  Retried: 'text-blue-600 bg-blue-50',
  Pending: 'text-slate-500 bg-slate-50',
};

const FILTER_OPTIONS: (ProcessingDecision | 'All')[] = [
  'All',
  'Processed',
  'Duplicate Suppressed',
  'Failed',
  'Retried',
  'Pending',
];

export function EventTraceTable({ deliveries, maxRows = 200 }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProcessingDecision | 'All'>('All');

  const filtered = useMemo(() => {
    return deliveries.filter((d) => {
      if (filter !== 'All' && d.decision !== filter) return false;
      if (search && !d.eventId.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [deliveries, search, filter]);

  const visible = filtered.slice(0, maxRows);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Event Trace</h3>
        <span className="text-xs text-slate-400 tabular-nums">{filtered.length} entries</span>
      </div>

      <div className="flex items-center gap-2 p-3 border-b border-slate-100">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by event ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-slate-400"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ProcessingDecision | 'All')}
            className="pl-8 pr-6 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-slate-400 appearance-none bg-white cursor-pointer"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'All' ? 'All Decisions' : opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="text-left font-medium px-3 py-2">Seq</th>
              <th className="text-left font-medium px-3 py-2">Event ID</th>
              <th className="text-left font-medium px-3 py-2">Type</th>
              <th className="text-center font-medium px-3 py-2">Deliv.</th>
              <th className="text-center font-medium px-3 py-2">Worker</th>
              <th className="text-left font-medium px-3 py-2">Decision</th>
              <th className="text-left font-medium px-3 py-2 max-w-[280px]">Reason</th>
              <th className="text-right font-medium px-3 py-2">Sim Time</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-400 text-xs">
                  No deliveries match the current filter. Run a simulation to see event traces.
                </td>
              </tr>
            )}
            {visible.map((d, i) => (
              <tr
                key={d.uid}
                className={`border-b border-slate-50 hover:bg-slate-50 ${d.isDuplicate ? 'bg-amber-50/30' : ''}`}
              >
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{d.sequence}</td>
                <td className="px-3 py-1.5 font-mono text-slate-700">{d.eventId}</td>
                <td className="px-3 py-1.5 text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    {d.isDuplicate && <span className="text-amber-500 text-[10px]">dup</span>}
                    {d.type}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center text-slate-600 tabular-nums">{d.deliveryNumber}</td>
                <td className="px-3 py-1.5 text-center text-slate-600 tabular-nums">
                  {d.workerId !== null ? `W${d.workerId}` : '—'}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${DECISION_COLORS[d.decision]}`}>
                    {d.decision}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-500 max-w-[280px] truncate" title={d.reason}>
                  {d.reason}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">T{d.logicalTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > maxRows && (
        <div className="p-2 text-center text-[11px] text-slate-400 bg-slate-50">
          Showing first {maxRows} of {filtered.length} entries. Use filters to narrow results.
        </div>
      )}
    </div>
  );
}
