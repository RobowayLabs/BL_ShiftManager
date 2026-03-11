import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Dashboard } from "./pages/Dashboard";
import { ShiftPlanner } from "./pages/ShiftPlanner";
import { ShiftViewer } from "./pages/ShiftViewer";
import { Employees } from "./pages/Employees";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { motion, AnimatePresence } from "motion/react";

function AppContent() {
  const { user, loading, logout } = useAuth();
  const [activePage, setActivePage] = useState("dashboard");

  if (loading) {
    return (
      <div className="flex h-screen bg-brand-bg items-center justify-center">
        <div className="text-brand-text-muted text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const renderPage = () => {
    switch (activePage) {
      case "dashboard":
        return <Dashboard />;
      case "planner":
        return <ShiftPlanner />;
      case "viewer":
        return <ShiftViewer />;
      case "employees":
        return <Employees />;
      case "reports":
        return <Reports />;
      case "settings":
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  const getPageTitle = () => {
    switch (activePage) {
      case "dashboard": return "System Overview";
      case "planner": return "Shift Planning";
      case "viewer": return "Shift Viewer (Next 7 Days)";
      case "employees": return "Employee Directory";
      case "reports": return "Employee Activity Reports";
      case "settings": return "System Configuration";
      default: return "Dashboard";
    }
  };

  return (
    <div className="flex h-screen bg-brand-bg overflow-hidden">
      <Sidebar activePage={activePage} onPageChange={setActivePage} onLogout={logout} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={getPageTitle()} userName={user.name} userRole={user.role} />

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
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
