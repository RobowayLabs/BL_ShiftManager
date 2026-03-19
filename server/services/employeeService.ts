import Employee from '../models/Employee';
import Shift from '../models/Shift';
import Alert from '../models/Alert';
import Attendance from '../models/Attendance';

export async function getEmployees(query: {
  search?: string;
  department?: string;
  active?: string;
}) {
  const filter: Record<string, any> = {};

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { employeeId: { $regex: query.search, $options: 'i' } },
    ];
  }
  if (query.department) filter.department = query.department;
  if (query.active !== undefined) filter.active = query.active === 'true';

  const employees = await Employee.find(filter).sort({ name: 1 });

  return {
    employees: employees.map((e) => ({
      id: e.employeeId,
      name: e.name,
      department: e.department || '',
      active: e.active,
    })),
    total: employees.length,
  };
}

export async function getEmployeeById(employeeId: string) {
  const e = await Employee.findOne({ employeeId });
  if (!e) throw new Error('Employee not found');
  return {
    id: e.employeeId,
    name: e.name,
    department: e.department || '',
    active: e.active,
  };
}

export async function getEmployeePerformance(
  employeeId: string,
  from: string,
  to: string
) {
  const emp = await Employee.findOne({ employeeId });
  if (!emp) throw new Error('Employee not found');

  // Shifts in range
  const shiftDocs = await Shift.find({
    employeeId,
    date: { $gte: from, $lte: to },
  }).sort({ date: 1, type: 1 });

  // All alerts in range for this employee
  const alertAgg = await Alert.aggregate([
    {
      $match: {
        employeeId,
        timestamp: {
          $gte: new Date(from + 'T00:00:00'),
          $lte: new Date(to + 'T23:59:59'),
        },
      },
    },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const totalAlerts: Record<string, number> = { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
  for (const a of alertAgg) {
    if (a._id in totalAlerts) totalAlerts[a._id] = a.count;
  }

  // Attendance by day
  const attDocs = await Attendance.find({
    employeeId,
    recognizedAt: {
      $gte: new Date(from + 'T00:00:00'),
      $lte: new Date(to + 'T23:59:59'),
    },
  }).sort({ recognizedAt: 1 });

  const attendanceMap: Record<string, { checkIn?: string; checkOut?: string }> = {};
  for (const a of attDocs) {
    const day = a.recognizedAt.toISOString().split('T')[0];
    if (!attendanceMap[day]) attendanceMap[day] = {};
    const timeStr = a.recognizedAt.toISOString().split('T')[1].slice(0, 5);
    if (a.eventType === 'in' && !attendanceMap[day].checkIn) attendanceMap[day].checkIn = timeStr;
    if (a.eventType === 'out') attendanceMap[day].checkOut = timeStr;
  }

  // Per-shift performance
  const shifts = await Promise.all(
    shiftDocs.map(async (s) => {
      const shiftAlerts = await Alert.aggregate([
        {
          $match: {
            employeeId,
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
      for (const a of shiftAlerts) {
        if (a._id in alerts) alerts[a._id] = a.count;
      }
      const totalA = alerts.drowsy + alerts.sleep + alerts.phone + alerts.absence;
      const grade =
        totalA === 0 ? 'Excellent' : totalA <= 2 ? 'Good' : totalA <= 5 ? 'Fair' : 'Poor';

      const att = attendanceMap[s.date] || {};
      return {
        id: s._id.toString(),
        date: s.date,
        shiftType: s.type,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        checkIn: att.checkIn,
        checkOut: att.checkOut,
        alerts,
        grade,
      };
    })
  );

  const totalShifts = shifts.length;
  const completed = shifts.filter((s) => s.status === 'Completed').length;
  const missed = shifts.filter((s) => s.status === 'Missed').length;
  const scheduled = shifts.filter((s) => s.status === 'Scheduled').length;
  const inProgress = shifts.filter((s) => s.status === 'In Progress').length;
  const attended = shifts.filter((s) => s.checkIn).length;
  const attendanceRate = totalShifts > 0 ? Math.round((attended / totalShifts) * 100) : 0;
  const alertTotal =
    totalAlerts.drowsy + totalAlerts.sleep + totalAlerts.phone + totalAlerts.absence;

  return {
    employee: {
      id: emp.employeeId,
      name: emp.name,
      department: emp.department || '',
      active: emp.active,
    },
    period: { from, to },
    summary: {
      totalShifts,
      completed,
      missed,
      scheduled,
      inProgress,
      attendanceRate,
      alertTotal,
      alertBreakdown: totalAlerts,
    },
    shifts,
  };
}
