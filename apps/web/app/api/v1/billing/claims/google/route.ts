import { NextResponse } from 'next/server';
import { googleBillingSyncRequestSchemaV1 } from '@tminuszero/contracts';
import { BillingApiRouteError } from '@/lib/server/billingCore';
import { createGooglePremiumClaim, PremiumClaimRouteError } from '@/lib/server/premiumClaims';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = googleBillingSyncRequestSchemaV1.parse(await request.json().catch(() => undefined));
    return NextResponse.json(await createGooglePremiumClaim(payload));
  } catch (error) {
    if (error instanceof PremiumClaimRouteError || error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 google premium claim failed', error);
    return NextResponse.json({ error: 'failed_to_claim' }, { status: 500 });
  }
}
