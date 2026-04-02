import { NextResponse } from 'next/server';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { fetchLaunchFaaAirspaceMap } from '@/lib/server/faaAirspace';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  try {
    const payload = await fetchLaunchFaaAirspaceMap({ launchId: parsed.launchId });
    if (!payload) {
      return NextResponse.json({ error: 'faa_airspace_map_unavailable' }, { status: 503 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('faa airspace map api error', error);
    return NextResponse.json({ error: 'faa_airspace_map_failed' }, { status: 500 });
  }
}
