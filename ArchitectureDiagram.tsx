import { SimState, ComponentStatus } from '@/sim/types';
import { Layers, ListOrdered, ShieldCheck, Database, Zap } from 'lucide-react';

interface Props {
  state: SimState;
  onComponentClick: (componentId: string) => void;
  selectedComponent: string | null;
}

const COMPONENTS = [
  {
    id: 'producer',
    label: 'Event Producer',
    icon: Layers,
    description: 'Generates logical events with stable unique IDs. Each event represents a single business intent (e.g., one payment).',
  },
  {
    id: 'queue',
    label: 'Message Queue',
    icon: ListOrdered,
    description: 'Holds pending deliveries. Supports duplicate deliveries, reordering, and retries. Deliveries preserve the original event ID.',
  },
  {
    id: 'dedup',
    label: 'De-duplication Engine',
    icon: ShieldCheck,
    description: 'Inspects each delivery\'s event ID against the registry. Decides whether to process, suppress as duplicate, or reject.',
  },
  {
    id: 'registry',
    label: 'Processed Event Registry',
    icon: Database,
    description: 'Records the processing state of each event ID. When enabled, prevents duplicate business effects for the same logical event.',
  },
  {
    id: 'effect',
    label: 'Business Effect',
    icon: Zap,
    description: 'The real-world side effect of processing — e.g., charging a card, updating inventory, sending a notification. Should happen exactly once per logical event.',
  },
];

const STATUS_COLORS: Record<ComponentStatus, string> = {
  Idle: 'bg-slate-100 text-slate-500 border-slate-200',
  Active: 'bg-blue-50 text-blue-600 border-blue-200',
  Processing: 'bg-amber-50 text-amber-600 border-amber-200',
  Completed: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  Failed: 'bg-red-50 text-red-600 border-red-200',
};

export function ArchitectureDiagram({ state, onComponentClick, selectedComponent }: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">System Architecture</h3>
        <span className="text-xs text-slate-400">Click any component for details</span>
      </div>

      <div className="flex items-center justify-between gap-1 overflow-x-auto pb-2">
        {COMPONENTS.map((comp, idx) => {
          const Icon = comp.icon;
          const status = state.componentStatuses[comp.id] || 'Idle';
          const isSelected = selectedComponent === comp.id;
          const isDimmed = comp.id === 'dedup' || comp.id === 'registry';
          const isDisabled = isDimmed && !state.config.deduplicationEnabled;

          return (
            <div key={comp.id} className="flex items-center flex-shrink-0">
              <button
                onClick={() => onComponentClick(comp.id)}
                className={`relative flex flex-col items-center gap-2 px-4 py-3 border rounded-md transition-all min-w-[130px] ${
                  isSelected
                    ? 'border-slate-400 bg-slate-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                } ${isDisabled ? 'opacity-40' : ''}`}
              >
                <Icon size={22} className="text-slate-600" />
                <span className="text-xs font-medium text-slate-700 text-center leading-tight">{comp.label}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[status]}`}>
                  {isDisabled ? 'Off' : status}
                </span>
              </button>
              {idx < COMPONENTS.length - 1 && (
                <div className="flex items-center px-1">
                  <svg width="28" height="20" viewBox="0 0 28 20" className="text-slate-300">
                    <line x1="0" y1="10" x2="20" y2="10" stroke="currentColor" strokeWidth="1.5" />
                    <polygon points="20,6 28,10 20,14" fill="currentColor" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedComponent && (
        <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-md">
          {COMPONENTS.filter((c) => c.id === selectedComponent).map((c) => (
            <div key={c.id}>
              <p className="text-xs font-semibold text-slate-700 mb-1">{c.label}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{c.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
