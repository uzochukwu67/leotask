import { useState } from 'react';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './components/dashboard/Dashboard';
import { TaskCreation } from './components/tasks/TaskCreation';

function App() {
  // Simple state router for demo purposes
  const [currentView, setCurrentView] = useState<'dashboard' | 'create'>('dashboard');

  return (
    <Layout>
      {/* View Switcher Header */}
      <div className="flex justify-end gap-4 mb-8">
        <button 
          onClick={() => setCurrentView('dashboard')}
          className={`font-mono text-sm tracking-widest uppercase transition-colors ${currentView === 'dashboard' ? 'text-cyan-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          [ Dashboard ]
        </button>
        <button 
          onClick={() => setCurrentView('create')}
          className={`font-mono text-sm tracking-widest uppercase transition-colors ${currentView === 'create' ? 'text-cyan-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          [ New Task ]
        </button>
      </div>

      {currentView === 'dashboard' ? <Dashboard /> : <TaskCreation />}
    </Layout>
  );
}

export default App;
