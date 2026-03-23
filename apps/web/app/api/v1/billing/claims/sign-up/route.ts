import { NextResponse } from 'next/server';
import { premiumClaimPasswordSignUpSchemaV1 } from '@tminuszero/contracts';
import { createPremiumAccountFromClaim, PremiumClaimRouteError } from '@/lib/server/premiumClaims';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = premiumClaimPasswordSignUpSchemaV1.parse(await request.json().catch(() => undefined));
    return NextResponse.json(
      await createPremiumAccountFromClaim({
        claimToken: payload.claimToken,
        email: payload.email,
        password: payload.password
      }),
      {
        headers: {
          'Cache-Control': 'private, no-store'
        }
      }
    );
  } catch (error) {
    if (error instanceof PremiumClaimRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 premium claim sign-up failed', error);
    return NextResponse.json({ error: 'failed_to_create_account' }, { status: 500 });
  }
}
