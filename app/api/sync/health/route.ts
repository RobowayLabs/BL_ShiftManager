import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as syncService from '@/server/services/syncService';
import { requireSyncKey } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const check = requireSyncKey(req);
  if (check instanceof NextResponse) return check;
  await connectDB();
  try {
    const health = await syncService.getSyncHealth();
    return NextResponse.json(health);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
