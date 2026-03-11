import { apiClient } from './client';
import { Employee } from '../types';

interface EmployeesResponse {
  employees: Employee[];
  total: number;
}

interface EmployeeResponse {
  employee: Employee;
}

export async function getEmployees(params?: string): Promise<EmployeesResponse> {
  const query = params ? `?${params}` : '';
  return apiClient<EmployeesResponse>(`/employees${query}`);
}

export async function getEmployee(employeeId: string): Promise<EmployeeResponse> {
  return apiClient<EmployeeResponse>(`/employees/${employeeId}`);
}

export interface PerformanceShift {
  id: string;
  date: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
  alerts: { drowsy: number; sleep: number; phone: number; absence: number };
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
}

export interface EmployeePerformance {
  employee: { id: string; name: string; department: string; active: boolean };
  period: { from: string; to: string };
  summary: {
    totalShifts: number;
    completed: number;
    missed: number;
    scheduled: number;
    inProgress: number;
    attendanceRate: number;
    alertTotal: number;
    alertBreakdown: { drowsy: number; sleep: number; phone: number; absence: number };
  };
  shifts: PerformanceShift[];
}

export async function getEmployeePerformance(
  employeeId: string,
  from: string,
  to: string
): Promise<EmployeePerformance> {
  return apiClient<EmployeePerformance>(
    `/employees/${employeeId}/performance?from=${from}&to=${to}`
  );
}
