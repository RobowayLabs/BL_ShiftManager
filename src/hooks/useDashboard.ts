import { useState, useEffect, useCallback } from 'react';
import { getDashboardStats, getAlertTrends, getAlertDistribution } from '../api/dashboard';
import { useGuest } from '../context/GuestContext';

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
  const { isGuest, guestDashboardStats, guestTrendData, guestDistributionData } = useGuest();

  const [data, setData] = useState<DashboardData>({
    stats: isGuest ? guestDashboardStats : null,
    trendData: isGuest ? guestTrendData : [],
    distributionData: isGuest ? guestDistributionData : [],
  });
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (isGuest) {
      setData({ stats: guestDashboardStats, trendData: guestTrendData, distributionData: guestDistributionData });
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [stats, trends, distribution] = await Promise.all([
        getDashboardStats(),
        getAlertTrends(),
        getAlertDistribution(),
      ]);
      setData({ stats, trendData: trends.data, distributionData: distribution.data });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isGuest, guestDashboardStats, guestTrendData, guestDistributionData]);

  useEffect(() => {
    fetchDashboard();
    if (!isGuest && refreshInterval) {
      const interval = setInterval(fetchDashboard, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchDashboard, refreshInterval, isGuest]);

  return { ...data, loading, error, refetch: fetchDashboard };
}
