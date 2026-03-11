import { Router, Request, Response } from 'express';
import { getDB } from '../config/db.js';

const router = Router();

// Performance grade: fewer alerts = better performance
// Excellent: 0–4 | Good: 5–8 | Poor: > 8
function gradeFromAlerts(total: number): string {
  if (total < 5)  return 'Excellent';
  if (total <= 8) return 'Good';
  return 'Poor';
}

function calcWorkSeconds(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const toSec = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  };
  const diff = toSec(end) - toSec(start);
  return diff < 0 ? diff + 86400 : diff;
}

/**
 * GET /api/reports/full?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns one row per shift assignment in the range, enriched with:
 *   - employee name, department, employee_id text, shift type, date, status
 *   - actual start/end times (from attendance)
 *   - alert breakdown (from alert_events)
 *   - performance_grade (calculated + upserted into daily_performance)
 */
router.get('/full', async (req: Request, res: Response) => {
  try {
    const db   = getDB();
    const from = req.query.from as string;
    const to   = req.query.to   as string;

    if (!from || !to) {
      res.status(400).json({ error: 'from and to query params are required' });
      return;
    }

    // ── 1. Load all shift assignments in range with employee + shift info ──
    const assignments = db.prepare(`
      SELECT
        sa.id            AS sa_id,
        sa.date,
        sa.status,
        sa.actual_start,
        sa.actual_end,
        e.id             AS emp_int_id,
        e.employee_id    AS emp_id_text,
        e.name           AS emp_name,
        e.department,
        sh.label         AS shift_type,
        sh.start_time,
        sh.end_time
      FROM shift_assignments sa
      JOIN employees e  ON e.id  = sa.employee_id
      JOIN shifts    sh ON sh.id = sa.shift_id
      WHERE sa.date BETWEEN ? AND ?
      ORDER BY sa.date DESC, sh.label ASC, e.name ASC
    `).all(from, to) as any[];

    // ── 2. Prepare upsert statement ──────────────────────────────────────
    const upsert = db.prepare(`
      INSERT INTO daily_performance
        (employee_id, employee_id_text, date, shift_type,
         total_alerts, drowsy_alerts, sleep_alerts, phone_alerts, absence_alerts,
         performance_grade, work_seconds, shift_status, calculated_at)
      VALUES
        (@employee_id, @employee_id_text, @date, @shift_type,
         @total_alerts, @drowsy_alerts, @sleep_alerts, @phone_alerts, @absence_alerts,
         @performance_grade, @work_seconds, @shift_status, datetime('now'))
      ON CONFLICT(employee_id, date, shift_type) DO UPDATE SET
        total_alerts      = excluded.total_alerts,
        drowsy_alerts     = excluded.drowsy_alerts,
        sleep_alerts      = excluded.sleep_alerts,
        phone_alerts      = excluded.phone_alerts,
        absence_alerts    = excluded.absence_alerts,
        performance_grade = excluded.performance_grade,
        work_seconds      = excluded.work_seconds,
        shift_status      = excluded.shift_status,
        calculated_at     = datetime('now')
    `);

    const upsertMany = db.transaction((rows: any[]) => {
      for (const row of rows) upsert.run(row);
    });

    // ── 3. Enrich each row ───────────────────────────────────────────────
    const rows = assignments.map((a: any) => {
      // Alert counts from alert_events
      const alertRows = db.prepare(`
        SELECT alert_type, COUNT(*) AS cnt
        FROM alert_events
        WHERE employee_id = ?
          AND date(timestamp) = ?
          AND (shift_label = ? OR shift_label = '')
        GROUP BY alert_type
      `).all(a.emp_id_text, a.date, a.shift_type) as any[];

      const alerts = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
      for (const r of alertRows) {
        const k = r.alert_type as keyof typeof alerts;
        if (k in alerts) alerts[k] = r.cnt;
      }
      const totalAlerts = alerts.drowsy + alerts.sleep + alerts.phone + alerts.absence;

      // Actual times from attendance
      const attRows = db.prepare(`
        SELECT event_type, recognized_at
        FROM attendance
        WHERE employee_id = ? AND date(recognized_at) = ?
        ORDER BY recognized_at ASC
      `).all(a.emp_int_id, a.date) as any[];

      const inEv  = attRows.find((r: any) => r.event_type === 'in');
      const outEv = [...attRows].reverse().find((r: any) => r.event_type === 'out');
      const toTimeStr = (dt: string | undefined) =>
        dt ? dt.split(' ')[1]?.slice(0, 8) : undefined;

      const actualStart = toTimeStr(inEv?.recognized_at) ?? a.actual_start ?? undefined;
      const actualEnd   = toTimeStr(outEv?.recognized_at) ?? a.actual_end   ?? undefined;
      const workSec     = calcWorkSeconds(actualStart, actualEnd);
      const grade       = gradeFromAlerts(totalAlerts);

      return {
        id:           String(a.sa_id),
        date:         a.date,
        empIntId:     a.emp_int_id,
        empIdText:    a.emp_id_text,
        empName:      a.emp_name,
        department:   a.department,
        shiftType:    a.shift_type,
        scheduledStart: a.start_time,
        scheduledEnd:   a.end_time,
        actualStart,
        actualEnd,
        status:       a.status,
        workSeconds:  workSec,
        alerts,
        totalAlerts,
        performanceGrade: grade,
      };
    });

    // ── 4. Upsert all into daily_performance ────────────────────────────
    upsertMany(rows.map(r => ({
      employee_id:       r.empIntId,
      employee_id_text:  r.empIdText,
      date:              r.date,
      shift_type:        r.shiftType,
      total_alerts:      r.totalAlerts,
      drowsy_alerts:     r.alerts.drowsy,
      sleep_alerts:      r.alerts.sleep,
      phone_alerts:      r.alerts.phone,
      absence_alerts:    r.alerts.absence,
      performance_grade: r.performanceGrade,
      work_seconds:      r.workSeconds,
      shift_status:      r.status,
    })));

    res.json({ rows, total: rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
