import { createApiClient } from '@tminuszero/api-client';

export const browserApiClient = createApiClient({
  auth: { mode: 'cookie' }
});
