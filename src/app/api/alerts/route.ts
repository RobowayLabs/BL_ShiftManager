import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as alertService from '@/server/services/alertService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { searchParams } = new URL(req.url);
    const result = await alertService.getAlerts({
      type: searchParams.get('type') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      employeeId: searchParams.get('employeeId') ?? undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
