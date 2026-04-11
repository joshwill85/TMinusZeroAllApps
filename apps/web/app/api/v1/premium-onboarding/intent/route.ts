import { NextResponse } from 'next/server';
import { premiumOnboardingIntentRequestSchemaV1 } from '@tminuszero/contracts';
import { createOrResumePremiumOnboardingIntent, PremiumOnboardingRouteError } from '@/lib/server/premiumOnboarding';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = premiumOnboardingIntentRequestSchemaV1.parse(await request.json().catch(() => undefined));
    const session = await resolveViewerSession(request);
    const result = await createOrResumePremiumOnboardingIntent(session, payload);
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumOnboardingRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('premium onboarding intent route failed', error);
    return NextResponse.json({ error: 'failed_to_create_onboarding_intent' }, { status: 500 });
  }
}

