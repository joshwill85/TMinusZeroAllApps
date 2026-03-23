import { NextResponse } from 'next/server';
import { loadCanonicalContractsPayload } from '@/lib/server/v1/mobileContracts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadCanonicalContractsPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('canonical contracts v1 api error', error);
    return NextResponse.json({ error: 'canonical_contracts_failed' }, { status: 500 });
  }
}
