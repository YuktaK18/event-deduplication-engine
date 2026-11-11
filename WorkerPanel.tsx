import { WorkerState } from '@/sim/types';
import { Circle, Loader, AlertTriangle, CheckCircle } from 'lucide-react';

interface Props {
  workers: WorkerState[];
  configDedupEnabled: boolean;
  registrySize: number;
  processedCount: number;
}

export function WorkerPanel({ workers, configDedupEnabled, registrySize, processedCount }: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Workers & Registry</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Workers */}
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Worker Pool</p>
          <div className="space-y-1.5">
            {workers.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between px-2.5 py-1.5 border border-slate-100 rounded text-xs"
              >
                <div className="flex items-center gap-2">
                  {w.status === 'idle' && <Circle size={12} className="text-slate-300" />}
                  {w.status === 'busy' && <Loader size={12} className="text-amber-500 animate-spin" />}
                  {w.status === 'crashed' && <AlertTriangle size={12} className="text-red-500" />}
                  <span className="font-medium text-slate-700">Worker {w.id}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                  <span className="text-emerald-500">{w.processedCount} ok</span>
                  {w.failedCount > 0 && <span className="text-red-500">{w.failedCount} fail</span>}
                  <span className={`capitalize ${w.status === 'crashed' ? 'text-red-500' : 'text-slate-400'}`}>
                    {w.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Registry */}
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Processed Event Registry
          </p>
          <div className="border border-slate-100 rounded p-3">
            {configDedupEnabled ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={14} className="text-emerald-500" />
                  <span className="text-xs text-slate-600">Active</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] text-slate-400">Entries</p>
                    <p className="font-semibold text-slate-700 tabular-nums">{registrySize}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">Processed</p>
                    <p className="font-semibold text-emerald-600 tabular-nums">{processedCount}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Circle size={14} className="text-slate-300" />
                <span className="text-xs text-slate-400">De-duplication disabled — registry inactive</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
