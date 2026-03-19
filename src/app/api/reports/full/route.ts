import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import { requireAuth } from '@/server/lib/apiAuth';
import Shift from '@/server/models/Shift';
import Employee from '@/server/models/Employee';
import Alert from '@/server/models/Alert';
import Attendance from '@/server/models/Attendance';

function gradeFromAlerts(total: number): string {
  if (total < 5) return 'Excellent';
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

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json({ error: 'from and to query params are required' }, { status: 400 });
    }
    await connectDB();
    const shifts = await Shift.find({ date: { $gte: from, $lte: to } }).sort({ date: -1, type: 1 });
    const employeeIds = [...new Set(shifts.map((s) => s.employeeId))];
    const empDocs = await Employee.find({ employeeId: { $in: employeeIds } });
    const empMap: Record<string, any> = {};
    for (const e of empDocs) empMap[e.employeeId] = e;

    const rows = await Promise.all(
      shifts.map(async (s) => {
        const emp = empMap[s.employeeId];
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
        const totalAlerts = alerts.drowsy + alerts.sleep + alerts.phone + alerts.absence;
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
        const workSec = calcWorkSeconds(actualStart, actualEnd);
        return {
          id: s._id.toString(),
          date: s.date,
          empIdText: s.employeeId,
          empName: emp?.name || s.employeeId,
          department: emp?.department || '',
          shiftType: s.type,
          scheduledStart: s.startTime,
          scheduledEnd: s.endTime,
          actualStart,
          actualEnd,
          status: s.status,
          workSeconds: workSec,
          alerts,
          totalAlerts,
          performanceGrade: gradeFromAlerts(totalAlerts),
        };
      })
    );
    return NextResponse.json({ rows, total: rows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
