import { useState, useEffect, useCallback } from 'react';
import { Alert } from '../types';
import { getAlerts } from '../api/alerts';

export function useAlerts(params?: Record<string, string>) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramsKey = params ? JSON.stringify(params) : '';

  const fetchAlerts = useCallback(async () => {
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
  }, [paramsKey]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  return { alerts, total, loading, error, refetch: fetchAlerts };
}
