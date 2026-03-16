import { handleMobileAuthError, mobileAuthJson } from '../../_shared';
import { completeMobileAuthChallenge } from '@/lib/server/mobileAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await completeMobileAuthChallenge(request);
    return mobileAuthJson(payload);
  } catch (error) {
    return handleMobileAuthError('v1 mobile auth challenge complete', error);
  }
}
