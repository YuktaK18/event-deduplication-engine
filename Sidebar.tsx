import { LayoutDashboard, FlaskConical, Beaker, BarChart3, BookOpen, ShieldCheck } from 'lucide-react';

export type PageId = 'overview' | 'simulator' | 'experiments' | 'results' | 'documentation';

interface Props {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

const NAV_ITEMS: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'simulator', label: 'Simulator', icon: FlaskConical },
  { id: 'experiments', label: 'Experiments', icon: Beaker },
  { id: 'results', label: 'Results & Comparison', icon: BarChart3 },
  { id: 'documentation', label: 'Documentation', icon: BookOpen },
];

export function Sidebar({ currentPage, onNavigate }: Props) {
  return (
    <aside className="w-56 bg-slate-800 min-h-screen flex flex-col flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2.5">
          <ShieldCheck size={20} className="text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-white leading-tight">Exactly-Once</p>
            <p className="text-[10px] text-slate-400 leading-tight">De-duplication Engine</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white border-l-2 border-emerald-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-750'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-emerald-400' : ''} />
              <span className="text-left">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-700">
        <p className="text-[10px] text-slate-500">SSD Virtual Lab · BTech Project</p>
      </div>
    </aside>
  );
}
