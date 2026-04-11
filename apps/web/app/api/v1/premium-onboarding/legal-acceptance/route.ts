import { NextResponse } from 'next/server';
import { premiumOnboardingLegalAcceptanceSchemaV1 } from '@tminuszero/contracts';
import { PremiumOnboardingRouteError, recordPremiumOnboardingLegalAcceptance } from '@/lib/server/premiumOnboarding';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = premiumOnboardingLegalAcceptanceSchemaV1.parse(await request.json().catch(() => undefined));
    const session = await resolveViewerSession(request);
    return NextResponse.json(await recordPremiumOnboardingLegalAcceptance(session, payload), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumOnboardingRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('premium onboarding legal acceptance route failed', error);
    return NextResponse.json({ error: 'failed_to_record_legal_acceptance' }, { status: 500 });
  }
}

