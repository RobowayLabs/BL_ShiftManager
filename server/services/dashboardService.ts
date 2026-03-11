import { getDB } from '../config/db.js';

// Local date string YYYY-MM-DD
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getDashboardStats() {
  const db = getDB();
  const today = localToday();

  const totalEmployees = (
    db.prepare('SELECT COUNT(*) as cnt FROM employees WHERE active = 1').get() as any
  ).cnt;

  const activeShifts = (
    db
      .prepare(
        "SELECT COUNT(*) as cnt FROM shift_assignments WHERE date = ? AND status IN ('Scheduled', 'In Progress')"
      )
      .get(today) as any
  ).cnt;

  const alertsToday = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM alert_events WHERE date(timestamp) = ?")
      .get(today) as any
  ).cnt;

  const criticalAlerts = (
    db
      .prepare(
        "SELECT COUNT(*) as cnt FROM alert_events WHERE date(timestamp) = ? AND severity IN ('high', 'critical')"
      )
      .get(today) as any
  ).cnt;

  return { totalEmployees, activeShifts, alertsToday, criticalAlerts };
}

export function getAlertTrends() {
  const db = getDB();

  const rows = db
    .prepare(
      `SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as alerts
       FROM alert_events
       WHERE timestamp >= datetime('now', '-24 hours')
       GROUP BY hour
       ORDER BY hour`
    )
    .all() as any[];

  const hourMap: Record<number, number> = {};
  for (const r of rows) hourMap[r.hour] = r.alerts;

  // 4-hour buckets
  const buckets = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
  const data = buckets.map((name) => {
    const h = parseInt(name);
    const count = [0, 1, 2, 3].reduce((sum, i) => sum + (hourMap[h + i] || 0), 0);
    return { name, alerts: count };
  });

  return { data };
}

export function getAlertDistribution() {
  const db = getDB();

  const rows = db
    .prepare('SELECT alert_type, COUNT(*) as count FROM alert_events GROUP BY alert_type')
    .all() as any[];

  const colorMap: Record<string, string> = {
    drowsy: '#ef4444',
    sleep: '#f59e0b',
    phone: '#06b6d4',
    absence: '#6366f1',
    system: '#94a3b8',
  };
  const nameMap: Record<string, string> = {
    drowsy: 'Drowsy',
    sleep: 'Sleep',
    phone: 'Phone Usage',
    absence: 'Absence',
    system: 'System',
  };

  return {
    data: rows.map((d: any) => ({
      name: nameMap[d.alert_type] || d.alert_type,
      value: d.count,
      fill: colorMap[d.alert_type] || '#94a3b8',
    })),
  };
}
