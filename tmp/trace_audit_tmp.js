const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(path = '.env.local') {
  const raw = fs.readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
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

function normalizeScopes(row) {
  const out = new Set();
  const direct = normalizeScope(row.program_scope);
  if (direct) out.add(direct);

  const md = row.metadata || {};
  if (md && typeof md === 'object' && !Array.isArray(md)) {
    for (const key of ['programScope', 'program_scope']) {
      const normalized = normalizeScope(md[key]);
      if (normalized) out.add(normalized);
    }

    const candidateScopes = [];
    if (Array.isArray(md.programScopes)) candidateScopes.push(...md.programScopes);
    if (Array.isArray(md.program_scopes)) candidateScopes.push(...md.program_scopes);

    for (const candidate of candidateScopes) {
      const normalized = normalizeScope(candidate);
      if (normalized) out.add(normalized);
    }
  }

  return [...out];
}

function candidatesForRow(row) {
  const md = row.metadata || {};
  const out = [];
  const add = (value) => {
    const v = (value || '').toString().trim();
    if (v && !out.includes(v)) out.push(v);
  };

  add(md.piid);
  add(md.awardId);
  add(md.generatedAwardId);
  add(row.usaspending_award_id);
  return out;
}

function safeLower(value) {
  return (value || '').toString().trim().toLowerCase();
}

async function fetchAll(supabase, table, select, orderBy) {
  const rows = [];
  let from = 0;
  const page = 1000;

  while (true) {
    const to = from + page - 1;
    let query = supabase.from(table).select(select).range(from, to);
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending, nullsFirst: orderBy.nullsFirst });
    }

    const { data, error } = await query;
    if (error) throw error;

    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < page) break;
    from += page;
  }

  return rows;
}

function analyzeSet(name, rows, contractIndex) {
  let withUsaspendingAwardId = 0;
  let withCandidate = 0;
  let traceable = 0;
  const missing = [];

  for (const row of rows) {
    const hasAward = Boolean((row.usaspending_award_id || '').toString().trim());
    if (hasAward) withUsaspendingAwardId++;

    const candidates = candidatesForRow(row);
    if (candidates.length) withCandidate++;

    let matched = false;
    for (const candidate of candidates) {
      const key = safeLower(candidate);
      if (!key) continue;

      if (
        contractIndex.byPiid.has(key) ||
        contractIndex.bySourceAward.has(key) ||
        contractIndex.byContractKeyExact.has(key) ||
        contractIndex.byContractKeyPrefix.has(key) ||
        contractIndex.byContractKeyPrefix.has(key + '|')
      ) {
        matched = true;
        break;
      }
    }

    if (matched) {
      traceable++;
    } else {
      missing.push({
        usaspending_award_id: row.usaspending_award_id || null,
        award_title: row.award_title,
        recipient: row.recipient,
        candidates,
        scopes: normalizeScopes(row)
      });
    }
  }

  missing.sort((a, b) => String(a.recipient || '').localeCompare(String(b.recipient || '')));

  return {
    scope: name,
    total: rows.length,
    withUsaspendingAwardId,
    withCandidate,
    traceable,
    notTraceable: rows.length - traceable,
    notTraceableRate: rows.length ? (rows.length - traceable) / rows.length : 0,
    sampleMissing: missing.slice(0, 25)
  };
}

(async () => {
  loadEnv('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('Missing environment vars');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const procurement = await fetchAll(
    supabase,
    'artemis_procurement_awards',
    'id,usaspending_award_id,award_title,recipient,metadata,program_scope,awarded_on'
  );

  const contracts = await fetchAll(
    supabase,
    'artemis_contracts',
    'id,piid,contract_key,metadata,mission_key'
  );

  const index = {
    byPiid: new Set(),
    bySourceAward: new Set(),
    byContractKeyExact: new Set(),
    byContractKeyPrefix: new Set()
  };

  for (const row of contracts) {
    const piid = safeLower(row.piid);
    if (piid) index.byPiid.add(piid);

    const md = row.metadata || {};
    if (md && typeof md === 'object' && !Array.isArray(md)) {
      const sourceAwardId = (md.sourceAwardId || '').toString().trim();
      if (sourceAwardId) index.bySourceAward.add(safeLower(sourceAwardId));
    }

    const contractKey = (row.contract_key || '').toString().trim();
    if (contractKey) {
      index.byContractKeyExact.add(contractKey.toLowerCase());
      const base = contractKey.split('|')[0];
      if (base) index.byContractKeyPrefix.add(base.toLowerCase() + '|');
    }
  }

  const scoped = { spacex: [], blue: [], artemis: [], other: [] };

  for (const row of procurement) {
    const scopes = normalizeScopes(row);
    if (scopes.includes('spacex')) scoped.spacex.push(row);
    else if (scopes.includes('blue-origin')) scoped.blue.push(row);
    else if (scopes.includes('artemis')) scoped.artemis.push(row);
    else scoped.other.push(row);
  }

  const repSpacex = analyzeSet('spacex', scoped.spacex, index);
  const repBlue = analyzeSet('blue-origin', scoped.blue, index);
  const repArtemis = analyzeSet('artemis', scoped.artemis, index);
  const repUnion = analyzeSet('union', [...scoped.spacex, ...scoped.blue, ...scoped.artemis], index);

  console.log('TRACE_AUDIT', JSON.stringify({
    procurementTotal: procurement.length,
    artemisContractsTotal: contracts.length,
    scopedCount: {
      spacex: scoped.spacex.length,
      blue: scoped.blue.length,
      artemis: scoped.artemis.length,
      other: scoped.other.length,
      union: scoped.spacex.length + scoped.blue.length + scoped.artemis.length
    },
    report: {
      spacex: repSpacex,
      blue: repBlue,
      artemis: repArtemis,
      union: repUnion
    }
  }, null, 2));
})();
