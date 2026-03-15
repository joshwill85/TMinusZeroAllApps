import { getApiBaseUrl } from '@/src/config/api';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';

export function useApiClient() {
  const { accessToken } = useMobileBootstrap();
  const baseUrl = getApiBaseUrl();
  const client = useMobileApiClient();

  return {
    accessToken,
    baseUrl,
    client
  };
}
