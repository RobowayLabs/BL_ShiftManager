import { apiClient } from './client';
import { Shift } from '../types';

interface ShiftsResponse {
  shifts: Shift[];
  total: number;
}

interface ShiftResponse {
  shift: Shift;
}

export async function getShifts(params?: Record<string, string>): Promise<ShiftsResponse> {
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiClient<ShiftsResponse>(`/shifts${query}`);
}

export async function getShift(shiftId: string): Promise<ShiftResponse> {
  return apiClient<ShiftResponse>(`/shifts/${shiftId}`);
}

export async function createShift(data: {
  employeeId: string;
  date: string;
  type: string;
}): Promise<ShiftResponse> {
  return apiClient<ShiftResponse>('/shifts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateShift(
  shiftId: string,
  data: Partial<{ employeeId: string; date: string; type: string; status: string }>
): Promise<ShiftResponse> {
  return apiClient<ShiftResponse>(`/shifts/${shiftId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteShift(shiftId: string): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>(`/shifts/${shiftId}`, {
    method: 'DELETE',
  });
}
