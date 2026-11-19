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
  'Late Rejected': 'text-purple-600 bg-purple-50',
  Failed: 'text-red-600 bg-red-50',
  Retried: 'text-blue-600 bg-blue-50',
  Pending: 'text-slate-500 bg-slate-50',
};

const FILTER_OPTIONS: (ProcessingDecision | 'All')[] = [
  'All',
  'Processed',
  'Duplicate Suppressed',
  'Late Rejected',
  'Failed',
  'Retried',
  'Pending',
];

export function EventTraceTable({ deliveries, maxRows = 200 }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProcessingDecision | 'All'>('All');
  const [tagFilter, setTagFilter] = useState<'All' | 'Normal' | 'Late' | 'Duplicate' | 'Burst'>('All');

  const filtered = useMemo(() => {
    return deliveries.filter((d) => {
      if (filter !== 'All' && d.decision !== filter) return false;
      if (search && !d.eventId.toLowerCase().includes(search.toLowerCase())) return false;
      if (tagFilter === 'Normal' && (d.isLate || d.isDuplicate || d.isBurst)) return false;
      if (tagFilter === 'Late' && !d.isLate && d.lateness === 0) return false;
      if (tagFilter === 'Duplicate' && !d.isDuplicate) return false;
      if (tagFilter === 'Burst' && !d.isBurst) return false;
      return true;
    });
  }, [deliveries, search, filter, tagFilter]);

  const visible = filtered.slice(0, maxRows);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Event Trace</h3>
          <p className="text-[11px] text-slate-400">Detailed arrival, lateness, worker assignment, and processing decisions</p>
        </div>
        <span className="text-xs text-slate-400 tabular-nums">{filtered.length} entries</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
        <div className="relative flex-1 min-w-[180px]">
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
        <div className="flex items-center gap-1">
          {(['All', 'Normal', 'Late', 'Duplicate', 'Burst'] as const).map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                tagFilter === tag
                  ? 'bg-slate-700 text-white border-slate-700 font-medium'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="text-left font-medium px-3 py-2">Seq</th>
              <th className="text-left font-medium px-3 py-2">Event ID</th>
              <th className="text-left font-medium px-3 py-2">Type</th>
              <th className="text-center font-medium px-3 py-2">Event Time</th>
              <th className="text-center font-medium px-3 py-2">Arrival Time</th>
              <th className="text-center font-medium px-3 py-2">Tags</th>
              <th className="text-center font-medium px-3 py-2">Deliv.</th>
              <th className="text-center font-medium px-3 py-2">Worker</th>
              <th className="text-left font-medium px-3 py-2">Decision</th>
              <th className="text-left font-medium px-3 py-2 max-w-[260px]">Reason</th>
              <th className="text-right font-medium px-3 py-2">Sim Time</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-8 text-slate-400 text-xs">
                  No deliveries match the current filter. Run a simulation to see event traces.
                </td>
              </tr>
            )}
            {visible.map((d) => (
              <tr
                key={d.uid}
                className={`border-b border-slate-50 hover:bg-slate-50 ${
                  d.decision === 'Late Rejected'
                    ? 'bg-purple-50/25'
                    : d.isDuplicate
                    ? 'bg-amber-50/30'
                    : d.isBurst
                    ? 'bg-purple-50/15'
                    : ''
                }`}
              >
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{d.sequence}</td>
                <td className="px-3 py-1.5 font-mono text-slate-700 font-medium">{d.eventId}</td>
                <td className="px-3 py-1.5 text-slate-600">{d.type}</td>
                <td className="px-3 py-1.5 text-center text-slate-500 tabular-nums">
                  T{d.eventTime ?? d.sequence}
                </td>
                <td className="px-3 py-1.5 text-center text-slate-500 tabular-nums">
                  T{d.arrivalTime ?? d.logicalTime}
                  {d.lateness > 0 && (
                    <span className="ml-1 text-[10px] text-amber-600 font-medium">(+{d.lateness}t)</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-center">
                  <div className="inline-flex items-center gap-1 flex-wrap justify-center">
                    {!d.isLate && !d.isDuplicate && !d.isBurst && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">Normal</span>
                    )}
                    {d.isLate && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 font-medium">
                        Late
                      </span>
                    )}
                    {d.isDuplicate && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 font-medium">
                        Duplicate
                      </span>
                    )}
                    {d.isBurst && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700 font-medium">
                        Burst
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-center text-slate-600 tabular-nums">{d.deliveryNumber}</td>
                <td className="px-3 py-1.5 text-center text-slate-600 tabular-nums">
                  {d.workerId !== null ? `W${d.workerId}` : '—'}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${DECISION_COLORS[d.decision] || 'text-slate-600 bg-slate-100'}`}>
                    {d.decision}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-500 max-w-[260px] truncate" title={d.reason}>
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
