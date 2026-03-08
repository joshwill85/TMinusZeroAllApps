import { ReactNode, createContext, useContext, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createSharedQueryClient } from '@tminuszero/query';
import type { MobileTheme } from '@tminuszero/design-tokens';
import { useAuthBootstrap } from '@/src/bootstrap/useAuthBootstrap';
import { useThemeBootstrap } from '@/src/bootstrap/useThemeBootstrap';

type AppProvidersProps = {
  children: ReactNode;
};

type MobileBootstrapContextValue = {
  accessToken: string | null;
  refreshToken: string | null;
  isAuthHydrated: boolean;
  isReady: boolean;
  scheme: 'light' | 'dark';
  theme: MobileTheme;
  persistSession: (session: { accessToken: string; refreshToken?: string | null }) => Promise<void>;
  clearSession: () => Promise<void>;
};

const MobileBootstrapContext = createContext<MobileBootstrapContextValue | null>(null);

export function AppProviders({ children }: AppProvidersProps) {
  const { accessToken, refreshToken, isHydrated, persistSession, clearSession } = useAuthBootstrap();
  const { scheme, theme } = useThemeBootstrap();
  const [queryClient] = useState(() => createSharedQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <MobileBootstrapContext.Provider
        value={{
          accessToken,
          refreshToken,
          isAuthHydrated: isHydrated,
          isReady: isHydrated,
          scheme,
          theme,
          persistSession,
          clearSession
        }}
      >
        {children}
      </MobileBootstrapContext.Provider>
    </QueryClientProvider>
  );
}

export function useMobileBootstrap() {
  const context = useContext(MobileBootstrapContext);
  if (!context) {
    throw new Error('useMobileBootstrap must be used within AppProviders.');
  }
  return context;
}
