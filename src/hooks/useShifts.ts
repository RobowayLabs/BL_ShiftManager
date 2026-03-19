import { useState, useEffect, useCallback } from 'react';
import { Shift } from '../types';
import { getShifts } from '../api/shifts';
import { useGuest } from '../context/GuestContext';

export function useShifts(params?: Record<string, string>) {
  const { isGuest, guestShifts } = useGuest();

  const paramsKey = params ? JSON.stringify(params) : '';

  const getFiltered = useCallback(() => {
    let list = guestShifts;
    if (params?.from)       list = list.filter(s => s.date >= params.from!);
    if (params?.to)         list = list.filter(s => s.date <= params.to!);
    if (params?.employeeId) list = list.filter(s => s.employeeId === params.employeeId);
    if (params?.type)       list = list.filter(s => s.type === params.type);
    if (params?.status)     list = list.filter(s => s.status === params.status);
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestShifts, paramsKey]);

  const [shifts, setShifts] = useState<Shift[]>(isGuest ? getFiltered() : []);
  const [total, setTotal]   = useState(isGuest ? getFiltered().length : 0);
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError]   = useState<string | null>(null);

  const fetchShifts = useCallback(async () => {
    if (isGuest) {
      const filtered = getFiltered();
      setShifts(filtered);
      setTotal(filtered.length);
      setLoading(false);
      return;
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, paramsKey, getFiltered]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  return { shifts, total, loading, error, refetch: fetchShifts };
}
