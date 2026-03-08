const fs = require('fs');
const path = require('path');
const { createClient } = require(path.resolve(process.cwd(), 'node_modules/@supabase/supabase-js'));

const envObj = Object.create(null);
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  let v = trimmed.slice(idx + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  envObj[trimmed.slice(0, idx)] = v;
}

const supabase = createClient(envObj.NEXT_PUBLIC_SUPABASE_URL || envObj.SUPABASE_URL, envObj.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const codes = ['ns-2', 'ns-3', 'ns-4', 'ns-5', 'ns-6', 'ns-7', 'ns-8'];
  const { data: flights } = await supabase
    .from('blue_origin_flights')
    .select('flight_code,launch_name,launch_id')
    .in('flight_code', codes);

  const launchIds = (flights || []).map((row) => row.launch_id).filter(Boolean);
  const { data: cacheRows } = await supabase
    .from('launches_public_cache')
    .select('launch_id,launch_info_urls,mission_info_urls,net')
    .in('launch_id', launchIds);

  const cacheByLaunchId = new Map();
  for (const row of cacheRows || []) cacheByLaunchId.set(row.launch_id, row);

  for (const flight of flights || []) {
    const row = cacheByLaunchId.get(flight.launch_id);
    const urls = [...(row?.launch_info_urls || []), ...(row?.mission_info_urls || [])].filter(Boolean);
    console.log(`\n${flight.flight_code} ${flight.launch_name} ${row?.net || ''}`);
    console.log(urls);
  }
})();
