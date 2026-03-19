import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as syncService from '@/server/services/syncService';
import { requireSyncKey } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const check = requireSyncKey(req);
  if (check instanceof NextResponse) return check;
  await connectDB();
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const logs = await syncService.getSyncLogs(limit);
    return NextResponse.json({ logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
