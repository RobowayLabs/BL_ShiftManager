import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as dashboardService from '@/server/services/dashboardService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const distribution = await dashboardService.getAlertDistribution();
    return NextResponse.json(distribution);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
