import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as authService from '@/server/services/authService';
import { requireAuth } from '@/server/lib/apiAuth';

export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const { oldPassword, newUsername, newPassword } = await req.json();
    if (!oldPassword) {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 });
    }
    if (!newUsername && !newPassword) {
      return NextResponse.json({ error: 'Provide at least a new username or new password.' }, { status: 400 });
    }
    await connectDB();
    const result = await authService.changeOwnCredentials(auth.user.userId, oldPassword, newUsername, newPassword);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
