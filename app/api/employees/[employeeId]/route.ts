import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as employeeService from '@/server/services/employeeService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { employeeId } = await params;
    const employee = await employeeService.getEmployeeById(employeeId);
    return NextResponse.json({ employee });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
