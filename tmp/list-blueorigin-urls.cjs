const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function readEnv(key) {
  const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) return '';
  return line
    .slice(key.length + 1)
    .replace(/\r/g, '')
    .replace(/^"|"$/g, '');
}

const url = readEnv('NEXT_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!url || !key) {
  console.error('missing env');
  process.exit(1);
}

(async () => {
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id,name,mission_name,net,launch_info_urls,mission_info_urls')
    .or('name.ilike.%Blue Origin%,mission_name.ilike.%Blue Origin%,name.ilike.%New Shepard%,mission_name.ilike.%New Shepard%')
    .order('net', { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const rows = (data || []).filter((row) =>
    /ns-\d{1,3}/i.test(`${row.name || ''} ${row.mission_name || ''}`)
  );

  console.log('count', rows.length);
  for (const row of rows) {
    console.log(`id=${row.launch_id} name=${row.name || row.mission_name || ''} net=${row.net || ''}`);
    console.log(`  launch_info_urls=${JSON.stringify(row.launch_info_urls)}`);
    console.log(`  mission_info_urls=${JSON.stringify(row.mission_info_urls)}`);
  }
})();
