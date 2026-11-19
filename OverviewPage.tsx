import { ShieldCheck, ArrowRight, Layers, ListOrdered, Database, Zap, CheckCircle } from 'lucide-react';
import { PageId } from './Sidebar';

interface Props {
  onNavigate: (page: PageId) => void;
}

export function OverviewPage({ onNavigate }: Props) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={28} className="text-emerald-500" />
          <h1 className="text-2xl font-semibold text-slate-800">Exactly-Once Event De-duplication Engine</h1>
        </div>
        <p className="text-sm text-slate-500 leading-relaxed max-w-2xl">
          An interactive virtual lab for understanding event processing, duplicate detection,
          idempotency, retries, and exactly-once processing semantics. Configure simulations,
          run experiments, inspect individual events, and compare results.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Architecture Summary
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          The system models a linear event-processing pipeline. Each component has a specific
          role in ensuring that logical events produce exactly one business effect.
        </p>
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {[
            { icon: Layers, label: 'Event Producer', desc: 'Generates events with stable IDs' },
            { icon: ListOrdered, label: 'Message Queue', desc: 'Holds and delivers (possibly duplicated)' },
            { icon: ShieldCheck, label: 'Dedup Engine', desc: 'Checks registry, decides process or suppress' },
            { icon: Database, label: 'Registry', desc: 'Records processed event IDs' },
            { icon: Zap, label: 'Business Effect', desc: 'The real-world side effect' },
          ].map((comp, idx) => {
            const Icon = comp.icon;
            return (
              <div key={comp.label} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-md min-w-[110px]">
                  <Icon size={18} className="text-slate-500" />
                  <span className="text-[11px] font-medium text-slate-700 text-center">{comp.label}</span>
                </div>
                {idx < 4 && (
                  <svg width="20" height="12" viewBox="0 0 20 12" className="text-slate-300 mx-0.5">
                    <line x1="0" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" />
                    <polygon points="14,3 20,6 14,9" fill="currentColor" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">What You Can Do</h3>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              Configure event count, duplicate rate, workers, and failure modes
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              Run simulations step-by-step and watch the architecture diagram update in real time
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              Inspect every delivery attempt in the event trace table
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              Compare dedup-enabled vs disabled runs on the same workload
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              Load predefined experiments for specific scenarios
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Core Concepts</h3>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span><strong>Logical event</strong> — a single business intent with a stable ID</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span><strong>Delivery attempt</strong> — one arrival of an event at the queue</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span><strong>Duplicate</strong> — a redelivery of the same logical event ID</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span><strong>Idempotency</strong> — processing the same event twice has the same effect as once</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
              <span><strong>Exactly-once</strong> — each logical event produces exactly one business effect</span>
            </li>
          </ul>
        </div>
      </div>

      <button
        onClick={() => onNavigate('simulator')}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-md hover:bg-slate-900 transition-colors"
      >
        Open Simulator
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
