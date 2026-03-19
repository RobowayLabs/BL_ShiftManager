'use client';

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef,
} from 'react';

export interface AppNotification {
  id: string;
  type: 'alert' | 'employee' | 'shift' | 'system';
  title: string;
  message: string;
  timestamp: string;
  category?: string;
}

interface LiveStats {
  totalEmployees: number;
  activeShifts: number;
  alertsToday: number;
  criticalAlerts: number;
}

interface LiveAlert {
  id: string;
  timestamp: string;
  type: string;
  category?: string;
  message: string;
  source: string;
  employeeId?: string;
  acknowledged?: boolean;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  connected: boolean;
  markAllRead: () => void;
  clearAll: () => void;
  // Live SSE data (shared with Dashboard)
  liveStats: LiveStats | null;
  liveAlerts: LiveAlert[];
  newAlertIds: Set<string>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount]   = useState(0);
  const [connected, setConnected]       = useState(false);
  const [liveStats, setLiveStats]       = useState<LiveStats | null>(null);
  const [liveAlerts, setLiveAlerts]     = useState<LiveAlert[]>([]);
  const [newAlertIds, setNewAlertIds]   = useState<Set<string>>(new Set());

  const prevStats        = useRef<LiveStats | null>(null);
  const esRef            = useRef<EventSource | null>(null);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newAlertTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushNotification = useCallback((n: Omit<AppNotification, 'id'> & { id?: string }) => {
    const notif: AppNotification = { id: n.id ?? `n-${Date.now()}-${Math.random()}`, ...n };
    setNotifications(prev => {
      if (prev.find(x => x.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 50);
    });
    setUnreadCount(c => c + 1);
  }, []);

  const markAllRead = useCallback(() => setUnreadCount(0), []);
  const clearAll    = useCallback(() => { setNotifications([]); setUnreadCount(0); }, []);

  const connect = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') return;

        // ── INIT: snapshot on first connect ──────────────────────────────
        if (msg.type === 'init') {
          setLiveStats(msg.stats);
          setLiveAlerts(msg.alerts ?? []);
          prevStats.current = msg.stats;
          return;
        }

        // ── STATS: detect employee / shift changes ────────────────────────
        if (msg.type === 'stats') {
          const prev = prevStats.current;
          const next: LiveStats = msg.stats;

          if (prev) {
            if (next.totalEmployees > prev.totalEmployees) {
              const diff = next.totalEmployees - prev.totalEmployees;
              pushNotification({
                type: 'employee',
                title: 'New Employee Added',
                message: `${diff} new employee${diff > 1 ? 's' : ''} joined the system`,
                timestamp: new Date().toISOString(),
              });
            }
            if (next.activeShifts > prev.activeShifts) {
              const diff = next.activeShifts - prev.activeShifts;
              pushNotification({
                type: 'shift',
                title: 'Shift Started',
                message: `${diff} shift${diff > 1 ? 's' : ''} now in progress`,
                timestamp: new Date().toISOString(),
              });
            }
          }

          setLiveStats(next);
          prevStats.current = next;
          return;
        }

        // ── ALERTS: push notifications + update live list ─────────────────
        if (msg.type === 'alerts') {
          const incoming: LiveAlert[] = msg.alerts ?? [];
          const ids = new Set<string>(incoming.map(a => a.id));

          incoming.forEach(a => {
            const cat = a.category ?? '';
            pushNotification({
              id: `alert-${a.id}`,
              type: 'alert',
              title: `${cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : a.type} Alert`,
              message: a.message || `${cat} detected`,
              timestamp: a.timestamp,
              category: cat,
            });
          });

          setLiveAlerts(prev => {
            const merged = [...incoming, ...prev]
              .reduce<LiveAlert[]>((acc, a) => {
                if (!acc.find(x => x.id === a.id)) acc.push(a);
                return acc;
              }, [])
              .slice(0, 50);
            return merged;
          });

          setNewAlertIds(ids);
          if (newAlertTimer.current) clearTimeout(newAlertTimer.current);
          newAlertTimer.current = setTimeout(() => setNewAlertIds(new Set()), 3000);
        }
      } catch {
        // malformed — ignore
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, [pushNotification]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (newAlertTimer.current)  clearTimeout(newAlertTimer.current);
    };
  }, [connect]);

  return (
    <NotificationContext.Provider value={{
      notifications, unreadCount, connected,
      markAllRead, clearAll,
      liveStats, liveAlerts, newAlertIds,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
