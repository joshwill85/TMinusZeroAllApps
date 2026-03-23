import { NextResponse } from 'next/server';
import { loadSatelliteDetailPayload, normalizeSatelliteNoradParam } from '@/lib/server/v1/mobileSatellites';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { norad: string } }) {
  const noradCatId = normalizeSatelliteNoradParam(params.norad);
  if (!noradCatId) {
    return NextResponse.json({ error: 'invalid_norad' }, { status: 400 });
  }

  try {
    const payload = await loadSatelliteDetailPayload(noradCatId);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('satellite detail v1 api error', error);
    return NextResponse.json({ error: 'satellite_detail_failed' }, { status: 500 });
  }
}
