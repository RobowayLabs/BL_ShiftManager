import { NextRequest } from 'next/server';
import { connectDB } from '@/server/config/db';
import Alert from '@/server/models/Alert';
import Employee from '@/server/models/Employee';
import Shift from '@/server/models/Shift';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

function verifyToken(token: string): boolean {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return false;
    jwt.verify(token, secret);
    return true;
  } catch {
    return false;
  }
}

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function keepalive(): Uint8Array {
  return new TextEncoder().encode(': ping\n\n');
}

export async function GET(req: NextRequest) {
  // EventSource can't send headers — accept token via query param
  const token = req.nextUrl.searchParams.get('token');
  if (!token || !verifyToken(token)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  await connectDB();

  let lastAlertCheck = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connected event
      controller.enqueue(encode({ type: 'connected' }));

      // Fetch initial stats + recent alerts immediately
      try {
        const [totalEmployees, activeShifts, alertsToday, criticalAlerts, recentAlerts] =
          await Promise.all([
            Employee.countDocuments({ active: true }),
            Shift.countDocuments({ status: 'In Progress' }),
            Alert.countDocuments({
              timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            }),
            Alert.countDocuments({
              type: 'Critical',
              timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            }),
            Alert.find().sort({ timestamp: -1 }).limit(10).lean(),
          ]);

        controller.enqueue(
          encode({
            type: 'init',
            stats: { totalEmployees, activeShifts, alertsToday, criticalAlerts },
            alerts: recentAlerts.map((a: any) => ({
              id: a._id.toString(),
              timestamp: a.timestamp,
              type: a.type,
              category: a.category,
              message: a.message,
              source: a.source,
              employeeId: a.employeeId,
              acknowledged: a.acknowledged,
            })),
          })
        );
        lastAlertCheck = new Date();
      } catch {
        // skip, will retry on next tick
      }

      // Poll every 5 seconds for new alerts + updated stats
      const pollInterval = setInterval(async () => {
        try {
          const checkFrom = lastAlertCheck;
          lastAlertCheck = new Date();

          const [newAlerts, totalEmployees, activeShifts, alertsToday, criticalAlerts] =
            await Promise.all([
              Alert.find({ timestamp: { $gt: checkFrom } })
                .sort({ timestamp: -1 })
                .limit(50)
                .lean(),
              Employee.countDocuments({ active: true }),
              Shift.countDocuments({ status: 'In Progress' }),
              Alert.countDocuments({
                timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
              }),
              Alert.countDocuments({
                type: 'Critical',
                timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
              }),
            ]);

          // Always push stats update
          controller.enqueue(
            encode({
              type: 'stats',
              stats: { totalEmployees, activeShifts, alertsToday, criticalAlerts },
            })
          );

          // Only push alerts if there are new ones
          if (newAlerts.length > 0) {
            controller.enqueue(
              encode({
                type: 'alerts',
                alerts: newAlerts.map((a: any) => ({
                  id: a._id.toString(),
                  timestamp: a.timestamp,
                  type: a.type,
                  category: a.category,
                  message: a.message,
                  source: a.source,
                  employeeId: a.employeeId,
                  acknowledged: a.acknowledged,
                })),
              })
            );
          }
        } catch {
          // DB error on this tick — skip, try next tick
        }
      }, 5000);

      // Send keepalive comment every 20s to prevent proxy timeouts
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(keepalive());
        } catch {
          // stream already closed
        }
      }, 20000);

      // Clean up when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(pingInterval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
