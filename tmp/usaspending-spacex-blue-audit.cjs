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

loadEnv('.env.local');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const SPACEX_RECIPIENT_RE = /(space\s*x|spacex|space exploration technologies)/i;
const SPACEX_TITLE_RE = /(spacex|space\s*x|starship|falcon|dragon|starlink|starship|launch vehicle|reusable|merlin)/i;
const SPACEX_METADATA_RE = /(spacex|space\s*x|starship|falcon|dragon|starlink)/i;

const BLUE_RECIPIENT_RE = /blue\s*origin/i;
const BLUE_TITLE_RE = /(blue\s*origin|blue\s*moon|new\s*glenn|blue\s*ring|new\s*shepard|be\-?4|viper\s*rover)/i;
const BLUE_METADATA_RE = /(blue\s*origin|blue\s*moon|new\s*glenn|blue\s*ring|be\-?4|viper\s*rover)/i;

function normalizeScope(value) {
  if (!value || typeof value !== 'string') return null;
  const n = value.trim().toLowerCase();
  if (['spacex', 'space-x', 'space_x', 'space x'].includes(n)) return 'spacex';
  if (['blue-origin', 'blue_origin', 'blueorigin', 'blue'].includes(n)) return 'blue-origin';
  if (n === 'artemis') return 'artemis';
  return null;
}

function readMetadataStringArray(metadata, key) {
  const value = metadata?.[key];
  if (typeof value === 'string') return [value.toLowerCase()];
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
}

function metadataScopes(metadata, fallbackScope) {
  const fallback = normalizeScope(fallbackScope) || null;
  const set = new Set();

  const direct = normalizeScope(metadata?.programScope || metadata?.program_scope);
  if (direct) set.add(direct);

  for (const raw of [...readMetadataStringArray(metadata, 'programScopes'), ...readMetadataStringArray(metadata, 'program_scopes')]) {
    const normalized = normalizeScope(raw);
    if (normalized) set.add(normalized);
  }

  if (set.size === 0 && fallback) set.add(fallback);
  return [...set.values()];
}

function classifySpacex(row) {
  const recipient = String(row.recipient || '');
  const title = String(row.award_title || '');
  const meta = row.metadata || {};
  const scopes = metadataScopes(meta, row.program_scope);

  const reasons = [];
  if (SPACEX_RECIPIENT_RE.test(recipient)) reasons.push('recipient');
  if (SPACEX_TITLE_RE.test(title)) reasons.push('title');
  if (SPACEX_METADATA_RE.test(String(meta.detail || ''))) reasons.push('metadata.detail');
  if (SPACEX_METADATA_RE.test(String(meta.description || ''))) reasons.push('metadata.description');
  if (scopes.includes('spacex')) reasons.push('metadata.scope');

  return {
    match: reasons.length > 0,
    reasons,
    scopes
  };
}

function classifyBlue(row) {
  const recipient = String(row.recipient || '');
  const title = String(row.award_title || '');
  const meta = row.metadata || {};
  const scopes = metadataScopes(meta, row.program_scope);

  const reasons = [];
  if (BLUE_RECIPIENT_RE.test(recipient)) reasons.push('recipient');
  if (BLUE_TITLE_RE.test(title)) reasons.push('title');
  if (BLUE_METADATA_RE.test(String(meta.detail || ''))) reasons.push('metadata.detail');
  if (BLUE_METADATA_RE.test(String(meta.description || ''))) reasons.push('metadata.description');
  if (scopes.includes('blue-origin')) reasons.push('metadata.scope');

  return {
    match: reasons.length > 0,
    reasons,
    scopes
  };
}

function makeProcurementSummary(row) {
  return {
    usaspending_award_id: row.usaspending_award_id || null,
    award_title: row.award_title,
    recipient: row.recipient,
    awarded_on: row.awarded_on,
    mission_key: row.mission_key,
    program_scope: row.program_scope || null,
    metadata_scope: metadataScopes(row.metadata || {}, row.program_scope),
    reasons: row.matchReasons
  };
}

function dedupeRowsByAward(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.usaspending_award_id || ''}|${row.awarded_on || ''}|${row.award_title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function fetchProcurementRows() {
  const rows = [];
  const batch = 500;
  let from = 0;

  while (true) {
    const to = from + batch - 1;
    const res = await supabase
      .from('artemis_procurement_awards')
      .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,program_scope,metadata,updated_at')
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('usaspending_award_id')
      .range(from, to);

    if (res.error) throw res.error;
    const chunk = res.data || [];
    rows.push(...chunk);
    if (chunk.length < batch) break;
    from += batch;
  }

  return rows;
}

function analyzeProcurement(rows) {
  const directSpacex = rows.filter((row) => normalizeScope(row.program_scope) === 'spacex');
  const directBlue = rows.filter((row) => normalizeScope(row.program_scope) === 'blue-origin');

  const evaluatedSpacex = rows.map((row) => {
    const evalRow = classifySpacex(row);
    return { row, evalRow };
  });

  const evaluatedBlue = rows.map((row) => {
    const evalRow = classifyBlue(row);
    return { row, evalRow };
  });

  const spacexMatches = evaluatedSpacex.filter((r) => r.evalRow.match);
  const blueMatches = evaluatedBlue.filter((r) => r.evalRow.match);

  const spacedScopelySpacex = new Set(directSpacex.map((row) => row.usaspending_award_id));

  const spacexNonDirect = [];
  const blueNonDirect = [];

  for (const { row } of spacexMatches) {
    if (!spacedScopelySpacex.has(row.usaspending_award_id) && row.usaspending_award_id) {
      spacexNonDirect.push(row);
    }
  }

  for (const { row } of blueMatches) {
    if (normalizeScope(row.program_scope) !== 'blue-origin' && row.usaspending_award_id) {
      blueNonDirect.push(row);
    }
  }

  const spacedWithScopesOnly = evaluatedSpacex.filter((entry) => entry.evalRow.reasons.includes('metadata.scope')).length;
  const spacedByTextOnly = evaluatedSpacex.filter((entry) => entry.evalRow.match && !entry.evalRow.reasons.includes('metadata.scope')).length;
  const blueWithScopesOnly = evaluatedBlue.filter((entry) => entry.evalRow.reasons.includes('metadata.scope')).length;
  const blueByTextOnly = evaluatedBlue.filter((entry) => entry.evalRow.match && !entry.evalRow.reasons.includes('metadata.scope')).length;

  const spacexRows = dedupeRowsByAward(
    spacexMatches.map(({ row, evalRow }) => ({
      ...row,
      matchReasons: evalRow.reasons
    }))
  );

  const blueRows = dedupeRowsByAward(
    blueMatches.map(({ row, evalRow }) => ({
      ...row,
      matchReasons: evalRow.reasons
    }))
  );

  return {
    total_rows: rows.length,
    direct_scope_counts: {
      spacex: directSpacex.length,
      blue_origin: directBlue.length
    },
    matches: {
      spacex: {
        unique_awards: spacexRows.length,
        direct_scope: spacedScopelySpacex.size,
        metadata_scope: spacedWithScopesOnly,
        text_or_other: spacedByTextOnly,
        non_direct_count: dedupeRowsByAward(spacexNonDirect).length,
        missing_award_id_in_scope: directSpacex.filter((row) => !row.usaspending_award_id).length,
        sample: spacexRows.slice(0, 25).map(makeProcurementSummary)
      },
      blue_origin: {
        unique_awards: blueRows.length,
        direct_scope: directBlue.length,
        metadata_scope: blueWithScopesOnly,
        text_or_other: blueByTextOnly,
        non_direct_count: dedupeRowsByAward(blueNonDirect).length,
        missing_award_id_in_scope: directBlue.filter((row) => !row.usaspending_award_id).length,
        sample: blueRows.slice(0, 25).map(makeProcurementSummary)
      }
    }
  };
}

function analyzeArtemisContracts() {
  return supabase
    .from('artemis_contracts')
    .select('piid,contract_key,mission_key,awardee_name,description,base_award_date')
    .order('base_award_date', { ascending: false, nullsFirst: false });
}

function analyzeBlueOriginContracts() {
  return supabase
    .from('blue_origin_contracts')
    .select('id,contract_key,mission_key,title,agency,customer,amount,awarded_on,description,source_label,source_url')
    .order('awarded_on', { ascending: false, nullsFirst: false });
}

function artemisMatchSummary(rows) {
  const spacex = [];
  const blue = [];

  for (const row of rows) {
    const awardee = String(row.awardee_name || '');
    const desc = String(row.description || '');
    if (SPACEX_RECIPIENT_RE.test(awardee) || SPACEX_TITLE_RE.test(desc)) {
      spacex.push(row);
    }
    if (BLUE_RECIPIENT_RE.test(awardee) || BLUE_TITLE_RE.test(desc)) {
      blue.push(row);
    }
  }

  return {
    total: rows.length,
    spacex_like: spacex.length,
    blue_origin_like: blue.length,
    spacex_samples: spacex.slice(0, 20),
    blue_origin_samples: blue.slice(0, 20)
  };
}

function blueOriginContractSummary(rows) {
  const blue = [];
  const spacex = [];
  const usaspending = [];

  for (const row of rows) {
    const hay = `${row.title || ''} ${row.customer || ''} ${row.description || ''}`.toLowerCase();
    if (BLUE_TITLE_RE.test(hay) || BLUE_RECIPIENT_RE.test(hay)) blue.push(row);
    if (SPACEX_RECIPIENT_RE.test(hay) || SPACEX_TITLE_RE.test(hay)) spacex.push(row);
    if (/^USASPENDING-/.test(row.contract_key)) usaspending.push(row);
  }

  return {
    total: rows.length,
    blue_origin_like: blue.length,
    spacex_like: spacex.length,
    usaspending_prefix_count: usaspending.length,
    usaspending_prefix_sample: usaspending.slice(0, 30).map((row) => ({
      contract_key: row.contract_key,
      title: row.title,
      customer: row.customer,
      awarded_on: row.awarded_on,
      mission_key: row.mission_key,
      source_label: row.source_label
    })),
    blue_origin_sample: blue.slice(0, 20).map((row) => ({
      contract_key: row.contract_key,
      title: row.title,
      customer: row.customer,
      awarded_on: row.awarded_on,
      mission_key: row.mission_key,
      source_label: row.source_label,
      amount: row.amount
    })),
    spacex_sample: spacex.slice(0, 20).map((row) => ({
      contract_key: row.contract_key,
      title: row.title,
      customer: row.customer,
      awarded_on: row.awarded_on,
      mission_key: row.mission_key,
      source_label: row.source_label,
      amount: row.amount
    }))
  };
}

async function run() {
  const procurementRows = await fetchProcurementRows();
  const procurementAudit = analyzeProcurement(procurementRows);

  const artemisRes = await analyzeArtemisContracts();
  if (artemisRes.error) throw artemisRes.error;
  const artemisAudit = artemisMatchSummary(artemisRes.data || []);

  const boRes = await analyzeBlueOriginContracts();
  if (boRes.error) throw boRes.error;
  const blueOriginAudit = blueOriginContractSummary(boRes.data || []);

  const summary = {
    procurement_awards: procurementAudit,
    artemis_contracts: artemisAudit,
    blue_origin_contracts: blueOriginAudit
  };

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
