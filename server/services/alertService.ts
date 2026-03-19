import Alert from '../models/Alert';

function rowToAlert(a: any) {
  return {
    id: a._id.toString(),
    timestamp: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
    type: a.type,
    category: a.category,
    severity: a.severity,
    message: a.message,
    source: a.source,
    employeeId: a.employeeId,
    cameraId: a.cameraId,
    shiftLabel: a.shiftLabel,
    acknowledged: a.acknowledged,
  };
}

export async function getAlerts(query: {
  type?: string;
  category?: string;
  from?: string;
  to?: string;
  employeeId?: string;
  limit?: number;
  offset?: number;
}) {
  const filter: Record<string, any> = {};

  if (query.category) filter.category = query.category;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.from || query.to) {
    filter.timestamp = {};
    if (query.from) filter.timestamp.$gte = new Date(query.from);
    if (query.to) filter.timestamp.$lte = new Date(query.to);
  }

  if (query.type) {
    const sevMap: Record<string, string[]> = {
      Critical: ['high', 'critical'],
      Warning: ['medium'],
      Info: ['low'],
    };
    const sevs = sevMap[query.type];
    if (sevs) filter.severity = { $in: sevs };
  }

  const total = await Alert.countDocuments(filter);
  const alerts = await Alert.find(filter)
    .sort({ timestamp: -1 })
    .skip(query.offset || 0)
    .limit(query.limit || 50);

  return { alerts: alerts.map(rowToAlert), total };
}

export async function acknowledgeAlert(alertId: string) {
  const doc = await Alert.findByIdAndUpdate(
    alertId,
    { $set: { acknowledged: true } },
    { new: true }
  );
  if (!doc) throw new Error('Alert not found');
  return rowToAlert(doc);
}
