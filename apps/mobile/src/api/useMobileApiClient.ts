import { useMemo } from 'react';
import { createApiClient } from '@tminuszero/api-client';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { getApiBaseUrl } from '@/src/config/api';
import { APP_CLIENT_HEADER_NAME, APP_GUEST_TOKEN_HEADER_NAME, ensureGuestBootstrap } from '@/src/api/guestBootstrap';

let hasLoggedGuestBootstrapFailure = false;

export function useMobileApiClient() {
  const { accessToken, refreshSession } = useMobileBootstrap();
  const baseUrl = getApiBaseUrl();

  return useMemo(() => {
    const fetchWithMobileAuth: typeof fetch = async (input, init) => {
      const nextHeaders = new Headers(init?.headers ?? {});
      if (accessToken) {
        nextHeaders.set('Authorization', `Bearer ${accessToken}`);
      } else {
        try {
          const guestBootstrap = await ensureGuestBootstrap(baseUrl);
          if (guestBootstrap) {
            nextHeaders.set(APP_CLIENT_HEADER_NAME, guestBootstrap.clientHeaderValue);
            nextHeaders.set(APP_GUEST_TOKEN_HEADER_NAME, guestBootstrap.guestToken);
          }
        } catch (error) {
          if (!hasLoggedGuestBootstrapFailure) {
            hasLoggedGuestBootstrapFailure = true;
            console.warn('mobile guest bootstrap failed', error);
          }
        }
      }

      let response = await fetch(input, {
        ...init,
        headers: nextHeaders
      });

      if (response.status !== 401 || !accessToken) {
        return response;
      }

      const refreshedAccessToken = await refreshSession({ force: true });
      if (!refreshedAccessToken || refreshedAccessToken === accessToken) {
        return response;
      }

      const retryHeaders = new Headers(init?.headers ?? {});
      retryHeaders.set('Authorization', `Bearer ${refreshedAccessToken}`);

      response = await fetch(input, {
        ...init,
        headers: retryHeaders
      });

      return response;
    };

    return createApiClient({
      baseUrl,
      auth: { mode: 'guest' },
      fetchImpl: fetchWithMobileAuth
    });
  }, [accessToken, baseUrl, refreshSession]);
}
