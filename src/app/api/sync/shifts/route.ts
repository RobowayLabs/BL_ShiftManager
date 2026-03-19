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
    const result = await syncService.getShiftsForSync({
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      updatedSince: searchParams.get('updatedSince') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
