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
    .select('id,flight_code,launch_id,ll2_launch_uuid,launch_name,launch_date,status')
    .order('launch_date', { ascending: false, nullsFirst: false });
  if (flightsRes.error) throw flightsRes.error;

  const launchesRes = await client
    .from('launches_public_cache')
    .select('launch_id,name,mission_name')
    .or('provider.ilike.%Blue Origin%,name.ilike.%Blue Origin%,mission_name.ilike.%Blue Origin%,name.ilike.%New Shepard%,mission_name.ilike.%New Shepard%,name.ilike.%New Glenn%,mission_name.ilike.%New Glenn%,name.ilike.%Blue Moon%,mission_name.ilike.%Blue Moon%,name.ilike.%Blue Ring%,mission_name.ilike.%Blue Ring%')
    .limit(500);
  if (launchesRes.error) throw launchesRes.error;

  const byLaunch = new Set((launchesRes.data || []).map((row) => String(row.launch_id || '')));

  const unresolved = flightsRes.data?.filter((flight) => {
    const launchId = String(flight.launch_id || '').trim();
    return !launchId || !byLaunch.has(launchId);
  }) || [];

  console.log(JSON.stringify({
    totalFlights: (flightsRes.data || []).length,
    resolved: ((flightsRes.data || []).length - unresolved.length),
    unresolvedCount: unresolved.length
  }, null, 2));
  console.log('unresolved sample');
  console.log(JSON.stringify(unresolved.map((flight) => ({
    flightCode: flight.flight_code,
    launchId: flight.launch_id,
    name: flight.launch_name,
    launchDate: flight.launch_date,
    status: flight.status
  })), null, 2));
})();
