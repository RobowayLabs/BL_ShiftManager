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
    const result = await syncService.getEmployeesForSync({
      updatedSince: searchParams.get('updatedSince') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const check = requireSyncKey(req);
  if (check instanceof NextResponse) return check;
  try {
    const { employees } = await req.json();
    if (!Array.isArray(employees)) {
      return NextResponse.json({ error: 'employees array is required' }, { status: 400 });
    }
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const result = await syncService.processEmployeeSync(employees, ip);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
