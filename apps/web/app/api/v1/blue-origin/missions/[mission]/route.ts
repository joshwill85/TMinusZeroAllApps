import { NextResponse } from 'next/server';
import { loadBlueOriginMissionOverviewPayload, normalizeBlueOriginMobileMissionParam } from '@/lib/server/v1/mobileBlueOrigin';

export const dynamic = 'force-dynamic';

type Params = {
  mission: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const mission = normalizeBlueOriginMobileMissionParam(params.mission);
  if (!mission) {
    return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });
  }

  try {
    const payload = await loadBlueOriginMissionOverviewPayload(mission);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin mission overview v1 api error', error);
    return NextResponse.json({ error: 'blue_origin_mission_failed' }, { status: 500 });
  }
}

