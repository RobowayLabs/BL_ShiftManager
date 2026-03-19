import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as authService from '@/server/services/authService';
import { requireRole } from '@/server/lib/apiAuth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { username, password, role } = await req.json();
    if (role && role !== 'super_admin' && role !== 'manager') {
      return NextResponse.json({ error: 'role must be super_admin or manager.' }, { status: 400 });
    }
    await connectDB();
    const result = await authService.updateUser(id, { username, password, role });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(req, 'super_admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    if (id === auth.user.userId) {
      return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
    }
    await connectDB();
    const result = await authService.deactivateUser(id);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
