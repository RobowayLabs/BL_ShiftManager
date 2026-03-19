import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as shiftService from '@/server/services/shiftService';
import { requireAuth, requireRole } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { shiftId } = await params;
    const shift = await shiftService.getShiftById(shiftId);
    return NextResponse.json({ shift });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { shiftId } = await params;
    const body = await req.json();
    await connectDB();
    const shift = await shiftService.updateShift(shiftId, body);
    return NextResponse.json({ shift });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ shiftId: string }> }) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { shiftId } = await params;
    await connectDB();
    const result = await shiftService.deleteShift(shiftId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
