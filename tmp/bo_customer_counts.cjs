const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(path = '.env.local') {
  const raw = fs.readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx);
    let value = trimmed.slice(idx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

(async () => {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const s = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const q1 = await s.from('blue_origin_contracts').select('id', { count: 'exact', head: true })
    .or('customer.ilike.%BLUE ORIGIN,%,customer.ilike.%BLUE ORIGIN');
  console.log('q1', q1);
  const q2 = await s.from('blue_origin_contracts').select('id', { count: 'exact', head: true })
    .ilike('customer', '%BLUE ORIGIN, LLC%');
  console.log('q2', q2);
})();
