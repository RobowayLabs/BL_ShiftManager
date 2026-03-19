import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as authService from '@/server/services/authService';
import { requireRole } from '@/server/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  await connectDB();
  try {
    const users = await authService.listUsers();
    return NextResponse.json({ users });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { username, password, role } = await req.json();
    if (!username || !password || !role) {
      return NextResponse.json({ error: 'username, password, and role are required.' }, { status: 400 });
    }
    if (role !== 'super_admin' && role !== 'manager') {
      return NextResponse.json({ error: 'role must be super_admin or manager.' }, { status: 400 });
    }
    await connectDB();
    const user = await authService.createUser(username, password, role);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
