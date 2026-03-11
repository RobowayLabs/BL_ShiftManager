import { apiClient } from './client';

interface DashboardStats {
  totalEmployees: number;
  activeShifts: number;
  alertsToday: number;
  criticalAlerts: number;
}

interface TrendData {
  data: { name: string; alerts: number }[];
}

interface DistributionData {
  data: { name: string; value: number; fill: string }[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return apiClient<DashboardStats>('/dashboard/stats');
}

export async function getAlertTrends(): Promise<TrendData> {
  return apiClient<TrendData>('/dashboard/alert-trends');
}

export async function getAlertDistribution(): Promise<DistributionData> {
  return apiClient<DistributionData>('/dashboard/alert-distribution');
}
