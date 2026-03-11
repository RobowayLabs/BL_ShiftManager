import { useState, useEffect, useCallback } from 'react';
import { Shift } from '../types';
import { getShifts } from '../api/shifts';

export function useShifts(params?: Record<string, string>) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramsKey = params ? JSON.stringify(params) : '';

  const fetchShifts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getShifts(params);
      setShifts(result.shifts);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [paramsKey]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  return { shifts, total, loading, error, refetch: fetchShifts };
}
