import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import { requireAuth } from '@/server/lib/apiAuth';
import Employee from '@/server/models/Employee';
import Alert from '@/server/models/Alert';
import Shift from '@/server/models/Shift';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) {
    return NextResponse.json({ employees: [], alerts: [], shifts: [] });
  }

  await connectDB();

  const regex = new RegExp(q, 'i');

  const [employees, alerts, shifts] = await Promise.all([
    Employee.find({
      $or: [
        { name: regex },
        { employeeId: regex },
        { department: regex },
      ],
    }).limit(5).lean(),

    Alert.find({
      $or: [
        { message: regex },
        { employeeName: regex },
        { category: regex },
        { employeeId: regex },
      ],
    }).sort({ timestamp: -1 }).limit(5).lean(),

    Shift.find({
      $or: [
        { employeeId: regex },
        { type: regex },
        { status: regex },
      ],
    }).sort({ date: -1 }).limit(5).lean(),
  ]);

  return NextResponse.json({
    employees: employees.map((e: any) => ({
      id:         e.employeeId,
      name:       e.name,
      department: e.department,
      active:     e.active,
    })),
    alerts: alerts.map((a: any) => ({
      id:         a._id.toString(),
      message:    a.message,
      category:   a.category,
      type:       a.type,
      timestamp:  a.timestamp,
      employeeId: a.employeeId,
    })),
    shifts: shifts.map((s: any) => ({
      id:         s.shiftId,
      employeeId: s.employeeId,
      date:       s.date,
      type:       s.type,
      status:     s.status,
    })),
  });
}
