import { handleMobileAuthError, mobileAuthJson } from '../_shared';
import { recoverMobilePassword } from '@/lib/server/mobileAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await recoverMobilePassword(request);
    return mobileAuthJson(payload);
  } catch (error) {
    return handleMobileAuthError('v1 mobile auth recover', error);
  }
}
