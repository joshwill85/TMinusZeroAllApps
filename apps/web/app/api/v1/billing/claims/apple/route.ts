import { NextResponse } from 'next/server';
import { appleBillingSyncRequestSchemaV1 } from '@tminuszero/contracts';
import { BillingApiRouteError } from '@/lib/server/billingCore';
import { createApplePremiumClaim, PremiumClaimRouteError } from '@/lib/server/premiumClaims';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = appleBillingSyncRequestSchemaV1.parse(await request.json().catch(() => undefined));
    return NextResponse.json(await createApplePremiumClaim(payload));
  } catch (error) {
    if (error instanceof PremiumClaimRouteError || error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 apple premium claim failed', error);
    return NextResponse.json({ error: 'failed_to_claim' }, { status: 500 });
  }
}
