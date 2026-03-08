import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

async function main() {
  const flight = (process.argv[2] || '').trim().toLowerCase();
  if (!flight) throw new Error('usage: ts-node tmp/inspect-passenger-raw.ts ns-37');

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('blue_origin_passengers')
    .select('name,source,confidence,flight_code,launch_id,metadata')
    .eq('flight_code', flight)
    .order('name', { ascending: true })
    .limit(500);

  if (error) throw error;
  const rows = (data || []) as Array<Record<string, any>>;

  const compact = rows.map((row) => ({
    name: row.name,
    source: row.source,
    confidence: row.confidence,
    profileUrl: row?.metadata?.profileUrl ?? row?.metadata?.profile_url ?? null,
    sourceUrl: row?.metadata?.sourceUrl ?? row?.metadata?.source_url ?? null,
    missionUrl: row?.metadata?.missionUrl ?? row?.metadata?.mission_url ?? null,
    imageUrl: row?.metadata?.imageUrl ?? row?.metadata?.image_url ?? null
  }));

  console.log(JSON.stringify({ flight, count: compact.length, rows: compact }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
