import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as employeeService from '@/server/services/employeeService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json({ error: 'from and to query params are required' }, { status: 400 });
    }
    await connectDB();
    const { employeeId } = await params;
    const data = await employeeService.getEmployeePerformance(employeeId, from, to);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
