import { NextResponse } from 'next/server';
import { premiumOnboardingEmailAccountCreateSchemaV1 } from '@tminuszero/contracts';
import { createPremiumOnboardingEmailAccount, PremiumOnboardingRouteError } from '@/lib/server/premiumOnboarding';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = premiumOnboardingEmailAccountCreateSchemaV1.parse(await request.json().catch(() => undefined));
    return NextResponse.json(await createPremiumOnboardingEmailAccount(payload), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumOnboardingRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('premium onboarding email account route failed', error);
    return NextResponse.json({ error: 'failed_to_create_account' }, { status: 500 });
  }
}

