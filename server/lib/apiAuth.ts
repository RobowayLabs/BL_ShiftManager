import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';

export interface JwtPayload {
  userId: string;
  username: string;
  role: 'super_admin' | 'manager';
}

export function requireAuth(req: NextRequest): { user: JwtPayload } | NextResponse {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }
  const token = header.split(' ')[1];
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'JWT_SECRET not configured on server' }, { status: 500 });
  }
  try {
    const user = jwt.verify(token, secret) as JwtPayload;
    return { user };
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}

export function requireRole(
  req: NextRequest,
  role: 'super_admin' | 'manager'
): { user: JwtPayload } | NextResponse {
  const result = requireAuth(req);
  if (result instanceof NextResponse) return result;
  if (result.user.role !== role) {
    return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  }
  return result;
}

export function requireSyncKey(req: NextRequest): true | NextResponse {
  const key = req.headers.get('x-api-key');
  if (!key || key !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized: invalid API key' }, { status: 401 });
  }
  return true;
}
