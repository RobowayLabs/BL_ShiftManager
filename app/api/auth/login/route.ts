import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/server/config/db';
import * as authService from '@/server/services/authService';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }
    await connectDB();
    const result = await authService.login(username, password);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
}
