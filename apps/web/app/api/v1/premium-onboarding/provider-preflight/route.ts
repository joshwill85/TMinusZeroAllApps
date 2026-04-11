import { NextResponse } from 'next/server';
import { premiumOnboardingProviderPreflightSchemaV1 } from '@tminuszero/contracts';
import { preflightPremiumOnboardingProvider, PremiumOnboardingRouteError } from '@/lib/server/premiumOnboarding';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = premiumOnboardingProviderPreflightSchemaV1.parse(await request.json().catch(() => undefined));
    return NextResponse.json(await preflightPremiumOnboardingProvider(payload), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumOnboardingRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('premium onboarding provider preflight failed', error);
    return NextResponse.json({ error: 'failed_to_preflight_provider' }, { status: 500 });
  }
}

