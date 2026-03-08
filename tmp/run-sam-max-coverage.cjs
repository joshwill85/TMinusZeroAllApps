const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nowIso() {
  return new Date().toISOString();
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function norm(value) {
  return str(value).trim().toLowerCase();
}

function toSettingsMap(rows) {
  const out = {};
  for (const row of rows || []) out[row.key] = row.value;
  return out;
}

function pickJobToken(raw) {
  if (typeof raw !== 'string') return null;
  const first = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0];
  return first || null;
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

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
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

async function waitForRun(runId, startedAfterIso, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    let q;

    if (runId != null) {
      q = await admin
        .from('ingestion_runs')
        .select('id,job_name,started_at,ended_at,success,error,stats')
        .eq('job_name', 'artemis_contracts_ingest')
        .eq('id', String(runId))
        .maybeSingle();
    } else {
      q = await admin
        .from('ingestion_runs')
        .select('id,job_name,started_at,ended_at,success,error,stats')
        .eq('job_name', 'artemis_contracts_ingest')
        .gte('started_at', startedAfterIso)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (q.error) throw new Error('waitForRun query failed: ' + q.error.message);
    const run = q.data || null;
    if (run && run.ended_at) return run;

    await sleep(2500);
  }

  return null;
}

(async () => {
  const result = {
    startedAtUtc: nowIso(),
    settingsBefore: null,
    runSummaries: [],
    postMetrics: null,
    settingsAfterRestore: null,
    restored: false,
    errors: []
  };

  const settingsKeys = [
    'jobs_auth_token',
    'artemis_contracts_job_enabled',
    'artemis_sam_disable_job_on_guardrail',
    'artemis_sam_stop_on_empty_or_error',
    'artemis_sam_probe_both_endpoints_first',
    'artemis_sam_single_pass_per_endpoint',
    'artemis_sam_max_requests_per_run',
    'artemis_sam_quota_state'
  ];

  let restoreEnabled = true;
  let restoreDisableGuardrail = true;
  let restoreStopOnEmpty = true;

  try {
    const settingsRes = await admin.from('system_settings').select('key,value').in('key', settingsKeys);
    if (settingsRes.error) throw new Error('settings read failed: ' + settingsRes.error.message);
    const settings = toSettingsMap(settingsRes.data || []);
    result.settingsBefore = settings;

    if (Object.prototype.hasOwnProperty.call(settings, 'artemis_contracts_job_enabled')) {
      restoreEnabled = settings.artemis_contracts_job_enabled;
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'artemis_sam_disable_job_on_guardrail')) {
      restoreDisableGuardrail = settings.artemis_sam_disable_job_on_guardrail;
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'artemis_sam_stop_on_empty_or_error')) {
      restoreStopOnEmpty = settings.artemis_sam_stop_on_empty_or_error;
    }

    const token = pickJobToken(settings.jobs_auth_token);
    if (!token) throw new Error('jobs_auth_token is missing/empty');

    const prep = await admin
      .from('system_settings')
      .upsert(
        [
          { key: 'artemis_contracts_job_enabled', value: true },
          { key: 'artemis_sam_disable_job_on_guardrail', value: false },
          { key: 'artemis_sam_stop_on_empty_or_error', value: false }
        ],
        { onConflict: 'key' }
      );
    if (prep.error) throw new Error('prep settings update failed: ' + prep.error.message);

    let noProgressRuns = 0;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const invokedAt = nowIso();
      const invokeBody = {
        mode: 'incremental',
        stage: 'all',
        samSessionToken: 'maxcov-' + Date.now() + '-' + attempt,
        samMaxRequestsPerRun: 10,
        samSinglePassPerEndpoint: false,
        samStopOnEmptyOrError: false
      };

      const invokeRes = await admin.functions.invoke('artemis-contracts-ingest', {
        method: 'POST',
        headers: { 'x-job-token': token },
        body: invokeBody
      });

      if (invokeRes.error) {
        result.errors.push('invoke attempt ' + attempt + ' failed: ' + invokeRes.error.message);
        break;
      }

      const invokeData = invokeRes.data && typeof invokeRes.data === 'object' ? invokeRes.data : {};
      const runId = Object.prototype.hasOwnProperty.call(invokeData, 'runId') ? invokeData.runId : null;

      const run = await waitForRun(runId, invokedAt, 6 * 60 * 1000);
      if (!run) {
        result.errors.push('attempt ' + attempt + ' timed out waiting for run completion');
        break;
      }

      const stats = run.stats && typeof run.stats === 'object' ? run.stats : {};
      const summary = {
        attempt,
        runId: run.id,
        started_at: run.started_at,
        ended_at: run.ended_at,
        success: run.success,
        error: run.error,
        samRequestsAttempted: number(stats.samRequestsAttempted),
        samRequestsGranted: number(stats.samRequestsGranted),
        samAwardsRequestsAttempted: number(stats.samAwardsRequestsAttempted),
        samAwardsRequestsGranted: number(stats.samAwardsRequestsGranted),
        samOpportunitiesRequestsAttempted: number(stats.samOpportunitiesRequestsAttempted),
        samOpportunitiesRequestsGranted: number(stats.samOpportunitiesRequestsGranted),
        samAwardsRowsUpserted: number(stats.samAwardsRowsUpserted),
        samNoticesUpserted: number(stats.samNoticesUpserted),
        solicitationIdsEvaluated: number(stats.solicitationIdsEvaluated),
        samRequestStopReason: stats.samRequestStopReason || null,
        samGuardrailReason: stats.samGuardrailReason || null,
        samStopReasons: Array.isArray(stats.samStopReasons) ? stats.samStopReasons : [],
        samAwardCandidateScopeDistribution: stats.samAwardCandidateScopeDistribution || null,
        samOpportunitiesFallbackScopeDistribution: stats.samOpportunitiesFallbackScopeDistribution || null,
        samQuota: stats.samQuota || null
      };
      result.runSummaries.push(summary);

      const progressed = summary.samAwardsRowsUpserted > 0 || summary.samNoticesUpserted > 0;
      if (!progressed) noProgressRuns += 1;
      else noProgressRuns = 0;

      const quota = summary.samQuota && typeof summary.samQuota === 'object' ? summary.samQuota : null;
      const remaining = quota ? number(quota.remaining) : null;
      if (remaining !== null && remaining <= 0) break;
      if (noProgressRuns >= 2) break;
    }

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
    const samAwardRows = await fetchAll(
      'artemis_sam_contract_award_rows',
      'contract_id,program_scope,solicitation_id,row_key,updated_at',
      'row_key'
    );

    const scopeByContractId = new Map();
    for (const contract of contracts) {
      scopeByContractId.set(String(contract.id), inferScopeFromContract(contract));
    }

    const actionCounts = {
      artemis: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
      'blue-origin': { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
      spacex: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
      other: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 },
      unknown: { total: 0, missingSolicitation: 0, hasSolicitationNoNotice: 0, hasSolicitationWithNotice: 0 }
    };

    const distinctNoNotice = {
      artemis: new Set(),
      'blue-origin': new Set(),
      spacex: new Set(),
      other: new Set(),
      unknown: new Set()
    };

    for (const action of actions) {
      const scope = scopeByContractId.get(String(action.contract_id)) || 'unknown';
      const bucket = actionCounts[scope] || actionCounts.unknown;
      bucket.total += 1;

      const solicitationId = str(action.solicitation_id);
      const samNoticeId = str(action.sam_notice_id);

      if (!solicitationId) {
        bucket.missingSolicitation += 1;
      } else if (!samNoticeId) {
        bucket.hasSolicitationNoNotice += 1;
        if (distinctNoNotice[scope]) distinctNoNotice[scope].add(solicitationId);
      } else {
        bucket.hasSolicitationWithNotice += 1;
      }
    }

    const awardRowsByScope = {};
    const awardContractsByScope = {};
    for (const row of samAwardRows) {
      const scope = str(row.program_scope) || 'unknown';
      awardRowsByScope[scope] = (awardRowsByScope[scope] || 0) + 1;
      if (!awardContractsByScope[scope]) awardContractsByScope[scope] = new Set();
      if (row.contract_id) awardContractsByScope[scope].add(String(row.contract_id));
    }

    const awardContractsByScopeCount = {};
    for (const [scope, set] of Object.entries(awardContractsByScope)) {
      awardContractsByScopeCount[scope] = set.size;
    }

    const distinctNoNoticeCount = {};
    for (const [scope, set] of Object.entries(distinctNoNotice)) {
      distinctNoNoticeCount[scope] = set.size;
    }

    result.postMetrics = {
      sampledAtUtc: nowIso(),
      totals: {
        contracts: contracts.length,
        actions: actions.length,
        samAwardRows: samAwardRows.length
      },
      actionCountsByScope: actionCounts,
      distinctSolicitationIdsNoNoticeByScope: distinctNoNoticeCount,
      samAwardRowsByScope: awardRowsByScope,
      samAwardDistinctContractsByScope: awardContractsByScopeCount
    };
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    const restore = await admin
      .from('system_settings')
      .upsert(
        [
          { key: 'artemis_contracts_job_enabled', value: restoreEnabled },
          { key: 'artemis_sam_disable_job_on_guardrail', value: restoreDisableGuardrail },
          { key: 'artemis_sam_stop_on_empty_or_error', value: restoreStopOnEmpty }
        ],
        { onConflict: 'key' }
      );

    if (restore.error) {
      result.errors.push('restore failed: ' + restore.error.message);
    } else {
      result.restored = true;
    }

    const afterRes = await admin
      .from('system_settings')
      .select('key,value')
      .in('key', [
        'artemis_contracts_job_enabled',
        'artemis_sam_disable_job_on_guardrail',
        'artemis_sam_stop_on_empty_or_error',
        'artemis_sam_quota_state'
      ]);

    if (!afterRes.error) {
      result.settingsAfterRestore = toSettingsMap(afterRes.data || []);
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exit(1);
})();
