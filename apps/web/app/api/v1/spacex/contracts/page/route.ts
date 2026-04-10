import { NextResponse } from 'next/server';
import { loadSpaceXContractsPagePayload } from '@/lib/server/v1/mobileSpaceX';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadSpaceXContractsPagePayload(request);
    if (!payload) {
      return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex contracts page v1 api error', error);
    return NextResponse.json({ error: 'spacex_contracts_page_failed' }, { status: 500 });
  }
}
