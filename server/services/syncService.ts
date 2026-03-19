import Employee from '../models/Employee';
import Shift from '../models/Shift';
import Alert from '../models/Alert';
import Detection from '../models/Detection';
import Attendance from '../models/Attendance';
import DailySummary from '../models/DailySummary';
import SyncLog from '../models/SyncLog';

// Matches SQLite employees table
interface SyncEmployee {
  employeeId: string;
  name: string;
  department?: string;
  active?: boolean;
}

// Matches SQLite attendance table
interface SyncAttendanceEvent {
  employeeId: string;
  cameraId: string;
  eventType: 'in' | 'out';
  status?: string;
  shiftId?: string;
  recognizedAt: string;
}

// Matches SQLite alert_events table
interface SyncAlert {
  localId: string;
  employeeId: string;
  employeeName?: string;
  cameraId?: string;
  alertType: 'drowsy' | 'phone' | 'absence' | 'sleep';
  severity?: string;
  shiftLabel?: string;
  timestamp: string;
  message?: string;
}

// Matches SQLite daily_summary table
interface SyncDailySummary {
  employeeId: string;
  date: string;
  totalWorkSec: number;
  sleepSec: number;
  drowsySec: number;
  yawnCount: number;
  phoneSec: number;
  phoneCount: number;
  absenceSec: number;
  productivity: number;
}

export async function processEmployeeSync(employees: SyncEmployee[], sourceIp: string) {
  let processed = 0;
  const errors: { index: number; employeeId: string; error: string }[] = [];

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    try {
      await Employee.findOneAndUpdate(
        { employeeId: emp.employeeId },
        {
          $set: {
            name: emp.name,
            department: emp.department || 'Unassigned',
            active: emp.active !== undefined ? emp.active : true,
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true }
      );
      processed++;
    } catch (err: any) {
      errors.push({ index: i, employeeId: emp.employeeId, error: err.message });
    }
  }

  await SyncLog.create({
    direction: 'pyqt_to_web',
    operation: 'push_employees',
    recordCount: processed,
    status: errors.length ? 'partial' : 'success',
    errorMessage: errors.length ? JSON.stringify(errors) : undefined,
    sourceIp,
  });

  return { processed, skipped: 0, errors, syncTimestamp: new Date().toISOString() };
}

export async function processAttendanceEventSync(events: SyncAttendanceEvent[], sourceIp: string) {
  let processed = 0;
  const errors: { index: number; employeeId: string; error: string }[] = [];

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    try {
      await Attendance.create({
        employeeId: evt.employeeId,
        cameraId: evt.cameraId,
        eventType: evt.eventType,
        status: evt.status || 'verified',
        shiftId: evt.shiftId,
        recognizedAt: new Date(evt.recognizedAt),
      });
      processed++;
    } catch (err: any) {
      errors.push({ index: i, employeeId: evt.employeeId, error: err.message });
    }
  }

  await SyncLog.create({
    direction: 'pyqt_to_web',
    operation: 'push_attendance',
    recordCount: processed,
    status: errors.length ? 'partial' : 'success',
    errorMessage: errors.length ? JSON.stringify(errors) : undefined,
    sourceIp,
  });

  return { processed, skipped: 0, errors, syncTimestamp: new Date().toISOString() };
}

export async function processAlertSync(alerts: SyncAlert[], sourceIp: string) {
  let processed = 0;
  let skipped = 0;
  const errors: { index: number; error: string }[] = [];

  const severityToType: Record<string, string> = {
    high: 'Critical',
    critical: 'Critical',
    medium: 'Warning',
    low: 'Info',
  };

  for (let i = 0; i < alerts.length; i++) {
    const alt = alerts[i];
    try {
      const existing = await Alert.findOne({ alertId: `SYNC-${alt.localId}` });
      if (existing) {
        skipped++;
        continue;
      }

      const alertType = severityToType[alt.severity || 'medium'] || 'Warning';

      await Alert.create({
        alertId: `SYNC-${alt.localId}`,
        timestamp: new Date(alt.timestamp),
        type: alertType,
        category: alt.alertType,
        severity: alt.severity || 'medium',
        message: alt.message || `${alt.alertType} detected: ${alt.employeeName || alt.employeeId}`,
        source: alt.cameraId || 'Desktop',
        employeeId: alt.employeeId,
        cameraId: alt.cameraId,
        shiftLabel: alt.shiftLabel,
        acknowledged: false,
      });
      processed++;
    } catch (err: any) {
      errors.push({ index: i, error: err.message });
    }
  }

  await SyncLog.create({
    direction: 'pyqt_to_web',
    operation: 'push_alerts',
    recordCount: processed,
    status: errors.length ? 'partial' : 'success',
    errorMessage: errors.length ? JSON.stringify(errors) : undefined,
    sourceIp,
  });

  return { processed, skipped, errors, syncTimestamp: new Date().toISOString() };
}

export async function processDailySummarySync(summaries: SyncDailySummary[], sourceIp: string) {
  let processed = 0;
  const errors: { index: number; employeeId: string; error: string }[] = [];

  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    try {
      await DailySummary.findOneAndUpdate(
        { employeeId: s.employeeId, date: s.date },
        {
          $set: {
            totalWorkSec: s.totalWorkSec,
            sleepSec: s.sleepSec,
            drowsySec: s.drowsySec,
            yawnCount: s.yawnCount,
            phoneSec: s.phoneSec,
            phoneCount: s.phoneCount,
            absenceSec: s.absenceSec,
            productivity: s.productivity,
          },
        },
        { upsert: true }
      );
      processed++;
    } catch (err: any) {
      errors.push({ index: i, employeeId: s.employeeId, error: err.message });
    }
  }

  await SyncLog.create({
    direction: 'pyqt_to_web',
    operation: 'push_daily_summary',
    recordCount: processed,
    status: errors.length ? 'partial' : 'success',
    errorMessage: errors.length ? JSON.stringify(errors) : undefined,
    sourceIp,
  });

  return { processed, skipped: 0, errors, syncTimestamp: new Date().toISOString() };
}

export async function processDetectionSync(
  detections: { employeeId: string; timestamp: string; eventType: string; confidence: number; cameraId: string; metadata?: Record<string, any> }[],
  sourceIp: string
) {
  let processed = 0;
  const errors: { index: number; employeeId: string; error: string }[] = [];

  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    try {
      await Detection.create({
        employeeId: det.employeeId,
        timestamp: new Date(det.timestamp),
        eventType: det.eventType,
        confidence: det.confidence,
        cameraId: det.cameraId,
        metadata: det.metadata,
      });
      processed++;
    } catch (err: any) {
      errors.push({ index: i, employeeId: det.employeeId, error: err.message });
    }
  }

  await SyncLog.create({
    direction: 'pyqt_to_web',
    operation: 'push_detections',
    recordCount: processed,
    status: errors.length ? 'partial' : 'success',
    errorMessage: errors.length ? JSON.stringify(errors) : undefined,
    sourceIp,
  });

  return { processed, skipped: 0, errors, syncTimestamp: new Date().toISOString() };
}

export async function getShiftsForSync(query: { from?: string; to?: string; updatedSince?: string }) {
  const filter: Record<string, any> = {};

  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }

  if (query.updatedSince) {
    filter.updatedAt = { $gte: new Date(query.updatedSince) };
  }

  const shifts = await Shift.find(filter).sort({ date: 1 });

  return {
    shifts: shifts.map((s) => ({
      shiftId: s.shiftId,
      employeeId: s.employeeId,
      date: s.date,
      type: s.type,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    })),
    syncTimestamp: new Date().toISOString(),
  };
}

export async function getEmployeesForSync(query: { updatedSince?: string }) {
  const filter: Record<string, any> = {};
  if (query.updatedSince) {
    filter.updatedAt = { $gte: new Date(query.updatedSince) };
  }

  const employees = await Employee.find(filter).sort({ employeeId: 1 });

  return {
    employees: employees.map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      department: e.department,
      active: e.active,
    })),
    syncTimestamp: new Date().toISOString(),
  };
}

export async function getSyncHealth() {
  const [lastPyqtToWeb, lastWebToPyqt] = await Promise.all([
    SyncLog.findOne({ direction: 'pyqt_to_web' }).sort({ createdAt: -1 }),
    SyncLog.findOne({ direction: 'web_to_pyqt' }).sort({ createdAt: -1 }),
  ]);

  return {
    status: 'ok' as const,
    serverTime: new Date().toISOString(),
    lastSync: {
      pyqtToWeb: lastPyqtToWeb?.createdAt?.toISOString() || null,
      webToPyqt: lastWebToPyqt?.createdAt?.toISOString() || null,
    },
    version: '1.0.0',
  };
}

export async function getSyncLogs(limit: number = 20) {
  const logs = await SyncLog.find().sort({ createdAt: -1 }).limit(limit);
  return logs;
}
