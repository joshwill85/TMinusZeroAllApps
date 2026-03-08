import { useMemo } from 'react';
import { createApiClient } from '@tminuszero/api-client';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { getApiBaseUrl } from '@/src/config/api';

export function useMobileApiClient() {
  const { accessToken } = useMobileBootstrap();

  return useMemo(() => {
    return createApiClient({
      baseUrl: getApiBaseUrl(),
      auth: accessToken ? { mode: 'bearer', accessToken } : { mode: 'guest' }
    });
  }, [accessToken]);
}
