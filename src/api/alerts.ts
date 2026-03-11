import { apiClient } from './client';

interface AlertItem {
  id: string;
  timestamp: string;
  type: 'Critical' | 'Warning' | 'Info';
  category: string;
  message: string;
  source: string;
  employeeId?: string;
  acknowledged: boolean;
}

interface AlertsResponse {
  alerts: AlertItem[];
  total: number;
}

export async function getAlerts(params?: Record<string, string>): Promise<AlertsResponse> {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiClient<AlertsResponse>(`/alerts${query}`);
}

export async function acknowledgeAlert(alertId: string): Promise<{ alert: AlertItem }> {
  return apiClient<{ alert: AlertItem }>(`/alerts/${alertId}/acknowledge`, {
    method: 'PUT',
  });
}
