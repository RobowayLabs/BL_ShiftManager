import { getDB } from '../config/db.js';

type ShiftType = 'Morning' | 'Afternoon' | 'Night';
type ShiftStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Missed';

// Get alert counts per type from alert_events for a specific employee/date/shift
function getShiftAlerts(
  db: any,
  empIdText: string,
  date: string,
  shiftLabel: string
) {
  const rows = db
    .prepare(
      `SELECT alert_type, COUNT(*) as cnt
       FROM alert_events
       WHERE employee_id = ?
         AND date(timestamp) = ?
         AND (shift_label = ? OR shift_label = '')
       GROUP BY alert_type`
    )
    .all(empIdText, date, shiftLabel) as any[];

  const alerts = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
  for (const r of rows) {
    const k = r.alert_type as keyof typeof alerts;
    if (k in alerts) alerts[k] = r.cnt;
  }
  return alerts;
}

// Get actual check-in/out times from attendance table
function getAttendanceTimes(db: any, empIntId: number, date: string) {
  const rows = db
    .prepare(
      `SELECT event_type, recognized_at
       FROM attendance
       WHERE employee_id = ? AND date(recognized_at) = ?
       ORDER BY recognized_at ASC`
    )
    .all(empIntId, date) as any[];

  const inEvent = rows.find((r: any) => r.event_type === 'in');
  const outEvent = [...rows].reverse().find((r: any) => r.event_type === 'out');

  const toTimeStr = (dt: string | undefined) =>
    dt ? dt.split(' ')[1]?.slice(0, 8) : undefined;

  return {
    actualStart: toTimeStr(inEvent?.recognized_at),
    actualEnd: toTimeStr(outEvent?.recognized_at),
  };
}

function rowToShift(db: any, r: any) {
  const alerts = getShiftAlerts(db, r.emp_id_text, r.date, r.type);
  const { actualStart, actualEnd } = getAttendanceTimes(db, r.emp_int_id, r.date);
  const hasData = Object.values(alerts).some((v) => v > 0) || actualStart;

  return {
    id: String(r.id),
    employeeId: r.emp_id_text,
    date: r.date,
    type: r.type as ShiftType,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status as ShiftStatus,
    aiMetadata: hasData
      ? {
          actualStart: actualStart ?? r.actual_start ?? undefined,
          actualEnd: actualEnd ?? r.actual_end ?? undefined,
          alerts,
        }
      : undefined,
  };
}

const BASE_QUERY = `
  SELECT
    sa.id, sa.date, sa.status, sa.actual_start, sa.actual_end,
    s.label  AS type,
    s.start_time, s.end_time,
    e.employee_id AS emp_id_text,
    e.id          AS emp_int_id
  FROM shift_assignments sa
  JOIN shifts    s ON sa.shift_id    = s.id
  JOIN employees e ON sa.employee_id = e.id
`;

export function getShifts(query: {
  date?: string;
  from?: string;
  to?: string;
  employeeId?: string;
  type?: string;
  status?: string;
}) {
  const db = getDB();
  let sql = BASE_QUERY + ' WHERE 1=1';
  const params: any[] = [];

  if (query.date) {
    sql += ' AND sa.date = ?';
    params.push(query.date);
  } else {
    if (query.from) { sql += ' AND sa.date >= ?'; params.push(query.from); }
    if (query.to)   { sql += ' AND sa.date <= ?'; params.push(query.to); }
  }
  if (query.employeeId) { sql += ' AND e.employee_id = ?'; params.push(query.employeeId); }
  if (query.type)       { sql += ' AND s.label = ?';       params.push(query.type); }
  if (query.status)     { sql += ' AND sa.status = ?';     params.push(query.status); }

  sql += ' ORDER BY sa.date DESC, s.label';

  const rows = db.prepare(sql).all(...params) as any[];
  const shifts = rows.map((r) => rowToShift(db, r));
  return { shifts, total: shifts.length };
}

export function getShiftById(id: string) {
  const db = getDB();
  const r = db.prepare(BASE_QUERY + ' WHERE sa.id = ?').get(Number(id)) as any;
  if (!r) throw new Error('Shift not found');
  return rowToShift(db, r);
}

export function createShift(data: {
  employeeId: string;
  date: string;
  type: ShiftType;
}) {
  const db = getDB();

  const emp = db
    .prepare('SELECT id FROM employees WHERE employee_id = ?')
    .get(data.employeeId) as any;
  if (!emp) throw new Error(`Employee ${data.employeeId} not found`);

  const tmpl = db
    .prepare('SELECT id, start_time, end_time FROM shifts WHERE label = ?')
    .get(data.type) as any;
  if (!tmpl) throw new Error(`Shift type '${data.type}' not found`);

  const existing = db
    .prepare(
      'SELECT id FROM shift_assignments WHERE employee_id = ? AND shift_id = ? AND date = ?'
    )
    .get(emp.id, tmpl.id, data.date);
  if (existing)
    throw new Error('A shift of this type already exists for this employee on this date');

  const result = db
    .prepare(
      "INSERT INTO shift_assignments (employee_id, shift_id, date, status, created_at) VALUES (?, ?, ?, 'Scheduled', datetime('now'))"
    )
    .run(emp.id, tmpl.id, data.date);

  return {
    id: String(result.lastInsertRowid),
    employeeId: data.employeeId,
    date: data.date,
    type: data.type,
    startTime: tmpl.start_time,
    endTime: tmpl.end_time,
    status: 'Scheduled' as ShiftStatus,
  };
}

export function updateShift(
  id: string,
  data: Partial<{ status: string; date: string; type: string }>
) {
  const db = getDB();
  const updates: string[] = [];
  const params: any[] = [];

  if (data.status) { updates.push('status = ?'); params.push(data.status); }
  if (data.date)   { updates.push('date = ?');   params.push(data.date); }
  if (data.type) {
    const tmpl = db.prepare('SELECT id FROM shifts WHERE label = ?').get(data.type) as any;
    if (!tmpl) throw new Error(`Shift type '${data.type}' not found`);
    updates.push('shift_id = ?');
    params.push(tmpl.id);
  }
  if (updates.length === 0) throw new Error('No valid fields to update');

  params.push(Number(id));
  db.prepare(`UPDATE shift_assignments SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getShiftById(id);
}

export function deleteShift(id: string) {
  const db = getDB();
  const info = db
    .prepare('DELETE FROM shift_assignments WHERE id = ?')
    .run(Number(id));
  if (info.changes === 0) throw new Error('Shift not found');
  return { success: true };
}
