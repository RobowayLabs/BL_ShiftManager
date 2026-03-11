import { getDB } from '../config/db.js';

export function getEmployees(query: {
  search?: string;
  department?: string;
  active?: string;
}) {
  const db = getDB();

  let sql =
    'SELECT id, name, employee_id, department, active FROM employees WHERE 1=1';
  const params: any[] = [];

  if (query.search) {
    sql += ' AND (name LIKE ? OR employee_id LIKE ?)';
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  if (query.department) {
    sql += ' AND department = ?';
    params.push(query.department);
  }
  if (query.active !== undefined) {
    sql += ' AND active = ?';
    params.push(query.active === 'true' ? 1 : 0);
  }

  sql += ' ORDER BY name';

  const rows = db.prepare(sql).all(...params) as any[];

  return {
    employees: rows.map((e) => ({
      id: e.employee_id,
      name: e.name,
      department: e.department || '',
      active: e.active === 1,
    })),
    total: rows.length,
  };
}

export function getEmployeeById(employeeId: string) {
  const db = getDB();

  const e = db
    .prepare(
      'SELECT id, name, employee_id, department, active FROM employees WHERE employee_id = ?'
    )
    .get(employeeId) as any;

  if (!e) throw new Error('Employee not found');

  return {
    id: e.employee_id,
    name: e.name,
    department: e.department || '',
    active: e.active === 1,
  };
}

export function getEmployeePerformance(
  employeeId: string,
  from: string,
  to: string
) {
  const db = getDB();

  const emp = db
    .prepare('SELECT id, name, employee_id, department, active FROM employees WHERE employee_id = ?')
    .get(employeeId) as any;
  if (!emp) throw new Error('Employee not found');

  // Shifts in range
  const shiftRows = db.prepare(`
    SELECT sa.id, sa.date, sa.status, sa.actual_start, sa.actual_end,
           s.label AS shift_type, s.start_time, s.end_time
    FROM shift_assignments sa
    JOIN shifts s ON sa.shift_id = s.id
    WHERE sa.employee_id = ? AND sa.date >= ? AND sa.date <= ?
    ORDER BY sa.date ASC, s.label
  `).all(emp.id, from, to) as any[];

  // Alerts in range for this employee
  const alertRows = db.prepare(`
    SELECT alert_type, COUNT(*) as cnt
    FROM alert_events
    WHERE employee_id = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
    GROUP BY alert_type
  `).all(employeeId, from, to) as any[];

  const totalAlerts = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
  for (const r of alertRows) {
    const k = r.alert_type as keyof typeof totalAlerts;
    if (k in totalAlerts) totalAlerts[k] = r.cnt;
  }

  // Attendance check-in/out per day
  const attendanceRows = db.prepare(`
    SELECT date(recognized_at) as day, event_type, MIN(recognized_at) as first_in, MAX(recognized_at) as last_out
    FROM attendance
    WHERE employee_id = ? AND date(recognized_at) >= ? AND date(recognized_at) <= ?
    GROUP BY day, event_type
  `).all(emp.id, from, to) as any[];

  const attendanceMap: Record<string, { checkIn?: string; checkOut?: string }> = {};
  for (const r of attendanceRows) {
    if (!attendanceMap[r.day]) attendanceMap[r.day] = {};
    if (r.event_type === 'in') attendanceMap[r.day].checkIn = r.first_in?.split(' ')[1]?.slice(0, 5);
    if (r.event_type === 'out') attendanceMap[r.day].checkOut = r.last_out?.split(' ')[1]?.slice(0, 5);
  }

  // Per-shift alert counts
  const shifts = shiftRows.map((s) => {
    const alertsForShift = db.prepare(`
      SELECT alert_type, COUNT(*) as cnt
      FROM alert_events
      WHERE employee_id = ? AND date(timestamp) = ? AND (shift_label = ? OR shift_label = '')
      GROUP BY alert_type
    `).all(employeeId, s.date, s.shift_type) as any[];

    const alerts = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
    for (const a of alertsForShift) {
      const k = a.alert_type as keyof typeof alerts;
      if (k in alerts) alerts[k] = a.cnt;
    }
    const totalA = alerts.drowsy + alerts.sleep + alerts.phone + alerts.absence;
    const grade =
      totalA === 0 ? 'Excellent'
      : totalA <= 2 ? 'Good'
      : totalA <= 5 ? 'Fair'
      : 'Poor';

    const att = attendanceMap[s.date] || {};
    return {
      id: String(s.id),
      date: s.date,
      shiftType: s.shift_type,
      startTime: s.start_time,
      endTime: s.end_time,
      status: s.status,
      checkIn: att.checkIn,
      checkOut: att.checkOut,
      alerts,
      grade,
    };
  });

  const totalShifts = shifts.length;
  const completed = shifts.filter((s) => s.status === 'Completed').length;
  const missed = shifts.filter((s) => s.status === 'Missed').length;
  const scheduled = shifts.filter((s) => s.status === 'Scheduled').length;
  const inProgress = shifts.filter((s) => s.status === 'In Progress').length;
  const attended = shifts.filter((s) => s.checkIn).length;
  const attendanceRate = totalShifts > 0 ? Math.round((attended / totalShifts) * 100) : 0;
  const alertTotal = totalAlerts.drowsy + totalAlerts.sleep + totalAlerts.phone + totalAlerts.absence;

  return {
    employee: {
      id: emp.employee_id,
      name: emp.name,
      department: emp.department || '',
      active: emp.active === 1,
    },
    period: { from, to },
    summary: {
      totalShifts,
      completed,
      missed,
      scheduled,
      inProgress,
      attendanceRate,
      alertTotal,
      alertBreakdown: totalAlerts,
    },
    shifts,
  };
}
