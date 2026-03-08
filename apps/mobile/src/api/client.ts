import { createApiClient } from '@tminuszero/api-client';
import { getApiBaseUrl } from '@/src/config/api';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

export function useApiClient() {
  const { accessToken } = useMobileBootstrap();
  const baseUrl = getApiBaseUrl();
  const auth = accessToken ? { mode: 'bearer' as const, accessToken } : { mode: 'guest' as const };

  return {
    accessToken,
    baseUrl,
    client: createApiClient({
      baseUrl,
      auth
    })
  };
}
