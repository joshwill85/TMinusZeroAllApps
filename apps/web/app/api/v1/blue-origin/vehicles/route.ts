import { NextResponse } from 'next/server';
import { loadBlueOriginVehiclesPayload } from '@/lib/server/v1/mobileBlueOrigin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const payload = await loadBlueOriginVehiclesPayload(searchParams.get('mission'));
    if (!payload) {
      return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin vehicles v1 api error', error);
    return NextResponse.json({ error: 'blue_origin_vehicles_failed' }, { status: 500 });
  }
}

