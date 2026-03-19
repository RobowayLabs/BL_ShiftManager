'use client';

import { useState } from 'react';
import { Sidebar } from '@/src/components/Sidebar';
import { Header } from '@/src/components/Header';
import { Dashboard } from '@/src/views/Dashboard';
import { ShiftPlanner } from '@/src/views/ShiftPlanner';
import { ShiftViewer } from '@/src/views/ShiftViewer';
import { Employees } from '@/src/views/Employees';
import { Reports } from '@/src/views/Reports';
import { Settings } from '@/src/views/Settings';
import { Login } from '@/src/views/Login';
import { useAuth } from '@/src/context/AuthContext';
import { useGuest } from '@/src/context/GuestContext';
import { motion, AnimatePresence } from 'motion/react';
import { MonitorPlay, X } from 'lucide-react';

function GuestBanner({ onExit }: { onExit: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-400 text-xs shrink-0">
      <MonitorPlay className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">Guest Mode</span>
        {' '}— You&apos;re viewing demo data. All changes exist only in this browser session and are lost on reload.
      </span>
      <button onClick={onExit} className="text-xs underline hover:text-yellow-300 mr-2 transition-colors">
        Exit &amp; Login
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-yellow-400/60 hover:text-yellow-300 transition-colors"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function AppPage() {
  const { user, loading, logout } = useAuth();
  const { isGuest, exitGuest } = useGuest();
  const [activePage, setActivePage] = useState('dashboard');

  if (loading) {
    return (
      <div className="flex h-screen bg-brand-bg items-center justify-center">
        <div className="text-brand-text-muted text-lg">Loading...</div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return <Login />;
  }

  const handleExitGuest = () => {
    exitGuest();
    logout();
  };

  const displayName = isGuest ? 'Guest' : user!.name;
  const displayRole = isGuest ? 'guest' : user!.role;

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':  return <Dashboard />;
      case 'planner':    return <ShiftPlanner />;
      case 'viewer':     return <ShiftViewer />;
      case 'employees':  return <Employees />;
      case 'reports':    return <Reports />;
      case 'settings':   return <Settings />;
      default:           return <Dashboard />;
    }
  };

  const getPageTitle = () => {
    switch (activePage) {
      case 'dashboard':  return 'System Overview';
      case 'planner':    return 'Shift Planning';
      case 'viewer':     return 'Shift Viewer (Next 7 Days)';
      case 'employees':  return 'Employee Directory';
      case 'reports':    return 'Employee Activity Reports';
      case 'settings':   return 'System Configuration';
      default:           return 'Dashboard';
    }
  };

  return (
    <div className="flex h-screen bg-brand-bg overflow-hidden flex-col">
      {isGuest && <GuestBanner onExit={handleExitGuest} />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          activePage={activePage}
          onPageChange={setActivePage}
          onLogout={isGuest ? handleExitGuest : logout}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header title={getPageTitle()} userName={displayName} userRole={displayRole} onNavigate={setActivePage} />
          <main className="flex-1 overflow-y-auto p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {renderPage()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
