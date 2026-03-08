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

  const queries = {
    c1: s.from('blue_origin_contracts').select('id', { count: 'exact', head: true }).or('customer.ilike.%BLUE ORIGIN%,title.ilike.%BLUE ORIGIN%'),
    c2: s.from('blue_origin_contracts').select('id', { count: 'exact', head: true }).ilike('customer', '%BLUE ORIGIN, LLC%'),
    c3: s.from('blue_origin_contracts').select('id', { count: 'exact', head: true }).or('customer.ilike.%BLUE ORIGIN WASHINGTON, LLC%,customer.ilike.%BLUE ORIGIN TEXAS, LLC%'),
    c4: s.from('blue_origin_contracts').select('id', { count: 'exact', head: true }).or('customer.ilike.%BLUE MOON%,title.ilike.%BLUE MOON%'),
    c5: s.from('blue_origin_contracts').select('id', { count: 'exact', head: true }).or('customer.ilike.%NEW GLENN%,title.ilike.%NEW GLENN%'),
  };

  for (const [name, q] of Object.entries(queries)) {
    const r = await q;
    console.log(name, r.error ? `ERR:${r.status} ${r.error.message}` : r.count);
  }
})();
