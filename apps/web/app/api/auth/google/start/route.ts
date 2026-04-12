import { NextResponse } from 'next/server';
import { startGoogleAuthFlow } from '@/lib/server/googleAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authUrl = startGoogleAuthFlow({
    platform: url.searchParams.get('platform') === 'ios' ? 'ios' : url.searchParams.get('platform') === 'android' ? 'android' : 'web',
    returnTo: url.searchParams.get('return_to'),
    intent: url.searchParams.get('intent'),
    onboardingIntentId: url.searchParams.get('onboarding_intent_id'),
    claimToken: url.searchParams.get('claim_token')
  });

  return NextResponse.redirect(authUrl);
}
