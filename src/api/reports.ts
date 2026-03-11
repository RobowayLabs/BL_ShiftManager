import { apiClient } from './client';

export interface FullReportRow {
  id: string;
  date: string;
  empIdText: string;
  empName: string;
  department: string;
  shiftType: 'Morning' | 'Afternoon' | 'Night';
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: string;
  workSeconds: number;
  alerts: { drowsy: number; sleep: number; phone: number; absence: number };
  totalAlerts: number;
  performanceGrade: 'Excellent' | 'Good' | 'Poor';
}

export async function getFullReport(from: string, to: string): Promise<{ rows: FullReportRow[]; total: number }> {
  return apiClient(`/reports/full?from=${from}&to=${to}`);
}
