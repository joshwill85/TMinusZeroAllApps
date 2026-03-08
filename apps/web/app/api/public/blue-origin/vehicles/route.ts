import { NextResponse } from 'next/server';
import {
  fetchBlueOriginVehicles,
  parseBlueOriginEntityMissionFilter
} from '@/lib/server/blueOriginEntities';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mission = parseBlueOriginEntityMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  try {
    const payload = await fetchBlueOriginVehicles(mission);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin vehicles api error', error);
    return NextResponse.json({ error: 'vehicles_failed' }, { status: 500 });
  }
}
