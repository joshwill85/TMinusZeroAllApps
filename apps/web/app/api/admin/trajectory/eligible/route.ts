import { NextResponse } from 'next/server';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

type EligibleLaunch = {
  launchId: string;
  net: string | null;
  expiresAt: string;
  name: string;
  provider: string | null;
  vehicle: string | null;
  padName: string | null;
  locationName: string | null;
};

export async function GET() {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.context;

  const eligibleLaunches = await fetchArEligibleLaunches();
  const eligibleLaunchIds = eligibleLaunches.map((launch) => launch.launchId);

  if (eligibleLaunchIds.length === 0) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        launches: []
      },
      {
        headers: {
          'Cache-Control': 'private, no-store'
        }
      }
    );
  }

  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, name, provider, vehicle, pad_name, location_name')
    .in('launch_id', eligibleLaunchIds);

  if (error || !data) {
    console.error('trajectory eligible query failed', error);
    return NextResponse.json({ error: 'eligible_query_failed' }, { status: 500 });
  }

  const rowsByLaunchId = new Map<string, (typeof data)[number]>();
  for (const row of data) {
    if (typeof row?.launch_id === 'string') {
      rowsByLaunchId.set(row.launch_id, row);
    }
  }

  const launches: EligibleLaunch[] = eligibleLaunches.flatMap((eligibleLaunch) => {
    const row = rowsByLaunchId.get(eligibleLaunch.launchId);
    const name = typeof row?.name === 'string' ? row.name : null;
    if (!name) {
      return [];
    }

    return [
      {
        launchId: eligibleLaunch.launchId,
        net: eligibleLaunch.net,
        expiresAt: eligibleLaunch.expiresAt,
        name,
        provider: typeof row?.provider === 'string' ? row.provider : null,
        vehicle: typeof row?.vehicle === 'string' ? row.vehicle : null,
        padName: typeof row?.pad_name === 'string' ? row.pad_name : null,
        locationName: typeof row?.location_name === 'string' ? row.location_name : null
      }
    ];
  });

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      launches
    },
    {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}
