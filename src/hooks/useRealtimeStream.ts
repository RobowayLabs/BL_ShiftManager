'use client';

// Thin wrapper — actual SSE lives inside NotificationContext (single shared connection).
// Dashboard imports this hook and gets live data without opening a second connection.
import { useNotifications } from '../context/NotificationContext';

export function useRealtimeStream() {
  const { connected, liveStats, liveAlerts, newAlertIds } = useNotifications();
  return {
    connected,
    stats:       liveStats,
    alerts:      liveAlerts,
    newAlertIds,
  };
}
