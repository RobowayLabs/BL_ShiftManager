'use client';

import { Bell, Search, User, X, AlertTriangle, Users, Clock, ChevronRight } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useNotifications, AppNotification } from '../context/NotificationContext';

interface HeaderProps {
  title: string;
  userName?: string;
  userRole?: string;
  onNavigate?: (page: string) => void;
}

interface SearchResults {
  employees: { id: string; name: string; department: string; active: boolean }[];
  alerts:    { id: string; message: string; category: string; type: string; timestamp: string }[];
  shifts:    { id: string; employeeId: string; date: string; type: string; status: string }[];
}

// ── Notification icon based on type / category ────────────────────────────────
function NotifIcon({ n }: { n: AppNotification }) {
  if (n.type === 'employee') return <Users className="w-4 h-4 text-brand-accent" />;
  if (n.type === 'shift')    return <Clock className="w-4 h-4 text-yellow-400" />;
  const color =
    n.category === 'drowsy'  ? 'text-yellow-400' :
    n.category === 'sleep'   ? 'text-red-400'    :
    n.category === 'phone'   ? 'text-blue-400'   : 'text-orange-400';
  return <AlertTriangle className={`w-4 h-4 ${color}`} />;
}

// ── Header component ──────────────────────────────────────────────────────────
export const Header = ({ title, userName, userRole, onNavigate }: HeaderProps) => {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();

  // — Notification panel state
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // — Search state
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen]     = useState(false);
  const searchRef  = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Bell click → open panel + mark all read
  const handleBell = () => {
    setNotifOpen(prev => {
      if (!prev) markAllRead();
      return !prev;
    });
  };

  // Debounced search
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!q.trim()) {
      setResults(null);
      setSearchOpen(false);
      return;
    }

    setSearchOpen(true);
    setSearchLoading(true);

    searchTimer.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const res   = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Search failed');
        setResults(await res.json());
      } catch {
        setResults(null);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  const clearSearch = () => {
    setQuery('');
    setResults(null);
    setSearchOpen(false);
  };

  const hasResults =
    results && (results.employees.length > 0 || results.alerts.length > 0 || results.shifts.length > 0);

  return (
    <header className="h-16 border-b border-brand-border bg-brand-card/50 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>

      <div className="flex items-center gap-4">

        {/* ── Global Search ──────────────────────────────────────────────── */}
        <div className="relative hidden md:block" ref={searchRef}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onFocus={() => query && setSearchOpen(true)}
            placeholder="Search system…"
            className="bg-slate-800 border border-brand-border rounded-md pl-10 pr-8 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent w-64 transition-all"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-text-muted hover:text-slate-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Search dropdown */}
          {searchOpen && (
            <div className="absolute top-full mt-2 right-0 w-96 bg-slate-900 border border-brand-border rounded-xl shadow-2xl overflow-hidden z-50">
              {searchLoading ? (
                <div className="py-6 text-center text-brand-text-muted text-sm">Searching…</div>
              ) : !hasResults ? (
                <div className="py-6 text-center text-brand-text-muted text-sm">
                  No results for &quot;{query}&quot;
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-brand-border/60">

                  {/* Employees */}
                  {results!.employees.length > 0 && (
                    <section>
                      <p className="px-4 py-2 text-[10px] uppercase tracking-widest text-brand-text-muted bg-slate-800/60 font-semibold">
                        Employees
                      </p>
                      {results!.employees.map(emp => (
                        <button
                          key={emp.id}
                          onClick={() => { onNavigate?.('employees'); clearSearch(); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-brand-accent/15 flex items-center justify-center text-brand-accent font-bold text-xs shrink-0">
                            {emp.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-100 truncate">{emp.name}</p>
                            <p className="text-xs text-brand-text-muted">{emp.department} · {emp.id}</p>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-brand-text-muted shrink-0" />
                        </button>
                      ))}
                    </section>
                  )}

                  {/* Alerts */}
                  {results!.alerts.length > 0 && (
                    <section>
                      <p className="px-4 py-2 text-[10px] uppercase tracking-widest text-brand-text-muted bg-slate-800/60 font-semibold">
                        Alerts
                      </p>
                      {results!.alerts.map(alert => (
                        <button
                          key={alert.id}
                          onClick={() => { onNavigate?.('dashboard'); clearSearch(); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 transition-colors text-left"
                        >
                          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-100 truncate">{alert.message}</p>
                            <p className="text-xs text-brand-text-muted capitalize">
                              {alert.category} · {format(new Date(alert.timestamp), 'MMM d, HH:mm')}
                            </p>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-brand-text-muted shrink-0" />
                        </button>
                      ))}
                    </section>
                  )}

                  {/* Shifts */}
                  {results!.shifts.length > 0 && (
                    <section>
                      <p className="px-4 py-2 text-[10px] uppercase tracking-widest text-brand-text-muted bg-slate-800/60 font-semibold">
                        Shifts
                      </p>
                      {results!.shifts.map(shift => (
                        <button
                          key={shift.id}
                          onClick={() => { onNavigate?.('viewer'); clearSearch(); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 transition-colors text-left"
                        >
                          <Clock className="w-4 h-4 text-brand-accent shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-100">{shift.employeeId} · {shift.type}</p>
                            <p className="text-xs text-brand-text-muted">{shift.date} · {shift.status}</p>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-brand-text-muted shrink-0" />
                        </button>
                      ))}
                    </section>
                  )}

                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Notification Bell ─────────────────────────────────────────── */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={handleBell}
            className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Notifications"
          >
            <Bell className={`w-5 h-5 transition-colors ${unreadCount > 0 ? 'text-slate-100' : 'text-brand-text-muted'}`} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-brand-danger rounded-full border-2 border-brand-card flex items-center justify-center text-[9px] font-bold text-white leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-96 bg-slate-900 border border-brand-border rounded-xl shadow-2xl z-50">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
                <h3 className="text-sm font-semibold text-slate-100">
                  Notifications
                  {notifications.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-brand-text-muted">
                      ({notifications.length})
                    </span>
                  )}
                </h3>
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-brand-text-muted hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Empty state */}
              {notifications.length === 0 ? (
                <div className="py-14 text-center">
                  <Bell className="w-8 h-8 text-brand-text-muted mx-auto mb-3 opacity-30" />
                  <p className="text-sm text-brand-text-muted">No notifications yet</p>
                  <p className="text-xs text-brand-text-muted/60 mt-1">New alerts and events will appear here</p>
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto divide-y divide-brand-border/40">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="mt-0.5 shrink-0">
                        <NotifIcon n={n} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-100 leading-snug">{n.title}</p>
                        <p className="text-xs text-brand-text-muted mt-0.5 line-clamp-2 leading-relaxed">
                          {n.message}
                        </p>
                        <p className="text-[10px] text-brand-text-muted/50 mt-1">
                          {format(new Date(n.timestamp), 'MMM d, HH:mm:ss')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-8 w-px bg-brand-border mx-2" />

        {/* ── User info ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pl-2">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-100">{userName || 'Admin User'}</p>
            <p className="text-[10px] text-brand-text-muted uppercase tracking-wider">
              {userRole === 'super_admin' ? 'Super Admin'
                : userRole === 'manager' ? 'Manager'
                : userRole === 'guest'   ? 'Guest Mode'
                : 'User'}
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-accent/20 border border-brand-accent/30 flex items-center justify-center">
            <User className="w-5 h-5 text-brand-accent" />
          </div>
        </div>

      </div>
    </header>
  );
};
