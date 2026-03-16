import { NextResponse } from 'next/server';
import { loadBlueOriginTravelersPayload } from '@/lib/server/v1/mobileBlueOrigin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await loadBlueOriginTravelersPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin travelers v1 api error', error);
    return NextResponse.json({ error: 'blue_origin_travelers_failed' }, { status: 500 });
  }
}

