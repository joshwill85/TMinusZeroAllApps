import { Platform } from 'react-native';
import { createApiClient, type AuthContextUpsertV1 } from '@tminuszero/api-client';
import { getApiBaseUrl } from '@/src/config/api';

export function getMobileAuthPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export async function recordMobileAuthContext(
  accessToken: string,
  payload: Omit<AuthContextUpsertV1, 'platform'>
) {
  const client = createApiClient({
    baseUrl: getApiBaseUrl(),
    auth: { mode: 'bearer', accessToken }
  });

  return client.recordAuthContext({
    ...payload,
    platform: getMobileAuthPlatform()
  });
}
