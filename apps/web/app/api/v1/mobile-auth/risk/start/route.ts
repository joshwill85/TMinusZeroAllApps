import { handleMobileAuthError, mobileAuthJson } from '../../_shared';
import { startMobileAuthRisk } from '@/lib/server/mobileAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await startMobileAuthRisk(request);
    return mobileAuthJson(payload);
  } catch (error) {
    return handleMobileAuthError('v1 mobile auth risk start', error);
  }
}
