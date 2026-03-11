import { useState } from "react";
import { 
  LayoutDashboard, 
  Calendar, 
  Users, 
  BarChart3, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Activity,
  LogOut
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./Button";

interface SidebarProps {
  activePage: string;
  onPageChange: (page: string) => void;
  onLogout?: () => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'planner', label: 'Shift Planner', icon: Calendar },
  { id: 'viewer', label: 'Shift Viewer', icon: Activity },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar = ({ activePage, onPageChange, onLogout }: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={cn(
      "h-screen bg-brand-card border-r border-brand-border transition-all duration-300 flex flex-col",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-brand-accent rounded-md flex items-center justify-center flex-shrink-0">
          <Activity className="w-5 h-5 text-slate-900" />
        </div>
        {!isCollapsed && (
          <span className="font-bold text-lg tracking-tight text-slate-100 truncate">
            Banglalink <span className="text-brand-accent">SM</span>
          </span>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                isActive 
                  ? "bg-brand-accent/10 text-brand-accent" 
                  : "text-brand-text-muted hover:bg-slate-800 hover:text-slate-100"
              )}
            >
              <Icon className={cn("w-5 h-5", isActive ? "text-brand-accent" : "text-brand-text-muted group-hover:text-slate-100")} />
              {!isCollapsed && <span className="font-medium text-sm">{item.label}</span>}
              {isActive && !isCollapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-accent" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-brand-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-brand-text-muted hover:bg-red-500/10 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5" />
          {!isCollapsed && <span className="font-medium text-sm">Logout</span>}
        </button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="mt-4 w-full flex justify-center"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>
    </aside>
  );
};
