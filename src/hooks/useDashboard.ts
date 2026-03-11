import { useState, useEffect, useCallback } from 'react';
import {
  getDashboardStats,
  getAlertTrends,
  getAlertDistribution,
} from '../api/dashboard';

interface DashboardData {
  stats: {
    totalEmployees: number;
    activeShifts: number;
    alertsToday: number;
    criticalAlerts: number;
  } | null;
  trendData: { name: string; alerts: number }[];
  distributionData: { name: string; value: number; fill: string }[];
}

export function useDashboard(refreshInterval?: number) {
  const [data, setData] = useState<DashboardData>({
    stats: null,
    trendData: [],
    distributionData: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setError(null);
      const [stats, trends, distribution] = await Promise.all([
        getDashboardStats(),
        getAlertTrends(),
        getAlertDistribution(),
      ]);
      setData({
        stats,
        trendData: trends.data,
        distributionData: distribution.data,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();

    if (refreshInterval) {
      const interval = setInterval(fetchDashboard, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchDashboard, refreshInterval]);

  return { ...data, loading, error, refetch: fetchDashboard };
}
