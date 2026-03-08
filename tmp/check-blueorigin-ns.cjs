const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync('.env.local', 'utf8').split('\n');
const map = new Map();
for (const line of env) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  map.set(trimmed.slice(0, idx), trimmed.slice(idx + 1).replace(/^"|"$/g, ''));
}
const supabase = createClient(map.get('NEXT_PUBLIC_SUPABASE_URL'), map.get('SUPABASE_SERVICE_ROLE_KEY'));

(async () => {
  const flightsRes = await supabase
    .from('blue_origin_flights')
    .select('id,flight_code,launch_id,launch_name,launch_date')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .limit(500);
  if (flightsRes.error) throw flightsRes.error;

  const constraintsRes = await supabase
    .from('launch_trajectory_constraints')
    .select('launch_id,source,constraint_type,fetched_at')
    .in('source', ['blueorigin_mission_page'])
    .eq('constraint_type', 'mission_infographic');
  if (constraintsRes.error) throw constraintsRes.error;

  const withInfographic = new Set((constraintsRes.data || []).map((r) => String(r.launch_id || '')));

  const nsRows = (flightsRes.data || []).filter((row) => String(row.flight_code || '').startsWith('ns-')).map((row) => ({
    flightCode: row.flight_code,
    launchName: row.launch_name,
    launchId: row.launch_id,
    launchDate: row.launch_date,
    hasInfographic: withInfographic.has(String(row.launch_id || ''))
  }));

  console.log('NS launches:', nsRows.length);
  console.log('missing infographic:', nsRows.filter((row) => !row.hasInfographic).length);
  console.log('with infographic:', nsRows.filter((row) => row.hasInfographic).length);
  console.log('missing list:');
  console.log(JSON.stringify(nsRows.filter((row) => !row.hasInfographic).map((r) => r.flightCode + ' | ' + r.launchName), null, 2));
  console.log('available list:');
  console.log(JSON.stringify(nsRows.filter((row) => row.hasInfographic).map((r) => r.flightCode + ' | ' + r.launchName), null, 2));
})();
