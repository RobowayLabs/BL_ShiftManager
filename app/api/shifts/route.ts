import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as shiftService from '@/server/services/shiftService';
import { requireAuth, requireRole } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { searchParams } = new URL(req.url);
    const result = await shiftService.getShifts({
      date: searchParams.get('date') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      employeeId: searchParams.get('employeeId') ?? undefined,
      type: searchParams.get('type') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { employeeId, date, type } = await req.json();
    if (!employeeId || !date || !type) {
      return NextResponse.json({ error: 'employeeId, date, and type are required' }, { status: 400 });
    }
    await connectDB();
    const shift = await shiftService.createShift({ employeeId, date, type });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
