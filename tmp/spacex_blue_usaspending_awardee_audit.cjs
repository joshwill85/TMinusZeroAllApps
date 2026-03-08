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

async function fetchRows(supabase, table, select, filters) {
  let query = supabase.from(table).select(select, { count: 'exact', head: true });
  for (const [key, value] of Object.entries(filters || {})) {
    query = query.eq(key, value);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function fetchWithLimit(supabase, table, select, filterFn, limit = 15) {
  let query = supabase.from(table).select(select).order('awarded_on', { ascending: false, nullsFirst: false });
  const orExpr = filterFn();
  if (orExpr) query = query.or(orExpr);
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data || [];
}

(async () => {
  loadEnv('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE env vars');
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const directSpacex = await fetchRows(supabase, 'artemis_procurement_awards', 'id', { program_scope: 'spacex' });
  const directBlue = await fetchRows(supabase, 'artemis_procurement_awards', 'id', { program_scope: 'blue-origin' });

  const { count: spacexRecipientCount, error: spr1 } = await supabase
    .from('artemis_procurement_awards')
    .select('id', { count: 'exact', head: true })
    .or('recipient.ilike.%SPACE EXPLORATION TECHNOLOGIES%,recipient.ilike.%SPACEX%,recipient.ilike.%SPACE X%');
  if (spr1) throw spr1;

  const { count: blueRecipientCount, error: br1 } = await supabase
    .from('artemis_procurement_awards')
    .select('id', { count: 'exact', head: true })
    .ilike('recipient', '%BLUE ORIGIN%');
  if (br1) throw br1;

  const { count: awardIdSpacex, error: aid1 } = await supabase
    .from('artemis_procurement_awards')
    .select('id', { count: 'exact', head: true })
    .or('recipient.ilike.%SPACE EXPLORATION TECHNOLOGIES%,recipient.ilike.%SPACEX%,recipient.ilike.%SPACE X%')
    .not('usaspending_award_id', 'is', null);
  if (aid1) throw aid1;

  const { count: awardIdBlue, error: aid2 } = await supabase
    .from('artemis_procurement_awards')
    .select('id', { count: 'exact', head: true })
    .ilike('recipient', '%BLUE ORIGIN%')
    .not('usaspending_award_id', 'is', null);
  if (aid2) throw aid2;

  const { count: acSpacex, error: ca1 } = await supabase
    .from('artemis_contracts')
    .select('id', { count: 'exact', head: true })
    .or('awardee_name.ilike.%SPACE EXPLORATION TECHNOLOGIES%,awardee_name.ilike.%SPACEX%,awardee_name.ilike.%SPACE X%');
  if (ca1) throw ca1;

  const { count: acBlue, error: ca2 } = await supabase
    .from('artemis_contracts')
    .select('id', { count: 'exact', head: true })
    .ilike('awardee_name', '%BLUE ORIGIN%');
  if (ca2) throw ca2;

  const { count: boBlue, error: bo1 } = await supabase
    .from('blue_origin_contracts')
    .select('id', { count: 'exact', head: true })
    .or('customer.ilike.%BLUE ORIGIN%,title.ilike.%BLUE ORIGIN%,customer.ilike.%BLUE MOON%,title.ilike.%BLUE MOON%,customer.ilike.%NEW GLENN%,title.ilike.%NEW GLENN%');
  if (bo1) throw bo1;

  const { count: boSpacex, error: bo2 } = await supabase
    .from('blue_origin_contracts')
    .select('id', { count: 'exact', head: true })
    .or('customer.ilike.%SPACEX%,title.ilike.%SPACEX%,customer.ilike.%SPACE X%,title.ilike.%SPACE X%,customer.ilike.%SPACE EXPLORATION TECHNOLOGIES%,title.ilike.%SPACE EXPLORATION TECHNOLOGIES%');
  if (bo2) throw bo2;

  const samplesSpacex = await fetchWithLimit(
    supabase,
    'artemis_procurement_awards',
    'usaspending_award_id,award_title,recipient,awarded_on,program_scope',
    () => 'recipient.ilike.%SPACE EXPLORATION TECHNOLOGIES%,recipient.ilike.%SPACEX%,recipient.ilike.%SPACE X%'
  );

  const samplesBlue = await fetchWithLimit(
    supabase,
    'artemis_procurement_awards',
    'usaspending_award_id,award_title,recipient,awarded_on,program_scope',
    () => 'recipient.ilike.%BLUE ORIGIN%'
  );

  const summary = {
    procurement: {
      direct_scope: { spacex: directSpacex, blue_origin: directBlue },
      recipient_exact_match: { spacex: spacexRecipientCount, blue_origin: blueRecipientCount },
      recipient_with_award_id: { spacex: awardIdSpacex, blue_origin: awardIdBlue }
    },
    artemis_contracts_awardee_exact_match: {
      spacex: acSpacex,
      blue_origin: acBlue
    },
    blue_origin_contracts_lightweight_match: {
      likely_blue: boBlue,
      likely_spacex: boSpacex
    },
    samples: {
      procurement_spacex: samplesSpacex.slice(0, 12),
      procurement_blue: samplesBlue.slice(0, 12)
    }
  };

  console.log(JSON.stringify(summary, null, 2));
})();
