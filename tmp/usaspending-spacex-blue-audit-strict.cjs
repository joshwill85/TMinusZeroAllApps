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

function normalizeScope(value) {
  if (!value || typeof value !== 'string') return null;
  const n = value.trim().toLowerCase();
  if (['spacex', 'space-x', 'space_x', 'space x'].includes(n)) return 'spacex';
  if (['blue-origin', 'blue_origin', 'blueorigin', 'blue'].includes(n)) return 'blue-origin';
  if (n === 'artemis') return 'artemis';
  return null;
}

function readMetadataScopes(metadata, fallbackScope) {
  const out = new Set();
  const direct = normalizeScope(metadata?.programScope || metadata?.program_scope);
  if (direct) out.add(direct);

  const candidateValues = [];
  if (Array.isArray(metadata?.programScopes)) candidateValues.push(...metadata.programScopes);
  if (Array.isArray(metadata?.program_scopes)) candidateValues.push(...metadata.program_scopes);

  for (const v of candidateValues) {
    const normalized = normalizeScope(v);
    if (normalized) out.add(normalized);
  }

  if (out.size === 0 && fallbackScope) {
    const fallback = normalizeScope(fallbackScope);
    if (fallback) out.add(fallback);
  }
  return [...out];
}

async function fetchAllProcurement(supabase) {
  const rows = [];
  const batch = 500;
  let from = 0;

  while (true) {
    const to = from + batch - 1;
    const res = await supabase
      .from('artemis_procurement_awards')
      .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,program_scope,metadata,updated_at')
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (res.error) throw res.error;
    const chunk = res.data || [];
    rows.push(...chunk);
    if (chunk.length < batch) break;
    from += batch;
  }

  return rows;
}

function rowHasRecipient(row, scope) {
  const recipient = String(row.recipient || '').toLowerCase();
  if (!recipient) return false;
  if (scope === 'spacex') {
    return /space\s*exploration\s*technologies|\bspacex\b|space\s*x/.test(recipient);
  }
  if (scope === 'blue-origin') {
    return /\bblue\s*origin\b/.test(recipient);
  }
  return false;
}

function titleHasScope(row, scope) {
  const title = String(row.award_title || '').toLowerCase();
  if (!title) return false;
  if (scope === 'spacex') {
    return /\bspacex\b|space\s*x|space\s*exploration\s*technologies|starship|falcon|starlink|nssl/.test(title);
  }
  if (scope === 'blue-origin') {
    return /\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b|\bnew\s*shepherd|\bnew\s*shepard|\bbe\s*4\b|viper/.test(title);
  }
  return false;
}

function rowHasMetadataScope(row, scope) {
  const scopes = readMetadataScopes(row.metadata || {}, row.program_scope);
  return scopes.includes(scope);
}

function dedupeByAward(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.usaspending_award_id || ''}|${r.awarded_on || ''}|${r.award_title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function topRows(rows, n = 20) {
  return rows.slice(0, n).map((row) => ({
    usaspending_award_id: row.usaspending_award_id || null,
    award_title: row.award_title,
    recipient: row.recipient,
    awarded_on: row.awarded_on,
    program_scope: row.program_scope || null,
    scopes: readMetadataScopes(row.metadata || {}, row.program_scope)
  }));
}

(async () => {
  loadEnv('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing env vars');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const procurementRows = await fetchAllProcurement(supabase);
  const total = procurementRows.length;

  const directSpacex = procurementRows.filter((r) => normalizeScope(r.program_scope) === 'spacex');
  const directBlue = procurementRows.filter((r) => normalizeScope(r.program_scope) === 'blue-origin');

  const directSpacexWithAward = directSpacex.filter((r) => Boolean(r.usaspending_award_id)).length;
  const directBlueWithAward = directBlue.filter((r) => Boolean(r.usaspending_award_id)).length;

  const recSpacex = procurementRows.filter((r) => rowHasRecipient(r, 'spacex'));
  const recBlue = procurementRows.filter((r) => rowHasRecipient(r, 'blue-origin'));
  const titleSpacex = procurementRows.filter((r) => titleHasScope(r, 'spacex'));
  const titleBlue = procurementRows.filter((r) => titleHasScope(r, 'blue-origin'));
  const metaSpacex = procurementRows.filter((r) => rowHasMetadataScope(r, 'spacex'));
  const metaBlue = procurementRows.filter((r) => rowHasMetadataScope(r, 'blue-origin'));

  const spacexUnion = dedupeByAward(procurementRows.filter((r) => {
    return rowHasMetadataScope(r, 'spacex') || rowHasRecipient(r, 'spacex') || titleHasScope(r, 'spacex');
  }));
  const blueUnion = dedupeByAward(procurementRows.filter((r) => {
    return rowHasMetadataScope(r, 'blue-origin') || rowHasRecipient(r, 'blue-origin') || titleHasScope(r, 'blue-origin');
  }));

  const blueOnlyProc = blueUnion.filter((row) => !directBlue.includes(row));
  const spacexOnlyProc = spacexUnion.filter((row) => !directSpacex.includes(row));

  const artemisContract = await supabase
    .from('artemis_contracts')
    .select('piid,contract_key,mission_key,awardee_name,base_award_date,description')
    .order('base_award_date', { ascending: false, nullsFirst: false });
  if (artemisContract.error) throw artemisContract.error;

  const artRows = artemisContract.data || [];
  const artSpacex = artRows.filter((r) => {
    const awardee = String(r.awardee_name || '').toLowerCase();
    return /space\s*exploration\s*technologies|\bspacex\b|space\s*x/.test(awardee);
  });
  const artBlue = artRows.filter((r) => /\bblue\s*origin\b/.test(String(r.awardee_name || '').toLowerCase()));

  const boContracts = await supabase
    .from('blue_origin_contracts')
    .select('id,contract_key,title,agency,customer,awarded_on,mission_key,source_label,amount,description')
    .order('awarded_on', { ascending: false, nullsFirst: false });
  if (boContracts.error) throw boContracts.error;

  const boRows = boContracts.data || [];
  const boBlue = boRows.filter((r) => /\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b|\bnew\s*shepherd|\bnew\s*shepard/.test(String(r.customer || '').toLowerCase()) || /\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b/.test(String(r.title || '').toLowerCase()));
  const boSpacex = boRows.filter((r) => /\bspace\s*x\b|\bspacex\b|\bstarship\b|\bfalcon\b|\bstarlink\b/.test(String(r.customer || '').toLowerCase() + ' ' + String(r.title || '').toLowerCase() + ' ' + String(r.description || '').toLowerCase()));
  const boUsaspending = boRows.filter((r) => /^USASPENDING-/.test(r.contract_key));

  const summary = {
    procurement_rows_total: total,
    artemis_contracts_total: artRows.length,
    blue_origin_contracts_total: boRows.length,

    procurement: {
      direct_scope_counts: {
        spacex: directSpacex.length,
        blue_origin: directBlue.length
      },
      direct_scope_with_award_id: {
        spacex: directSpacexWithAward,
        blue_origin: directBlueWithAward
      },
      strict_union_counts: {
        spacex: spacexUnion.length,
        blue_origin: blueUnion.length
      },
      strict_union_extra_not_direct: {
        spacex: spacexOnlyProc.length,
        blue_origin: blueOnlyProc.length
      },
      by_recipient: {
        spacex: recSpacex.length,
        blue_origin: recBlue.length
      },
      by_title: {
        spacex: titleSpacex.length,
        blue_origin: titleBlue.length
      },
      by_metadata_scope: {
        spacex: metaSpacex.length,
        blue_origin: metaBlue.length
      },
      samples: {
        spacex: {
          strict_union_top: topRows(spacexUnion),
          direct_top: topRows(directSpacex)
        },
        blue_origin: {
          strict_union_top: topRows(blueUnion),
          direct_top: topRows(directBlue),
          non_direct_top: topRows(blueOnlyProc)
        }
      }
    },

    artemis_contracts_awards: {
      spacex_awardee_like: {
        count: artSpacex.length,
        top: artSpacex.slice(0, 20).map((r) => ({
          piid: r.piid,
          contract_key: r.contract_key,
          awardee_name: r.awardee_name,
          base_award_date: r.base_award_date,
          mission_key: r.mission_key
        }))
      },
      blue_origin_awardee_like: {
        count: artBlue.length,
        top: artBlue.slice(0, 20).map((r) => ({
          piid: r.piid,
          contract_key: r.contract_key,
          awardee_name: r.awardee_name,
          base_award_date: r.base_award_date,
          mission_key: r.mission_key
        }))
      }
    },

    blue_origin_contracts: {
      match_blue_origin: {
        count: boBlue.length,
        top: boBlue.slice(0, 30).map((r) => ({
          contract_key: r.contract_key,
          title: r.title,
          customer: r.customer,
          awarded_on: r.awarded_on,
          mission_key: r.mission_key,
          source_label: r.source_label,
          amount: r.amount
        }))
      },
      match_spacex: {
        count: boSpacex.length,
        top: boSpacex.slice(0, 20).map((r) => ({
          contract_key: r.contract_key,
          title: r.title,
          customer: r.customer,
          awarded_on: r.awarded_on,
          mission_key: r.mission_key,
          source_label: r.source_label,
          amount: r.amount
        }))
      },
      usaspending_prefix: {
        count: boUsaspending.length,
        top: boUsaspending.slice(0, 20).map((r) => ({
          contract_key: r.contract_key,
          awarded_on: r.awarded_on,
          title: r.title,
          customer: r.customer
        }))
      }
    }
  };

  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
