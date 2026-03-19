import crypto from 'crypto';
import Shift from '../models/Shift';
import Employee from '../models/Employee';
import Alert from '../models/Alert';
import Attendance from '../models/Attendance';

type ShiftType = 'Morning' | 'Afternoon' | 'Night';
type ShiftStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Missed';

const SHIFT_TIMES: Record<ShiftType, { start: string; end: string }> = {
  Morning:   { start: '08:00', end: '16:00' },
  Afternoon: { start: '16:00', end: '00:00' },
  Night:     { start: '00:00', end: '08:00' },
};

async function enrichShift(s: any) {
  // Alert counts for this employee+date+shiftType
  const alertAgg = await Alert.aggregate([
    {
      $match: {
        employeeId: s.employeeId,
        timestamp: {
          $gte: new Date(s.date + 'T00:00:00'),
          $lte: new Date(s.date + 'T23:59:59'),
        },
        $or: [
          { shiftLabel: s.type },
          { shiftLabel: '' },
          { shiftLabel: { $exists: false } },
        ],
      },
    },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const alerts: Record<string, number> = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
  for (const a of alertAgg) {
    if (a._id in alerts) alerts[a._id] = a.count;
  }

  // Actual attendance times
  const attDocs = await Attendance.find({
    employeeId: s.employeeId,
    recognizedAt: {
      $gte: new Date(s.date + 'T00:00:00'),
      $lte: new Date(s.date + 'T23:59:59'),
    },
  }).sort({ recognizedAt: 1 });

  const inEv = attDocs.find((a) => a.eventType === 'in');
  const outEv = [...attDocs].reverse().find((a) => a.eventType === 'out');
  const actualStart = inEv?.recognizedAt.toISOString().split('T')[1].slice(0, 8);
  const actualEnd = outEv?.recognizedAt.toISOString().split('T')[1].slice(0, 8);
  const hasData = Object.values(alerts).some((v) => v > 0) || actualStart;

  return {
    id: s._id.toString(),
    employeeId: s.employeeId,
    date: s.date,
    type: s.type,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
    aiMetadata: hasData ? { actualStart, actualEnd, alerts } : undefined,
  };
}

export async function getShifts(query: {
  date?: string;
  from?: string;
  to?: string;
  employeeId?: string;
  type?: string;
  status?: string;
}) {
  const filter: Record<string, any> = {};

  if (query.date) {
    filter.date = query.date;
  } else {
    if (query.from || query.to) {
      filter.date = {};
      if (query.from) filter.date.$gte = query.from;
      if (query.to) filter.date.$lte = query.to;
    }
  }
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;

  const docs = await Shift.find(filter).sort({ date: -1, type: 1 });
  const shifts = await Promise.all(docs.map(enrichShift));
  return { shifts, total: shifts.length };
}

export async function getShiftById(id: string) {
  const doc = await Shift.findById(id);
  if (!doc) throw new Error('Shift not found');
  return enrichShift(doc);
}

export async function createShift(data: {
  employeeId: string;
  date: string;
  type: ShiftType;
}) {
  const emp = await Employee.findOne({ employeeId: data.employeeId });
  if (!emp) throw new Error(`Employee ${data.employeeId} not found`);

  const times = SHIFT_TIMES[data.type];
  if (!times) throw new Error(`Unknown shift type: ${data.type}`);

  const existing = await Shift.findOne({
    employeeId: data.employeeId,
    date: data.date,
    type: data.type,
  });
  if (existing)
    throw new Error('A shift of this type already exists for this employee on this date');

  const doc = await Shift.create({
    shiftId: crypto.randomUUID(),
    employeeId: data.employeeId,
    date: data.date,
    type: data.type,
    startTime: times.start,
    endTime: times.end,
    status: 'Scheduled',
  });

  return {
    id: doc._id.toString(),
    employeeId: data.employeeId,
    date: data.date,
    type: data.type,
    startTime: times.start,
    endTime: times.end,
    status: 'Scheduled' as ShiftStatus,
  };
}

export async function updateShift(
  id: string,
  data: Partial<{ status: string; date: string; type: string }>
) {
  const update: Record<string, any> = {};

  if (data.status) update.status = data.status;
  if (data.date) update.date = data.date;
  if (data.type) {
    const times = SHIFT_TIMES[data.type as ShiftType];
    if (!times) throw new Error(`Shift type '${data.type}' not found`);
    update.type = data.type;
    update.startTime = times.start;
    update.endTime = times.end;
  }

  if (Object.keys(update).length === 0) throw new Error('No valid fields to update');

  const doc = await Shift.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!doc) throw new Error('Shift not found');
  return enrichShift(doc);
}

export async function deleteShift(id: string) {
  const doc = await Shift.findByIdAndDelete(id);
  if (!doc) throw new Error('Shift not found');
  return { success: true };
}
