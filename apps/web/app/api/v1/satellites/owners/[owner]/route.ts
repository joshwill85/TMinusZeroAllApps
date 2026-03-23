import { NextResponse } from 'next/server';
import { loadSatelliteOwnerPayload } from '@/lib/server/v1/mobileSatellites';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { owner: string } }) {
  try {
    const payload = await loadSatelliteOwnerPayload(params.owner);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('satellite owner v1 api error', error);
    return NextResponse.json({ error: 'satellite_owner_failed' }, { status: 500 });
  }
}
