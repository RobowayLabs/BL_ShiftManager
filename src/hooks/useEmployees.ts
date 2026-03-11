import { useState, useEffect, useCallback } from 'react';
import { Employee } from '../types';
import { getEmployees } from '../api/employees';

export function useEmployees(search?: string, department?: string) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
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
  }, [search, department]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  return { employees, total, loading, error, refetch: fetchEmployees };
}
