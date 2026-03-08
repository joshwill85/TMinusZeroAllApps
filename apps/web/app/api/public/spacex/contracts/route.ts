import { NextResponse } from 'next/server';
import { fetchSpaceXContracts } from '@/lib/server/spacexProgram';
import { parseSpaceXMissionFilter } from '@/lib/utils/spacexProgram';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mission = parseSpaceXMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  try {
    const payload = await fetchSpaceXContracts(mission);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex contracts api error', error);
    return NextResponse.json({ error: 'contracts_failed' }, { status: 500 });
  }
}
