import { useState } from 'react';
import { Sidebar, PageId } from '@/components/Sidebar';
import { OverviewPage } from '@/components/OverviewPage';
import { SimulatorPage } from '@/components/SimulatorPage';
import { ExperimentsPage } from '@/components/ExperimentsPage';
import { ResultsPage } from '@/components/ResultsPage';
import { DocumentationPage } from '@/components/DocumentationPage';
import { useSimulation } from '@/hooks/useSimulation';

function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('overview');
  const sim = useSimulation();

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="flex-1 overflow-hidden">
        {currentPage === 'overview' && <OverviewPage onNavigate={setCurrentPage} />}
        {currentPage === 'simulator' && <SimulatorPage sim={sim} />}
        {currentPage === 'experiments' && <ExperimentsPage sim={sim} onNavigate={setCurrentPage} />}
        {currentPage === 'results' && <ResultsPage sim={sim} onNavigate={setCurrentPage} />}
        {currentPage === 'documentation' && <DocumentationPage />}
      </main>
    </div>
  );
}

export default App;
