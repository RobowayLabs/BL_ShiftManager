import { apiClient } from './client';

export interface AppUser {
  id: number;
  username: string;
  role: 'super_admin' | 'manager';
  active: boolean;
  lastLogin?: string;
}

export async function listUsers(): Promise<{ users: AppUser[] }> {
  return apiClient('/auth/users');
}

export async function createUser(data: {
  username: string;
  password: string;
  role: 'super_admin' | 'manager';
}): Promise<{ user: AppUser }> {
  return apiClient('/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUser(
  id: number,
  data: { username?: string; password?: string; role?: 'super_admin' | 'manager' },
): Promise<{ success: boolean }> {
  return apiClient(`/auth/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deactivateUser(id: number): Promise<{ success: boolean }> {
  return apiClient(`/auth/users/${id}`, { method: 'DELETE' });
}

export async function changeOwnCredentials(data: {
  oldPassword: string;
  newUsername?: string;
  newPassword?: string;
}): Promise<{ success: boolean }> {
  return apiClient('/auth/change-credentials', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
