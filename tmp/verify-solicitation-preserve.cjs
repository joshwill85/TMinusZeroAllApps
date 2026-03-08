const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function str(value) {
  return typeof value === 'string' ? value : '';
}

function norm(value) {
  return str(value).trim().toLowerCase();
}

function normalizeProgramScope(value) {
  const n = norm(value);
  if (!n) return null;
  if (n === 'artemis') return 'artemis';
  if (n === 'blue-origin' || n === 'blue_origin' || n === 'blueorigin' || n === 'blue') return 'blue-origin';
  if (n === 'spacex' || n === 'space-x' || n === 'space_x' || n === 'space x') return 'spacex';
  if (n === 'other') return 'other';
  return null;
}

function inferScopeFromContract(row) {
  const metadata = row && row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  const direct = normalizeProgramScope(metadata.programScope || metadata.program_scope);
  if (direct) return direct;

  if (row && row.mission_key && String(row.mission_key) !== 'program') return 'artemis';

  const text = [
    row ? row.awardee_name : null,
    row ? row.description : null,
    row ? row.contract_key : null,
    metadata.recipient,
    metadata.keyword
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b/.test(text)) return 'blue-origin';
  if (/\bspace\s*x\b|\bspacex\b|\bstarship\b|\bfalcon\b|\bdragon\b|\bstarlink\b/.test(text)) return 'spacex';
  if (/\bartemis\b|\bsls\b|\borion\b|\bhuman\s+landing\s+system\b|\bgateway\b/.test(text)) return 'artemis';
  return 'other';
}

async function fetchAll(table, selectCols, orderCol) {
  const out = [];
  let from = 0;
  const step = 1000;

  while (true) {
    const res = await admin
      .from(table)
      .select(selectCols)
      .order(orderCol, { ascending: true })
      .range(from, from + step - 1);

    if (res.error) throw new Error(table + ' fetch failed: ' + res.error.message);
    const batch = res.data || [];
    out.push(...batch);
    if (batch.length < step) break;

    from += step;
    if (from > 200000) throw new Error('pagination safety break for ' + table);
  }

  return out;
}

async function collectCounts() {
  const contracts = await fetchAll(
    'artemis_contracts',
    'id,contract_key,mission_key,awardee_name,description,metadata',
    'id'
  );
  const actions = await fetchAll(
    'artemis_contract_actions',
    'id,contract_id,solicitation_id,sam_notice_id',
    'id'
  );

  const scopeByContractId = new Map();
  for (const contract of contracts) {
    scopeByContractId.set(String(contract.id), inferScopeFromContract(contract));
  }

  const out = {
    artemis: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
    'blue-origin': { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
    spacex: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
    other: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
    unknown: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 }
  };

  for (const action of actions) {
    const scope = scopeByContractId.get(String(action.contract_id)) || 'unknown';
    const bucket = out[scope] || out.unknown;
    bucket.total += 1;

    const solicitationId = str(action.solicitation_id);
    const samNoticeId = str(action.sam_notice_id);

    if (!solicitationId) {
      bucket.missingSolicitation += 1;
    } else if (!samNoticeId) {
      bucket.hasSolicitationNoNotice += 1;
    } else {
      bucket.hasSolicitationWithNotice += 1;
    }
  }

  return out;
}

async function waitForRun(runId, startedAfterIso) {
  const started = Date.now();
  while (Date.now() - started < 6 * 60 * 1000) {
    const byId = runId
      ? await admin
          .from('ingestion_runs')
          .select('id,started_at,ended_at,success,error,stats')
          .eq('job_name', 'artemis_contracts_ingest')
          .eq('id', String(runId))
          .maybeSingle()
      : null;

    if (byId && byId.error) throw byId.error;
    let run = byId && byId.data ? byId.data : null;

    if (!run) {
      const latest = await admin
        .from('ingestion_runs')
        .select('id,started_at,ended_at,success,error,stats')
        .eq('job_name', 'artemis_contracts_ingest')
        .gte('started_at', startedAfterIso)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw latest.error;
      run = latest.data || null;
    }

    if (run && run.ended_at) return run;
    await sleep(2000);
  }

  return null;
}

(async () => {
  const out = {
    startedAtUtc: new Date().toISOString(),
    run: null,
    before: null,
    after: null,
    delta: null,
    errors: []
  };

  try {
    const tokenRes = await admin.from('system_settings').select('key,value').in('key', ['jobs_auth_token','artemis_contracts_job_enabled']);
    if (tokenRes.error) throw new Error(tokenRes.error.message);
    const map = {};
    for (const row of tokenRes.data || []) map[row.key] = row.value;
    const token = String(map.jobs_auth_token || '').split(',').map((s) => s.trim()).filter(Boolean)[0] || null;
    if (!token) throw new Error('jobs_auth_token missing');

    const enable = await admin
      .from('system_settings')
      .upsert([{ key: 'artemis_contracts_job_enabled', value: true }], { onConflict: 'key' });
    if (enable.error) throw new Error(enable.error.message);

    out.before = await collectCounts();

    const startedAfterIso = new Date().toISOString();
    const invoke = await admin.functions.invoke('artemis-contracts-ingest', {
      method: 'POST',
      headers: { 'x-job-token': token },
      body: {
        mode: 'incremental',
        stage: 'all',
        samSessionToken: 'verify-preserve-' + Date.now(),
        samMaxRequestsPerRun: 0,
        samSinglePassPerEndpoint: false,
        samStopOnEmptyOrError: false
      }
    });

    const invokeData = invoke.data && typeof invoke.data === 'object' ? invoke.data : {};
    const runId = Object.prototype.hasOwnProperty.call(invokeData, 'runId') ? invokeData.runId : null;
    const run = await waitForRun(runId, startedAfterIso);
    out.run = run;

    out.after = await collectCounts();

    const scopes = ['artemis', 'blue-origin', 'spacex', 'other', 'unknown'];
    const delta = {};
    for (const scope of scopes) {
      const b = out.before[scope];
      const a = out.after[scope];
      delta[scope] = {
        missingSolicitation: (a?.missingSolicitation || 0) - (b?.missingSolicitation || 0),
        hasSolicitationNoNotice: (a?.hasSolicitationNoNotice || 0) - (b?.hasSolicitationNoNotice || 0),
        hasSolicitationWithNotice: (a?.hasSolicitationWithNotice || 0) - (b?.hasSolicitationWithNotice || 0)
      };
    }
    out.delta = delta;
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
  }

  console.log(JSON.stringify(out, null, 2));
  if (out.errors.length) process.exit(1);
})();
