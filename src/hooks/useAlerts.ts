import { useState, useEffect, useCallback } from 'react';
import { Alert } from '../types';
import { getAlerts } from '../api/alerts';
import { useGuest } from '../context/GuestContext';

export function useAlerts(params?: Record<string, string>) {
  const { isGuest, guestAlerts } = useGuest();

  const getFiltered = useCallback(() => {
    let list = guestAlerts;
    if (params?.type) list = list.filter(a => a.type === params.type);
    const limit = params?.limit ? parseInt(params.limit) : undefined;
    return limit ? list.slice(0, limit) : list;
  }, [guestAlerts, JSON.stringify(params)]);

  const [alerts, setAlerts] = useState<Alert[]>(isGuest ? getFiltered() : []);
  const [total, setTotal] = useState(isGuest ? getFiltered().length : 0);
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (isGuest) {
      const filtered = getFiltered();
      setAlerts(filtered);
      setTotal(filtered.length);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await getAlerts(params);
      setAlerts(
        result.alerts.map((a) => ({
          id: a.id,
          timestamp: a.timestamp,
          type: a.type,
          message: a.message,
          source: a.source,
        }))
      );
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isGuest, JSON.stringify(params), getFiltered]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  return { alerts, total, loading, error, refetch: fetchAlerts };
}
