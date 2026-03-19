import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { JwtPayload } from '../lib/apiAuth';

export async function login(username: string, password: string) {
  const user = await User.findOne({ username, active: true });
  if (!user) throw new Error('Invalid username or password');

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new Error('Invalid username or password');

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  const payload: JwtPayload = {
    userId: user._id.toString(),
    username: user.username,
    role: user.role,
  };

  const token = jwt.sign(payload, secret, { expiresIn: '24h' });

  user.lastLogin = new Date();
  await user.save();

  return {
    token,
    user: {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role,
    },
  };
}

export async function getUserById(userId: string) {
  const user = await User.findById(userId);
  if (!user || !user.active) throw new Error('User not found');
  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name,
    role: user.role,
    lastLogin: user.lastLogin?.toISOString() || null,
  };
}

export async function listUsers() {
  const users = await User.find().sort({ createdAt: 1 });
  return users.map((u) => ({
    id: u._id.toString(),
    username: u.username,
    role: u.role,
    active: u.active,
    lastLogin: u.lastLogin?.toISOString() || null,
  }));
}

export async function createUser(
  username: string,
  password: string,
  role: 'super_admin' | 'manager'
) {
  const existing = await User.findOne({ username });
  if (existing) throw new Error(`Username "${username}" is already taken.`);

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    passwordHash: hash,
    role,
    name: username,
    active: true,
  });
  return { id: user._id.toString(), username, role };
}

export async function updateUser(
  targetId: string,
  data: { username?: string; password?: string; role?: 'super_admin' | 'manager' }
) {
  const user = await User.findById(targetId);
  if (!user) throw new Error('User not found');

  if (data.username && data.username !== user.username) {
    const clash = await User.findOne({ username: data.username });
    if (clash) throw new Error(`Username "${data.username}" is already taken.`);
    user.username = data.username;
  }
  if (data.password) {
    user.passwordHash = await bcrypt.hash(data.password, 10);
  }
  if (data.role) user.role = data.role;

  await user.save();
  return { success: true };
}

export async function deactivateUser(targetId: string) {
  const user = await User.findById(targetId);
  if (!user) throw new Error('User not found');
  user.active = false;
  await user.save();
  return { success: true };
}

export async function changeOwnCredentials(
  userId: string,
  oldPassword: string,
  newUsername?: string,
  newPassword?: string
) {
  const user = await User.findById(userId);
  if (!user || !user.active) throw new Error('User not found');

  const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!isMatch) throw new Error('Current password is incorrect.');

  if (newUsername && newUsername !== user.username) {
    const clash = await User.findOne({ username: newUsername });
    if (clash) throw new Error(`Username "${newUsername}" is already taken.`);
    user.username = newUsername;
  }
  if (newPassword) {
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  await user.save();
  return { success: true };
}
