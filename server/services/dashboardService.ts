import Alert from '../models/Alert';
import Employee from '../models/Employee';
import Shift from '../models/Shift';

function localToday(): { start: Date; end: Date; str: string } {
  const d = new Date();
  const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    str,
    start: new Date(str + 'T00:00:00'),
    end: new Date(str + 'T23:59:59'),
  };
}

export async function getDashboardStats() {
  const today = localToday();

  const [totalEmployees, activeShifts, alertsToday, criticalAlerts] = await Promise.all([
    Employee.countDocuments({ active: true }),
    Shift.countDocuments({
      date: today.str,
      status: { $in: ['Scheduled', 'In Progress'] },
    }),
    Alert.countDocuments({
      timestamp: { $gte: today.start, $lte: today.end },
    }),
    Alert.countDocuments({
      timestamp: { $gte: today.start, $lte: today.end },
      severity: { $in: ['high', 'critical'] },
    }),
  ]);

  return { totalEmployees, activeShifts, alertsToday, criticalAlerts };
}

export async function getAlertTrends() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const agg = await Alert.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $group: { _id: { $hour: '$timestamp' }, alerts: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const hourMap: Record<number, number> = {};
  for (const r of agg) hourMap[r._id] = r.alerts;

  const buckets = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
  const data = buckets.map((name) => {
    const h = parseInt(name);
    const count = [0, 1, 2, 3].reduce((sum, i) => sum + (hourMap[h + i] || 0), 0);
    return { name, alerts: count };
  });

  return { data };
}

export async function getAlertDistribution() {
  const agg = await Alert.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

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
    data: agg.map((d: any) => ({
      name: nameMap[d._id] || d._id,
      value: d.count,
      fill: colorMap[d._id] || '#94a3b8',
    })),
  };
}
