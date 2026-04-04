import { NextResponse } from 'next/server';
import { loadSpaceXDroneShipDetailPayload } from '@/lib/server/v1/mobileSpaceX';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Params }
) {
  try {
    const payload = await loadSpaceXDroneShipDetailPayload(params.slug);
    if (!payload) {
      return NextResponse.json({ error: 'spacex_drone_ship_not_found' }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex drone ship detail v1 api error', error);
    return NextResponse.json({ error: 'spacex_drone_ship_detail_failed' }, { status: 500 });
  }
}
