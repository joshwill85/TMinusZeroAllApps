import { NextResponse } from 'next/server';
import { loadPremiumClaimEnvelope, PremiumClaimRouteError } from '@/lib/server/premiumClaims';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { claimToken: string } }) {
  try {
    return NextResponse.json(await loadPremiumClaimEnvelope(params.claimToken), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof PremiumClaimRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 premium claim lookup failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
