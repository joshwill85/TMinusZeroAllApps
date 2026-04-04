import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

type EligibleLaunch = {
  launchId: string;
  net: string | null;
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

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, net, name, provider, vehicle, status_name, pad_name, location_name, pad_latitude, pad_longitude')
    .gte('net', nowIso)
    .order('net', { ascending: true })
    .limit(50);

  if (error || !data) {
    console.error('trajectory eligible query failed', error);
    return NextResponse.json({ error: 'eligible_query_failed' }, { status: 500 });
  }

  const eligible: EligibleLaunch[] = [];
  for (const row of data as any[]) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    const net = typeof row?.net === 'string' ? row.net : null;
    const name = typeof row?.name === 'string' ? row.name : null;
    if (!launchId || !name) continue;

    const hasPad = typeof row?.pad_latitude === 'number' && typeof row?.pad_longitude === 'number';
    if (!hasPad) continue;

    eligible.push({
      launchId,
      net,
      name,
      provider: typeof row?.provider === 'string' ? row.provider : null,
      vehicle: typeof row?.vehicle === 'string' ? row.vehicle : null,
      padName: typeof row?.pad_name === 'string' ? row.pad_name : null,
      locationName: typeof row?.location_name === 'string' ? row.location_name : null
    });
    if (eligible.length >= 3) break;
  }

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      launches: eligible
    },
    {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}
