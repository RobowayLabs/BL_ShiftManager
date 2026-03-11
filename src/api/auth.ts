import { apiClient } from './client';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: 'super_admin' | 'manager';
  };
}

interface MeResponse {
  user: {
    id: string;
    username: string;
    name: string;
    role: 'super_admin' | 'manager';
  };
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return apiClient<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function getMe(): Promise<MeResponse> {
  return apiClient<MeResponse>('/auth/me');
}
