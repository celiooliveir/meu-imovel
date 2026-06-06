import { create } from 'zustand';
import { AuthUser } from '../services/api';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (accessToken: string, refreshToken: string, user: AuthUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  setTokens: (accessToken, refreshToken, user) => {
    (globalThis as any).__accessToken = accessToken;
    set({ accessToken, refreshToken, user });
  },
  clear: () => {
    (globalThis as any).__accessToken = undefined;
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
