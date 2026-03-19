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
  syncedAt?: string; // ISO timestamp from PyQt5 — used as optimistic lock
}

const severityToType: Record<string, string> = {
  high: 'Critical',
  critical: 'Critical',
  medium: 'Warning',
  low: 'Info',
};

export async function processEmployeeSync(employees: SyncEmployee[], sourceIp: string) {
  const errors: { index: number; employeeId: string; error: string }[] = [];
  let processed = 0;

  // Run all upserts concurrently
  await Promise.all(
    employees.map(async (emp, i) => {
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
    })
  );

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
  const errors: { index: number; employeeId: string; error: string }[] = [];
  let processed = 0;

  // Run all inserts concurrently
  await Promise.all(
    events.map(async (evt, i) => {
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
    })
  );

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

  // Use atomic upsert with $setOnInsert to eliminate TOCTOU race:
  // If the alertId already exists → no-op (skipped).
  // If it doesn't → creates it atomically. Safe under concurrent pushes.
  await Promise.all(
    alerts.map(async (alt, i) => {
      try {
        const alertType = severityToType[alt.severity || 'medium'] || 'Warning';
        const result = await Alert.updateOne(
          { alertId: `SYNC-${alt.localId}` },
          {
            $setOnInsert: {
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
            },
          },
          { upsert: true }
        );
        // upsertedCount === 1 → new doc created; modifiedCount === 0 → already existed
        if (result.upsertedCount === 1) {
          processed++;
        } else {
          skipped++;
        }
      } catch (err: any) {
        errors.push({ index: i, error: err.message });
      }
    })
  );

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

  // Build a bulkWrite batch — one updateOne per summary.
  // Uses syncedAt as an optimistic lock: only overwrites if the incoming
  // data is newer than what's already stored (or the doc doesn't exist yet).
  const ops = summaries.map((s) => {
    const incomingSyncedAt = s.syncedAt ? new Date(s.syncedAt) : new Date();
    return {
      updateOne: {
        filter: {
          employeeId: s.employeeId,
          date: s.date,
          // Only update if we don't have this doc yet, or our data is newer
          $or: [
            { syncedAt: { $exists: false } },
            { syncedAt: { $lte: incomingSyncedAt } },
          ],
        },
        update: {
          $set: {
            totalWorkSec: s.totalWorkSec,
            sleepSec: s.sleepSec,
            drowsySec: s.drowsySec,
            yawnCount: s.yawnCount,
            phoneSec: s.phoneSec,
            phoneCount: s.phoneCount,
            absenceSec: s.absenceSec,
            productivity: s.productivity,
            syncedAt: incomingSyncedAt,
          },
          $setOnInsert: {
            employeeId: s.employeeId,
            date: s.date,
          },
        },
        upsert: true,
      },
    };
  });

  if (ops.length > 0) {
    try {
      const result = await DailySummary.bulkWrite(ops, { ordered: false });
      processed = (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
    } catch (err: any) {
      // bulkWrite with ordered:false continues past errors; capture them
      errors.push({ index: -1, employeeId: 'bulk', error: err.message });
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

  await Promise.all(
    detections.map(async (det, i) => {
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
    })
  );

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
