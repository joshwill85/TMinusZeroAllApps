import { NextResponse } from 'next/server';
import { loadSpaceXOverviewPayload } from '@/lib/server/v1/mobileSpaceX';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await loadSpaceXOverviewPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex overview v1 api error', error);
    return NextResponse.json({ error: 'spacex_overview_failed' }, { status: 500 });
  }
}
