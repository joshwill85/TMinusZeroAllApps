import { useCallback, useEffect, useState } from 'react';
import { clearStoredAuthSession, readStoredAuthSession, writeStoredAuthSession } from '@/src/auth/storage';

export function useAuthBootstrap() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      try {
        const session = await readStoredAuthSession();
        if (isMounted) {
          setAccessToken(session.accessToken);
          setRefreshToken(session.refreshToken);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    }

    void hydrate();
    return () => {
      isMounted = false;
    };
  }, []);

  const persistSession = useCallback(async ({ accessToken: nextAccessToken, refreshToken: nextRefreshToken }: { accessToken: string; refreshToken?: string | null }) => {
    await writeStoredAuthSession({
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken ?? null
    });
    setAccessToken(nextAccessToken);
    setRefreshToken(nextRefreshToken ?? null);
  }, []);

  const clearSession = useCallback(async () => {
    await clearStoredAuthSession();
    setAccessToken(null);
    setRefreshToken(null);
  }, []);

  return {
    accessToken,
    refreshToken,
    isHydrated,
    persistSession,
    clearSession
  };
}
