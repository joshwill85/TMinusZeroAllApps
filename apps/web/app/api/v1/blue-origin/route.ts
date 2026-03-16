import { NextResponse } from 'next/server';
import { loadBlueOriginOverviewPayload } from '@/lib/server/v1/mobileBlueOrigin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await loadBlueOriginOverviewPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin overview v1 api error', error);
    return NextResponse.json({ error: 'blue_origin_overview_failed' }, { status: 500 });
  }
}

