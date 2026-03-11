import { getDB } from '../config/db.js';

function severityToType(severity: string): 'Critical' | 'Warning' | 'Info' {
  if (severity === 'high' || severity === 'critical') return 'Critical';
  if (severity === 'low') return 'Info';
  return 'Warning';
}

function rowToAlert(a: any) {
  return {
    id: String(a.id),
    timestamp: a.timestamp,
    type: severityToType(a.severity || 'medium'),
    category: a.alert_type,
    severity: a.severity,
    message: `${a.alert_type} detected: ${a.employee_name || a.employee_id || 'Unknown'}`,
    source: a.camera_id,
    employeeId: a.employee_id,
    cameraId: a.camera_id,
    shiftLabel: a.shift_label,
    acknowledged: a.acknowledged === 1,
  };
}

export function getAlerts(query: {
  type?: string;
  category?: string;
  from?: string;
  to?: string;
  employeeId?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDB();
  let sql = 'SELECT * FROM alert_events WHERE 1=1';
  const params: any[] = [];

  if (query.category)   { sql += ' AND alert_type = ?';     params.push(query.category); }
  if (query.employeeId) { sql += ' AND employee_id = ?';    params.push(query.employeeId); }
  if (query.from)       { sql += ' AND timestamp >= ?';     params.push(query.from); }
  if (query.to)         { sql += ' AND timestamp <= ?';     params.push(query.to); }

  if (query.type) {
    const sevMap: Record<string, string[]> = {
      Critical: ['high', 'critical'],
      Warning:  ['medium'],
      Info:     ['low'],
    };
    const sevs = sevMap[query.type] || [];
    if (sevs.length) {
      sql += ` AND severity IN (${sevs.map(() => '?').join(',')})`;
      params.push(...sevs);
    }
  }

  const countRow = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt')).get(...params) as any;
  const total = countRow.cnt;

  sql += ' ORDER BY timestamp DESC';
  sql += ` LIMIT ${query.limit || 50} OFFSET ${query.offset || 0}`;

  const rows = db.prepare(sql).all(...params) as any[];
  return { alerts: rows.map(rowToAlert), total };
}

export function acknowledgeAlert(alertId: string) {
  const db = getDB();
  const info = db
    .prepare('UPDATE alert_events SET acknowledged = 1 WHERE id = ?')
    .run(Number(alertId));
  if (info.changes === 0) throw new Error('Alert not found');

  const a = db
    .prepare('SELECT * FROM alert_events WHERE id = ?')
    .get(Number(alertId)) as any;
  return rowToAlert(a);
}
