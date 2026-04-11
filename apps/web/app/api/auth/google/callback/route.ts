import { handleGoogleAuthCallback } from '@/lib/server/googleAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleGoogleAuthCallback(request);
}
