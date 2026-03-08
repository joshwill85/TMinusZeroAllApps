import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';

export const dynamic = 'force-dynamic';

type SearchIndexRow = {
  launch_id: string;
  name: string | null;
  provider: string | null;
  vehicle: string | null;
  net: string;
  pad_name: string | null;
  pad_location_name: string | null;
  pad_state_code: string | null;
  mission_name: string | null;
  mission_type: string | null;
  mission_orbit: string | null;
  rocket_full_name: string | null;
  launch_designator: string | null;
  status_name: string | null;
  status_abbrev: string | null;
};

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const windowMs = 365 * 24 * 60 * 60 * 1000;
  const pastIso = new Date(now.getTime() - windowMs).toISOString();
  const futureIso = new Date(now.getTime() + windowMs).toISOString();

  const select =
    'launch_id,name,provider,vehicle,net,pad_name,pad_location_name,pad_state_code,mission_name,mission_type,mission_orbit,rocket_full_name,launch_designator,status_name,status_abbrev';

  const [upcoming, recent] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select(select)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .gte('net', nowIso)
      .lt('net', futureIso)
      .order('net', { ascending: true })
      .range(0, 599),
    supabase
      .from('launches_public_cache')
      .select(select)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .gte('net', pastIso)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .range(0, 599)
  ]);

  if (upcoming.error || recent.error) {
    console.error('search index query error', { upcoming: upcoming.error, recent: recent.error });
    return NextResponse.json({ error: 'search_index_query_failed' }, { status: 500 });
  }

  const rows = [...(upcoming.data || []), ...(recent.data || [])] as SearchIndexRow[];
  const byId = new Map<string, SearchIndexRow>();
  rows.forEach((row) => {
    if (!row?.launch_id) return;
    if (!byId.has(row.launch_id)) byId.set(row.launch_id, row);
  });

  const launches = Array.from(byId.values()).map((row) => ({
    id: row.launch_id,
    name: row.name || 'Launch',
    provider: row.provider || 'Unknown',
    vehicle: row.vehicle || 'Unknown',
    net: row.net,
    padName: row.pad_name,
    padLocationName: row.pad_location_name,
    padState: row.pad_state_code,
    missionName: row.mission_name,
    missionType: row.mission_type,
    missionOrbit: row.mission_orbit,
    rocketFullName: row.rocket_full_name,
    launchDesignator: row.launch_designator,
    status: row.status_name,
    statusText: row.status_abbrev || row.status_name
  }));

  return NextResponse.json(
    { generatedAt: nowIso, launches },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600'
      }
    }
  );
}
