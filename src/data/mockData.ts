import { format, subDays, addDays, parseISO } from 'date-fns';
import { Employee, Shift, Alert } from '../types';
import { EmployeePerformance } from '../api/employees';

// ─── Employees ───────────────────────────────────────────────────────────────

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'EMP101', name: 'Sihab Hossain',  department: 'NetOPS', active: true  },
  { id: 'EMP102', name: 'Farhan Ahmed',   department: 'NOC',    active: true  },
  { id: 'EMP103', name: 'Nadia Rahman',   department: 'NetOPS', active: true  },
  { id: 'EMP104', name: 'Karim Uddin',    department: 'NOC',    active: true  },
  { id: 'EMP105', name: 'Taslima Begum',  department: 'NetOPS', active: true  },
  { id: 'EMP106', name: 'Rakib Hassan',   department: 'NOC',    active: false },
  { id: 'EMP107', name: 'Sumaiya Khan',   department: 'NOC',    active: true  },
  { id: 'EMP108', name: 'Arif Billah',    department: 'NetOPS', active: true  },
];

// ─── Shift seed ───────────────────────────────────────────────────────────────

type ShiftType = 'Morning' | 'Afternoon' | 'Night';
const TYPES: ShiftType[] = ['Morning', 'Afternoon', 'Night'];
const TIMES: Record<ShiftType, { s: string; e: string }> = {
  Morning:   { s: '08:00', e: '16:00' },
  Afternoon: { s: '16:00', e: '00:00' },
  Night:     { s: '00:00', e: '08:00' },
};
const STATUSES = ['Completed', 'Completed', 'Completed', 'Missed', 'Scheduled', 'In Progress'];

function seedShifts(): Shift[] {
  const today = new Date();
  const shifts: Shift[] = [];
  let id = 1;

  // Past 30 days
  for (let d = 30; d >= 1; d--) {
    const date = format(subDays(today, d), 'yyyy-MM-dd');
    MOCK_EMPLOYEES.filter(e => e.active).forEach((emp, ei) => {
      const type = TYPES[(ei + d) % 3];
      const status = STATUSES[(ei + d) % STATUSES.length];
      shifts.push({
        id: String(id++),
        employeeId: emp.id,
        date,
        type,
        startTime: TIMES[type].s,
        endTime: TIMES[type].e,
        status,
        aiMetadata: {
          alerts: {
            drowsy:  Math.floor(((ei * 7 + d * 3) % 5)),
            sleep:   Math.floor(((ei * 3 + d * 7) % 2)),
            phone:   Math.floor(((ei * 5 + d * 2) % 4)),
            absence: Math.floor(((ei * 2 + d * 5) % 2)),
          },
        },
      });
    });
  }

  // Today + next 7 days
  for (let d = 0; d <= 7; d++) {
    const date = format(addDays(today, d), 'yyyy-MM-dd');
    MOCK_EMPLOYEES.filter(e => e.active).forEach((emp, ei) => {
      const type = TYPES[(ei + d) % 3];
      const status = d === 0 ? 'In Progress' : 'Scheduled';
      shifts.push({
        id: String(id++),
        employeeId: emp.id,
        date,
        type,
        startTime: TIMES[type].s,
        endTime: TIMES[type].e,
        status,
        aiMetadata: { alerts: { drowsy: 0, sleep: 0, phone: 0, absence: 0 } },
      });
    });
  }

  return shifts;
}

export const MOCK_SHIFTS: Shift[] = seedShifts();

// ─── Alerts ───────────────────────────────────────────────────────────────────

const ALERT_TEMPLATES = [
  { type: 'Critical' as const, message: 'Employee fell asleep during night shift',      source: 'Camera-01', category: 'sleep'   },
  { type: 'Critical' as const, message: 'Prolonged absence from workstation detected',  source: 'Camera-03', category: 'absence' },
  { type: 'Warning'  as const, message: 'Drowsiness detected — eye-closure pattern',    source: 'Camera-02', category: 'drowsy'  },
  { type: 'Warning'  as const, message: 'Unauthorized phone usage detected',             source: 'Camera-04', category: 'phone'   },
  { type: 'Warning'  as const, message: 'Multiple drowsiness events in last 30 min',    source: 'Camera-01', category: 'drowsy'  },
  { type: 'Info'     as const, message: 'Late check-in recorded (+12 min)',              source: 'System',    category: 'absence' },
  { type: 'Info'     as const, message: 'Short break duration exceeded threshold',       source: 'System',    category: 'absence' },
];

export const MOCK_ALERTS: Alert[] = Array.from({ length: 40 }, (_, i) => {
  const tpl = ALERT_TEMPLATES[i % ALERT_TEMPLATES.length];
  const emp = MOCK_EMPLOYEES[i % MOCK_EMPLOYEES.length];
  const hoursAgo = i * 1.5;
  return {
    id: String(i + 1),
    timestamp: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    type: tpl.type,
    category: tpl.category,
    message: `${emp.name}: ${tpl.message}`,
    source: tpl.source,
  };
});

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export const MOCK_DASHBOARD_STATS = {
  totalEmployees: MOCK_EMPLOYEES.filter(e => e.active).length,
  activeShifts:   3,
  alertsToday:    8,
  criticalAlerts: MOCK_ALERTS.filter(a => a.type === 'Critical').length,
};

export const MOCK_TREND_DATA = Array.from({ length: 7 }, (_, i) => ({
  name: format(subDays(new Date(), 6 - i), 'EEE'),
  alerts: [8, 12, 6, 15, 9, 11, 7][i],
}));

export const MOCK_DISTRIBUTION_DATA = [
  { name: 'Drowsy',  value: 18, fill: '#f59e0b' },
  { name: 'Phone',   value: 10, fill: '#3b82f6' },
  { name: 'Absence', value:  6, fill: '#f97316' },
  { name: 'Sleep',   value:  3, fill: '#ef4444' },
];

// ─── Performance report generator ────────────────────────────────────────────

export function generateMockPerformance(
  employeeId: string,
  from: string,
  to: string
): EmployeePerformance {
  const emp = MOCK_EMPLOYEES.find(e => e.id === employeeId) ?? MOCK_EMPLOYEES[0];
  const fromDate = parseISO(from);
  const toDate   = parseISO(to);

  const relevantShifts = MOCK_SHIFTS.filter(s => {
    const d = parseISO(s.date);
    return s.employeeId === employeeId && d >= fromDate && d <= toDate;
  });

  const completed = relevantShifts.filter(s => s.status === 'Completed').length;
  const missed    = relevantShifts.filter(s => s.status === 'Missed').length;
  const scheduled = relevantShifts.filter(s => s.status === 'Scheduled').length;
  const inProg    = relevantShifts.filter(s => s.status === 'In Progress').length;

  const alertBreakdown = relevantShifts.reduce(
    (acc, s) => {
      if (s.aiMetadata?.alerts) {
        acc.drowsy  += s.aiMetadata.alerts.drowsy;
        acc.sleep   += s.aiMetadata.alerts.sleep;
        acc.phone   += s.aiMetadata.alerts.phone;
        acc.absence += s.aiMetadata.alerts.absence;
      }
      return acc;
    },
    { drowsy: 0, sleep: 0, phone: 0, absence: 0 }
  );

  const alertTotal = Object.values(alertBreakdown).reduce((a, b) => a + b, 0);
  const attendanceRate = relevantShifts.length
    ? Math.round((completed / relevantShifts.length) * 100)
    : 0;

  const gradeFor = (s: Shift): 'Excellent' | 'Good' | 'Fair' | 'Poor' => {
    const al = s.aiMetadata?.alerts ?? { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
    const total = al.drowsy + al.sleep + al.phone + al.absence;
    if (s.status === 'Missed') return 'Poor';
    if (total === 0 && s.status === 'Completed') return 'Excellent';
    if (total <= 2) return 'Good';
    if (total <= 5) return 'Fair';
    return 'Poor';
  };

  return {
    employee: { id: emp.id, name: emp.name, department: emp.department, active: emp.active },
    period: { from, to },
    summary: { totalShifts: relevantShifts.length, completed, missed, scheduled, inProgress: inProg, attendanceRate, alertTotal, alertBreakdown },
    shifts: relevantShifts.map(s => ({
      id: s.id,
      date: s.date,
      shiftType: s.type,
      startTime: s.startTime ?? '',
      endTime:   s.endTime ?? '',
      status:    s.status ?? 'Scheduled',
      checkIn:   s.aiMetadata?.actualStart,
      checkOut:  s.aiMetadata?.actualEnd,
      alerts:    s.aiMetadata?.alerts ?? { drowsy: 0, sleep: 0, phone: 0, absence: 0 },
      grade:     gradeFor(s),
    })),
  };
}
