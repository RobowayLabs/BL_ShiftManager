import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as alertService from '@/server/services/alertService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ alertId: string }> }) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const { alertId } = await params;
    const alert = await alertService.acknowledgeAlert(alertId);
    return NextResponse.json({ alert });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
