import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as authService from '@/server/services/authService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const user = await authService.getUserById(auth.user.userId);
    return NextResponse.json({ user });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
