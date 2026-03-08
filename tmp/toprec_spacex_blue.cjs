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
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const spacexRowsResp = await supabase
    .from('artemis_procurement_awards')
    .select('recipient')
    .eq('program_scope', 'spacex');
  if (spacexRowsResp.error) throw spacexRowsResp.error;

  const blueRowsResp = await supabase
    .from('artemis_procurement_awards')
    .select('recipient')
    .eq('program_scope', 'blue-origin');
  if (blueRowsResp.error) throw blueRowsResp.error;

  const topRecipients = (rows) => {
    const freq = new Map();
    for (const row of rows) {
      const recipient = String(row.recipient || '').trim() || '(blank)';
      freq.set(recipient, (freq.get(recipient) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([recipient, count]) => ({ recipient, count }));
  };

  console.log('spacex direct top recipients', topRecipients(spacexRowsResp.data || []));
  console.log('blue direct top recipients', topRecipients(blueRowsResp.data || []));
})();
