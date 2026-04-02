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
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 launch faa airspace map failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
