'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert } from '../types';

interface Stats {
  totalEmployees: number;
  activeShifts: number;
  alertsToday: number;
  criticalAlerts: number;
}

interface RealtimeState {
  connected: boolean;
  stats: Stats | null;
  alerts: Alert[];
  newAlertIds: Set<string>; // IDs of alerts that just arrived (for flash animation)
}

function mapAlert(a: any): Alert {
  return {
    id: a.id,
    timestamp: a.timestamp,
    type: a.type,
    message: a.message,
    source: a.source,
  };
}

export function useRealtimeStream() {
  const [state, setState] = useState<RealtimeState>({
    connected: false,
    stats: null,
    alerts: [],
    newAlertIds: new Set(),
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return;

    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
      // Clear any pending reconnect timer
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') return;

        if (msg.type === 'init') {
          setState((prev) => ({
            ...prev,
            stats: msg.stats,
            alerts: msg.alerts.map(mapAlert),
            newAlertIds: new Set(),
          }));
        }

        if (msg.type === 'stats') {
          setState((prev) => ({ ...prev, stats: msg.stats }));
        }

        if (msg.type === 'alerts') {
          const incoming: Alert[] = msg.alerts.map(mapAlert);
          const incomingIds = new Set(incoming.map((a) => a.id));

          setState((prev) => {
            // Prepend new alerts, deduplicate by id, keep latest 50
            const merged = [...incoming, ...prev.alerts].reduce<Alert[]>((acc, a) => {
              if (!acc.find((x) => x.id === a.id)) acc.push(a);
              return acc;
            }, []).slice(0, 50);

            return {
              ...prev,
              alerts: merged,
              newAlertIds: incomingIds,
            };
          });

          // Clear the "new" highlight after 3 seconds
          if (newAlertTimer.current) clearTimeout(newAlertTimer.current);
          newAlertTimer.current = setTimeout(() => {
            setState((prev) => ({ ...prev, newAlertIds: new Set() }));
          }, 3000);
        }
      } catch {
        // malformed event — ignore
      }
    };

    es.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
      es.close();
      // EventSource auto-reconnects, but we add our own delay to avoid hammering
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (newAlertTimer.current) clearTimeout(newAlertTimer.current);
    };
  }, [connect]);

  return state;
}
