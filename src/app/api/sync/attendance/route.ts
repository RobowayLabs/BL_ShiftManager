import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as syncService from '@/server/services/syncService';
import { requireSyncKey } from '@/server/lib/apiAuth';

export async function POST(req: NextRequest) {
  const check = requireSyncKey(req);
  if (check instanceof NextResponse) return check;
  try {
    const { attendance } = await req.json();
    if (!Array.isArray(attendance)) {
      return NextResponse.json({ error: 'attendance array is required' }, { status: 400 });
    }
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const result = await syncService.processAttendanceEventSync(attendance, ip);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
