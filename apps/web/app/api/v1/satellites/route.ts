import { NextResponse } from 'next/server';
import { loadSatellitesPayload } from '@/lib/server/v1/mobileSatellites';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadSatellitesPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('satellites v1 api error', error);
    return NextResponse.json({ error: 'satellites_failed' }, { status: 500 });
  }
}
