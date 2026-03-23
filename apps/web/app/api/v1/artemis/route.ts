import { NextResponse } from 'next/server';
import { loadArtemisOverviewPayload } from '@/lib/server/v1/mobileArtemis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await loadArtemisOverviewPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis overview v1 api error', error);
    return NextResponse.json({ error: 'artemis_overview_failed' }, { status: 500 });
  }
}
