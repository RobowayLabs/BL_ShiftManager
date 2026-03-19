import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as employeeService from '@/server/services/employeeService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { searchParams } = new URL(req.url);
    const result = await employeeService.getEmployees({
      search: searchParams.get('search') ?? undefined,
      department: searchParams.get('department') ?? undefined,
      active: searchParams.get('active') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
