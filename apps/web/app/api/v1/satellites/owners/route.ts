import { NextResponse } from 'next/server';
import { loadSatelliteOwnersPayload } from '@/lib/server/v1/mobileSatellites';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadSatelliteOwnersPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('satellite owners v1 api error', error);
    return NextResponse.json({ error: 'satellite_owners_failed' }, { status: 500 });
  }
}
