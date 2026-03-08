import { NextResponse } from 'next/server';
import { fetchSpaceXFlights } from '@/lib/server/spacexProgram';
import { parseSpaceXMissionFilter } from '@/lib/utils/spacexProgram';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mission = parseSpaceXMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  try {
    const payload = await fetchSpaceXFlights(mission);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex flights api error', error);
    return NextResponse.json({ error: 'flights_failed' }, { status: 500 });
  }
}
