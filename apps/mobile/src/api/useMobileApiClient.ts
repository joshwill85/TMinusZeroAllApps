import { useMemo } from 'react';
import { createApiClient } from '@tminuszero/api-client';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { getApiBaseUrl } from '@/src/config/api';

export function useMobileApiClient() {
  const { accessToken, refreshSession } = useMobileBootstrap();

  return useMemo(() => {
    const fetchWithMobileAuth: typeof fetch = async (input, init) => {
      const nextHeaders = new Headers(init?.headers ?? {});
      if (accessToken) {
        nextHeaders.set('Authorization', `Bearer ${accessToken}`);
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
      baseUrl: getApiBaseUrl(),
      auth: { mode: 'guest' },
      fetchImpl: fetchWithMobileAuth
    });
  }, [accessToken, refreshSession]);
}
