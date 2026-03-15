import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { clearStoredAuthSession, readStoredAuthSession, writeStoredAuthSession } from '@/src/auth/storage';
import { isAccessTokenExpiringSoon, refreshSession as refreshSupabaseSession } from '@/src/auth/supabaseAuth';

const HYDRATE_REFRESH_THRESHOLD_MS = 30_000;
const FOREGROUND_REFRESH_THRESHOLD_MS = 2 * 60_000;

type RefreshSessionError = {
  status?: number;
  message?: string;
};

type SessionState = {
  accessToken: string | null;
  refreshToken: string | null;
};

type UseAuthBootstrapOptions = {
  onSessionBoundaryChange?: (nextSession: SessionState) => Promise<void> | void;
};

function shouldClearSessionForRefreshError(error: unknown) {
  const refreshError = (error ?? {}) as RefreshSessionError;
  const status = typeof refreshError.status === 'number' ? refreshError.status : null;
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }

  const message = typeof refreshError.message === 'string' ? refreshError.message.toLowerCase() : '';
  return (
    message.includes('invalid_grant') ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('refresh token revoked') ||
    message.includes('refresh token expired')
  );
}

export function useAuthBootstrap(options: UseAuthBootstrapOptions = {}) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const handleSessionBoundaryChange = options.onSessionBoundaryChange;

  const applySessionState = useCallback((session: SessionState) => {
    accessTokenRef.current = session.accessToken;
    refreshTokenRef.current = session.refreshToken;
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
  }, []);

  const clearSession = useCallback(async () => {
    const nextSession = {
      accessToken: null,
      refreshToken: null
    };
    await clearStoredAuthSession();
    applySessionState(nextSession);
    await handleSessionBoundaryChange?.(nextSession);
  }, [applySessionState, handleSessionBoundaryChange]);

  const persistSession = useCallback(
    async ({
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken
    }: {
      accessToken: string;
      refreshToken?: string | null;
    }) => {
      const nextSession = {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken ?? null
      };

      await writeStoredAuthSession(nextSession);
      applySessionState(nextSession);
      await handleSessionBoundaryChange?.(nextSession);
    },
    [applySessionState, handleSessionBoundaryChange]
  );

  const refreshSession = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const currentAccessToken = accessTokenRef.current;
      const currentRefreshToken = refreshTokenRef.current;

      if (currentAccessToken && !currentRefreshToken && isAccessTokenExpiringSoon(currentAccessToken, 0)) {
        await clearSession();
        return null;
      }

      if (!currentRefreshToken) {
        return currentAccessToken;
      }

      if (!force && currentAccessToken && !isAccessTokenExpiringSoon(currentAccessToken, FOREGROUND_REFRESH_THRESHOLD_MS)) {
        return currentAccessToken;
      }

      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      refreshPromiseRef.current = (async () => {
        try {
          const nextSession = await refreshSupabaseSession(currentRefreshToken);
          const resolvedSession = {
            accessToken: nextSession.accessToken,
            refreshToken: nextSession.refreshToken ?? currentRefreshToken
          };
          await writeStoredAuthSession(resolvedSession);
          applySessionState(resolvedSession);
          return resolvedSession.accessToken;
        } catch (error: unknown) {
          if (shouldClearSessionForRefreshError(error)) {
            await clearSession();
            return null;
          }

          return currentAccessToken;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();

      return refreshPromiseRef.current;
    },
    [applySessionState, clearSession]
  );

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      try {
        const session = await readStoredAuthSession();
        let nextSession = session;

        if (session.accessToken && !session.refreshToken && isAccessTokenExpiringSoon(session.accessToken, 0)) {
          await clearStoredAuthSession();
          nextSession = {
            accessToken: null,
            refreshToken: null
          };
        } else if (session.refreshToken && (!session.accessToken || isAccessTokenExpiringSoon(session.accessToken, HYDRATE_REFRESH_THRESHOLD_MS))) {
          try {
            const refreshed = await refreshSupabaseSession(session.refreshToken);
            nextSession = {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken ?? session.refreshToken
            };
            await writeStoredAuthSession(nextSession);
          } catch (error: unknown) {
            if (shouldClearSessionForRefreshError(error)) {
              await clearStoredAuthSession();
              nextSession = {
                accessToken: null,
                refreshToken: null
              };
            } else {
              nextSession = session;
            }
          }
        }

        if (isMounted) {
          applySessionState(nextSession);
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
  }, [applySessionState]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSession();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isHydrated, refreshSession]);

  return {
    accessToken,
    refreshToken,
    isHydrated,
    persistSession,
    clearSession,
    refreshSession
  };
}
