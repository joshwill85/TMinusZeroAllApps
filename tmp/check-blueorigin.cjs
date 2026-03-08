const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync('.env.local', 'utf8').split('\n');
const map = new Map();
for (const line of env) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  const key = trimmed.slice(0, idx);
  const value = trimmed.slice(idx + 1).replace(/^"|"$/g, '');
  map.set(key, value);
}
const url = map.get('NEXT_PUBLIC_SUPABASE_URL') || map.get('SUPABASE_URL') || '';
const key = map.get('SUPABASE_SERVICE_ROLE_KEY') || '';

(async () => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const flightsRes = await client
    .from('blue_origin_flights')
    .select('id,flight_code,launch_name,launch_date,launch_id,source,official_mission_url,status,ll2_launch_uuid,metadata')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .limit(500);
  if (flightsRes.error) throw flightsRes.error;

  const constraintsRes = await client
    .from('launch_trajectory_constraints')
    .select('launch_id,source,constraint_type,fetched_at,source_id')
    .in('source', ['blueorigin_multisource', 'blueorigin_mission_page'])
    .order('fetched_at', { ascending: false, nullsFirst: false });
  if (constraintsRes.error) throw constraintsRes.error;

  const byLaunch = new Map();
  for (const row of constraintsRes.data || []) {
    const launchId = String(row.launch_id || '');
    if (!launchId) continue;
    const set = byLaunch.get(launchId) || new Set();
    set.add(`${row.source}:${row.constraint_type}`);
    byLaunch.set(launchId, set);
  }

  const flights = flightsRes.data || [];
  const missing = [];
  let withAny = 0;
  let withInfographic = 0;

  for (const flight of flights) {
    const launchId = String(flight.launch_id || '').trim();
    const set = byLaunch.get(launchId);
    if (set && set.size) withAny += 1;
    if (set?.has('blueorigin_mission_page:mission_infographic')) withInfographic += 1;
    if (!set || !set.size) {
      missing.push({
        flight_code: flight.flight_code,
        launch_name: flight.launch_name,
        launch_date: flight.launch_date,
        launch_id: flight.launch_id,
        official_mission_url: flight.official_mission_url
      });
    }
  }

  const withCode = flights.filter((f) => f.flight_code).length;
  console.log(JSON.stringify({
    flightsTotal: flights.length,
    withFlightCode: withCode,
    withAnyConstraint: withAny,
    withMissionInfographic: withInfographic,
    missingConstraintCount: missing.length
  }, null, 2));

  console.log('Missing constraints sample:');
  console.log(JSON.stringify(missing.slice(0, 300), null, 2));
})();
