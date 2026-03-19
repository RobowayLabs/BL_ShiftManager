import { useState, useEffect, useCallback } from 'react';
import { Employee } from '../types';
import { getEmployees } from '../api/employees';
import { useGuest } from '../context/GuestContext';

export function useEmployees(search?: string, department?: string) {
  const { isGuest, guestEmployees } = useGuest();

  const getFiltered = useCallback(() => {
    let list = guestEmployees;
    if (search) list = list.filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.id.toLowerCase().includes(search.toLowerCase())
    );
    if (department) list = list.filter(e => e.department === department);
    return list;
  }, [guestEmployees, search, department]);

  const [employees, setEmployees] = useState<Employee[]>(isGuest ? getFiltered() : []);
  const [total, setTotal] = useState(isGuest ? getFiltered().length : 0);
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    if (isGuest) {
      const filtered = getFiltered();
      setEmployees(filtered);
      setTotal(filtered.length);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (department) params.set('department', department);
      const result = await getEmployees(params.toString());
      setEmployees(result.employees);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isGuest, search, department, getFiltered]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  return { employees, total, loading, error, refetch: fetchEmployees };
}
