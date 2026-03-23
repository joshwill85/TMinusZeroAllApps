import { NextResponse } from 'next/server';
import { BillingApiRouteError } from '@/lib/server/billingCore';
import { attachPremiumClaim, PremiumClaimRouteError } from '@/lib/server/premiumClaims';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { claimToken: string } }) {
  try {
    const session = await resolveViewerSession(request);
    return NextResponse.json(await attachPremiumClaim(session, params.claimToken), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumClaimRouteError || error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 premium claim attach failed', error);
    return NextResponse.json({ error: 'failed_to_claim' }, { status: 500 });
  }
}
