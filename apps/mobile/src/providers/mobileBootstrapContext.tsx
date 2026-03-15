import { createContext, useContext } from 'react';
import type { MobileTheme } from '@tminuszero/design-tokens';

export type MobileBootstrapContextValue = {
  accessToken: string | null;
  refreshToken: string | null;
  isAuthHydrated: boolean;
  isReady: boolean;
  scheme: 'light' | 'dark';
  theme: MobileTheme;
  persistSession: (session: { accessToken: string; refreshToken?: string | null }) => Promise<void>;
  clearSession: () => Promise<void>;
  clearAuthedQueryState: () => Promise<void>;
  refreshSession: (options?: { force?: boolean }) => Promise<string | null>;
};

export const MobileBootstrapContext = createContext<MobileBootstrapContextValue | null>(null);

export function useMobileBootstrap() {
  const context = useContext(MobileBootstrapContext);
  if (!context) {
    throw new Error('useMobileBootstrap must be used within AppProviders.');
  }
  return context;
}
