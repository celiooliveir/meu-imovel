import axios from 'axios';

// Em Android Emulator, 10.0.2.2 aponta para o localhost da máquina host
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api/v1';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = (globalThis as any).__accessToken as string | undefined;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  kycStatus: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export const authApi = {
  register: (data: { name: string; email: string; password: string; role: string }) =>
    api.post<TokenResponse>('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<TokenResponse>('/auth/login', data),

  logout: () => api.post('/auth/logout'),
};
