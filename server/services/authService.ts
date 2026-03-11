import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDB } from '../config/db.js';
import { JwtPayload } from '../middleware/jwtAuth.js';

// Map SQLite role values to web app roles
function mapRole(role: string): 'super_admin' | 'manager' {
  return role === 'admin' || role === 'super_admin' ? 'super_admin' : 'manager';
}
// Map web role back to SQLite role
function toDbRole(role: 'super_admin' | 'manager'): string {
  return role === 'super_admin' ? 'admin' : 'manager';
}

export async function login(username: string, password: string) {
  const db = getDB();

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .get(username) as any;

  if (!user) throw new Error('Invalid username or password');

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) throw new Error('Invalid username or password');

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  const role = mapRole(user.role);

  const payload: JwtPayload = {
    userId: String(user.id),
    username: user.username,
    role,
  };

  const token = jwt.sign(payload, secret, { expiresIn: '24h' });

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  return {
    token,
    user: { id: user.id, username: user.username, name: user.username, role },
  };
}

export async function getUserById(userId: string) {
  const db = getDB();
  const user = db
    .prepare('SELECT id, username, role, last_login FROM users WHERE id = ? AND active = 1')
    .get(Number(userId)) as any;
  if (!user) throw new Error('User not found');
  return {
    id: user.id,
    username: user.username,
    name: user.username,
    role: mapRole(user.role),
    lastLogin: user.last_login,
  };
}

/** Super Admin: list all active users */
export function listUsers() {
  const db = getDB();
  const rows = db
    .prepare("SELECT id, username, role, active, last_login FROM users ORDER BY id ASC")
    .all() as any[];
  return rows.map(u => ({
    id: u.id,
    username: u.username,
    role: mapRole(u.role),
    active: u.active === 1,
    lastLogin: u.last_login,
  }));
}

/** Super Admin: create a new user */
export async function createUser(username: string, password: string, role: 'super_admin' | 'manager') {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error(`Username "${username}" is already taken.`);

  const hash = await bcrypt.hash(password, 10);
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, ?, 1)")
    .run(username, hash, toDbRole(role)) as any;

  return { id: result.lastInsertRowid, username, role };
}

/** Super Admin: update another user's username and/or role */
export async function updateUser(targetId: number, data: { username?: string; password?: string; role?: 'super_admin' | 'manager' }) {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as any;
  if (!user) throw new Error('User not found');

  if (data.username && data.username !== user.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(data.username, targetId);
    if (clash) throw new Error(`Username "${data.username}" is already taken.`);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(data.username, targetId);
  }
  if (data.password) {
    const hash = await bcrypt.hash(data.password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, targetId);
  }
  if (data.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(toDbRole(data.role), targetId);
  }
  return { success: true };
}

/** Super Admin: deactivate (soft-delete) a user */
export function deactivateUser(targetId: number) {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as any;
  if (!user) throw new Error('User not found');
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(targetId);
  return { success: true };
}

/** Super Admin: change their own credentials (requires old password verification) */
export async function changeOwnCredentials(
  userId: string,
  oldPassword: string,
  newUsername?: string,
  newPassword?: string,
) {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(userId)) as any;
  if (!user) throw new Error('User not found');

  const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
  if (!isMatch) throw new Error('Current password is incorrect.');

  if (newUsername && newUsername !== user.username) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, Number(userId));
    if (clash) throw new Error(`Username "${newUsername}" is already taken.`);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, Number(userId));
  }
  if (newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, Number(userId));
  }
  return { success: true };
}
