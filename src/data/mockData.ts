import { Employee, Alert, Shift } from '../types';

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'EMP001', name: 'Sarah Jenkins', department: 'Network Ops', status: 'Active', email: 's.jenkins@nmc.ai', role: 'Senior Engineer' },
  { id: 'EMP002', name: 'Michael Chen', department: 'Security', status: 'Active', email: 'm.chen@nmc.ai', role: 'Security Analyst' },
  { id: 'EMP003', name: 'Elena Rodriguez', department: 'Infrastructure', status: 'On Break', email: 'e.rodriguez@nmc.ai', role: 'DevOps Lead' },
  { id: 'EMP004', name: 'David Smith', department: 'Network Ops', status: 'Off Duty', email: 'd.smith@nmc.ai', role: 'Junior Engineer' },
  { id: 'EMP005', name: 'Aisha Khan', department: 'AI Research', status: 'Active', email: 'a.khan@nmc.ai', role: 'Data Scientist' },
];

export const MOCK_ALERTS: Alert[] = [
  { id: 'ALT-101', timestamp: '2026-02-21 10:15', type: 'Critical', message: 'Drowsiness detected: Sarah Jenkins', source: 'AI-Cam-04' },
  { id: 'ALT-102', timestamp: '2026-02-21 10:45', type: 'Warning', message: 'Mobile usage detected: Michael Chen', source: 'AI-Cam-02' },
  { id: 'ALT-103', timestamp: '2026-02-21 11:00', type: 'Critical', message: 'Absence from desk: Elena Rodriguez', source: 'AI-Cam-01' },
  { id: 'ALT-104', timestamp: '2026-02-21 11:20', type: 'Warning', message: 'Sleep detection: David Smith', source: 'AI-Cam-03' },
];

export const MOCK_SHIFTS: Shift[] = [
  { 
    id: 'SH-1', 
    employeeId: 'EMP001', 
    date: '2026-02-21', 
    type: 'Morning Shift',
    aiMetadata: {
      startTime: '08:02:15',
      endTime: '16:05:30',
      breakTime: '00:45:00',
      alerts: { drowsiness: 0, sleeping: 0, mobileUsage: 2, absence: 1 }
    }
  },
  { 
    id: 'SH-2', 
    employeeId: 'EMP002', 
    date: '2026-02-21', 
    type: 'Morning Shift',
    aiMetadata: {
      startTime: '07:58:45',
      endTime: '16:02:10',
      breakTime: '01:00:00',
      alerts: { drowsiness: 1, sleeping: 1, mobileUsage: 0, absence: 0 }
    }
  },
  { 
    id: 'SH-3', 
    employeeId: 'EMP005', 
    date: '2026-02-21', 
    type: 'Day Shift',
    aiMetadata: {
      startTime: '16:05:00',
      endTime: '00:08:00',
      breakTime: '00:30:00',
      alerts: { drowsiness: 0, sleeping: 0, mobileUsage: 5, absence: 2 }
    }
  },
  { id: 'SH-4', employeeId: 'EMP003', date: '2026-02-22', type: 'Morning Shift' },
  { id: 'SH-5', employeeId: 'EMP004', date: '2026-02-22', type: 'Day Shift' },
  { id: 'SH-6', employeeId: 'EMP001', date: '2026-02-23', type: 'Night Shift' },
];

export const ALERT_TREND_DATA = [
  { name: '00:00', alerts: 4 },
  { name: '04:00', alerts: 2 },
  { name: '08:00', alerts: 8 },
  { name: '12:00', alerts: 12 },
  { name: '16:00', alerts: 7 },
  { name: '20:00', alerts: 5 },
];

export const ALERT_TYPE_DATA = [
  { name: 'Drowsiness', value: 15, fill: '#ef4444' },
  { name: 'Sleeping', value: 10, fill: '#f59e0b' },
  { name: 'Mobile Usage', value: 45, fill: '#06b6d4' },
  { name: 'Absence', value: 30, fill: '#6366f1' },
];
