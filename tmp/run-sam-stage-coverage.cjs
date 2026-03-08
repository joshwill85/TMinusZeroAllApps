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

function number(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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

async function fetchRunById(runId) {
  if (runId === null || runId === undefined) return null;
  const q = await admin
    .from('ingestion_runs')
    .select('id,job_name,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .eq('id', String(runId))
    .maybeSingle();
  if (q.error) throw new Error('fetchRunById failed: ' + q.error.message);
  return q.data || null;
}

async function fetchLatestRunSince(startedAfterIso) {
  const q = await admin
    .from('ingestion_runs')
    .select('id,job_name,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .gte('started_at', startedAfterIso)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (q.error) throw new Error('fetchLatestRunSince failed: ' + q.error.message);
  return q.data || null;
}

async function waitForRun(options) {
  const started = Date.now();
  let lastSeen = null;

  while (Date.now() - started < options.timeoutMs) {
    let run = null;
    if (options.runId != null) {
      run = await fetchRunById(options.runId);
    }
    if (!run) {
      run = await fetchLatestRunSince(options.startedAfterIso);
    }

    if (run) {
      if (run.ended_at) return { run, timedOut: false };
      lastSeen = run;
    }

    await sleep(2500);
  }

  return { run: lastSeen, timedOut: true };
}

async function forceFinalizeRun(runId, reason) {
  if (!runId) return false;
  const patch = {
    ended_at: nowIso(),
    success: false,
    error: reason,
    stats: { forcedFinalize: true, reason, at: nowIso() }
  };
  const res = await admin
    .from('ingestion_runs')
    .update(patch)
    .eq('id', String(runId))
    .is('ended_at', null);
  if (res.error) {
    return false;
  }
  return true;
}

async function fetchRunSourceDocs(run, samSessionToken) {
  if (!run || !run.started_at || !run.ended_at) {
    return [];
  }

  const upperBound = new Date(new Date(run.ended_at).getTime() + 60_000).toISOString();

  let q = admin
    .from('artemis_source_documents')
    .select('id,source_key,fetched_at,http_status,error,raw,url')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .gte('fetched_at', run.started_at)
    .lte('fetched_at', upperBound)
    .order('fetched_at', { ascending: true });

  if (samSessionToken) {
    q = q.filter('raw->>samSessionToken', 'eq', samSessionToken);
  }

  const res = await q;
  if (!res.error) return res.data || [];

  const fallback = await admin
    .from('artemis_source_documents')
    .select('id,source_key,fetched_at,http_status,error,raw,url')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .gte('fetched_at', run.started_at)
    .lte('fetched_at', upperBound)
    .order('fetched_at', { ascending: true });

  if (fallback.error) {
    throw new Error('fetchRunSourceDocs failed: ' + fallback.error.message);
  }
  return fallback.data || [];
}

function summarizeDocs(rows) {
  const out = {
    total: rows.length,
    sam_contract_awards: 0,
    sam_opportunities: 0,
    statuses: {},
    requests: []
  };

  for (const row of rows) {
    const key = str(row.source_key);
    if (key === 'sam_contract_awards') out.sam_contract_awards += 1;
    if (key === 'sam_opportunities') out.sam_opportunities += 1;

    const status = String(row.http_status ?? 'null');
    out.statuses[status] = (out.statuses[status] || 0) + 1;

    const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
    out.requests.push({
      source_key: key,
      fetched_at: row.fetched_at,
      http_status: row.http_status,
      error: row.error,
      piid: raw.piid || null,
      solicitationId: raw.solicitationId || null,
      rowCount: raw.rowCount || null,
      noticeCount: raw.noticeCount || null,
      probeRequest: raw.probeRequest || false,
      request_url: row.url || null
    });
  }

  return out;
}

function summarizeRun(run, invokeErrorMessage, stage, attempt, samSessionToken) {
  const stats = run && run.stats && typeof run.stats === 'object' ? run.stats : {};
  return {
    stage,
    attempt,
    runId: run ? run.id : null,
    started_at: run ? run.started_at : null,
    ended_at: run ? run.ended_at : null,
    success: run ? run.success : null,
    error: run ? run.error : null,
    invokeErrorMessage: invokeErrorMessage || null,
    samSessionToken,
    samRequestsAttempted: number(stats.samRequestsAttempted),
    samRequestsGranted: number(stats.samRequestsGranted),
    samAwardsRequestsAttempted: number(stats.samAwardsRequestsAttempted),
    samAwardsRequestsGranted: number(stats.samAwardsRequestsGranted),
    samOpportunitiesRequestsAttempted: number(stats.samOpportunitiesRequestsAttempted),
    samOpportunitiesRequestsGranted: number(stats.samOpportunitiesRequestsGranted),
    samAwardsRowsUpserted: number(stats.samAwardsRowsUpserted),
    samNoticesUpserted: number(stats.samNoticesUpserted),
    samAwardsSolicitationIdsBackfilled: number(stats.samAwardsSolicitationIdsBackfilled),
    samAwardsContractsBackfilled: number(stats.samAwardsContractsBackfilled),
    solicitationIdsEvaluated: number(stats.solicitationIdsEvaluated),
    samRequestStopReason: stats.samRequestStopReason || null,
    samGuardrailReason: stats.samGuardrailReason || null,
    samRunStopReason: stats.samRunStopReason || null,
    samStopReasons: Array.isArray(stats.samStopReasons) ? stats.samStopReasons : [],
    samQuota: stats.samQuota && typeof stats.samQuota === 'object' ? stats.samQuota : null,
    samAwardCandidateScopeDistribution:
      stats.samAwardCandidateScopeDistribution && typeof stats.samAwardCandidateScopeDistribution === 'object'
        ? stats.samAwardCandidateScopeDistribution
        : null,
    samOpportunitiesFallbackScopeDistribution:
      stats.samOpportunitiesFallbackScopeDistribution && typeof stats.samOpportunitiesFallbackScopeDistribution === 'object'
        ? stats.samOpportunitiesFallbackScopeDistribution
        : null
  };
}

async function collectMetrics() {
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

  return {
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
}

function metricDelta(before, after) {
  const result = {
    totals: {},
    missingSolicitationDeltaByScope: {},
    hasSolicitationNoNoticeDeltaByScope: {},
    samAwardRowsDeltaByScope: {}
  };

  const scopes = ['artemis', 'blue-origin', 'spacex', 'other', 'unknown'];

  const totalKeys = ['contracts', 'actions', 'samAwardRows'];
  for (const key of totalKeys) {
    const b = number(before?.totals?.[key]);
    const a = number(after?.totals?.[key]);
    result.totals[key] = a - b;
  }

  for (const scope of scopes) {
    const beforeAction = before?.actionCountsByScope?.[scope] || {};
    const afterAction = after?.actionCountsByScope?.[scope] || {};
    result.missingSolicitationDeltaByScope[scope] =
      number(afterAction.missingSolicitation) - number(beforeAction.missingSolicitation);
    result.hasSolicitationNoNoticeDeltaByScope[scope] =
      number(afterAction.hasSolicitationNoNotice) - number(beforeAction.hasSolicitationNoNotice);

    const beforeAward = number(before?.samAwardRowsByScope?.[scope]);
    const afterAward = number(after?.samAwardRowsByScope?.[scope]);
    result.samAwardRowsDeltaByScope[scope] = afterAward - beforeAward;
  }

  return result;
}

async function runStage(options) {
  const out = {
    stage: options.stage,
    config: {
      maxAttempts: options.maxAttempts,
      maxNoProgress: options.maxNoProgress,
      samMaxRequestsPerRun: options.samMaxRequestsPerRun,
      timeoutMs: options.timeoutMs
    },
    attempts: []
  };

  let noProgressRuns = 0;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const samSessionToken = `${options.stage}-${Date.now()}-${attempt}`;
    const invokeBody = {
      mode: 'incremental',
      stage: options.stage,
      samSessionToken,
      samMaxRequestsPerRun: options.samMaxRequestsPerRun,
      samSinglePassPerEndpoint: false,
      samStopOnEmptyOrError: false
    };

    const startedAfterIso = nowIso();
    const invokeRes = await admin.functions.invoke('artemis-contracts-ingest', {
      method: 'POST',
      headers: { 'x-job-token': options.jobToken },
      body: invokeBody
    });

    const invokeData = invokeRes.data && typeof invokeRes.data === 'object' ? invokeRes.data : {};
    const runId = Object.prototype.hasOwnProperty.call(invokeData, 'runId') ? invokeData.runId : null;
    const invokeErrorMessage = invokeRes.error ? str(invokeRes.error.message || '') : null;

    const waited = await waitForRun({ runId, startedAfterIso, timeoutMs: options.timeoutMs });
    let run = waited.run;
    let forcedFinalize = false;
    if (waited.timedOut && run && !run.ended_at) {
      forcedFinalize = await forceFinalizeRun(run.id, 'manual_timeout_reconciled');
      run = await fetchRunById(run.id);
    }

    const summary = summarizeRun(run, invokeErrorMessage, options.stage, attempt, samSessionToken);
    summary.invokeRunId = runId;
    summary.waitTimedOut = waited.timedOut;
    summary.forcedFinalize = forcedFinalize;

    let docs = [];
    if (run && run.started_at && run.ended_at) {
      docs = await fetchRunSourceDocs(run, samSessionToken);
    }
    summary.sourceDocs = summarizeDocs(docs);

    out.attempts.push(summary);

    const progressed = options.stage === 'sam-contract-awards'
      ? summary.samAwardsRowsUpserted > 0 || summary.samAwardsSolicitationIdsBackfilled > 0 || summary.samAwardsContractsBackfilled > 0
      : options.stage === 'opportunities'
        ? summary.samNoticesUpserted > 0
        : summary.samAwardsRowsUpserted > 0 ||
          summary.samAwardsSolicitationIdsBackfilled > 0 ||
          summary.samAwardsContractsBackfilled > 0 ||
          summary.samNoticesUpserted > 0;

    if (progressed) noProgressRuns = 0;
    else noProgressRuns += 1;

    const remaining = summary.samQuota && typeof summary.samQuota === 'object'
      ? number(summary.samQuota.remaining)
      : null;

    const stopReason = str(summary.samRequestStopReason);
    const shouldStopForReason = stopReason === 'sam_quota_throttled' || stopReason === 'sam_quota_blocked';
    if (shouldStopForReason) break;

    if (remaining !== null && remaining <= 0) break;
    if (summary.waitTimedOut) break;
    if (noProgressRuns >= options.maxNoProgress) break;
  }

  return out;
}

(async () => {
  const result = {
    startedAtUtc: nowIso(),
    settingsBefore: null,
    settingsAfterPrep: null,
    baselineMetrics: null,
    stageRuns: [],
    finalMetrics: null,
    metricDelta: null,
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
  let restoreProbeBothEndpointsFirst = true;

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
    if (Object.prototype.hasOwnProperty.call(settings, 'artemis_sam_probe_both_endpoints_first')) {
      restoreProbeBothEndpointsFirst = settings.artemis_sam_probe_both_endpoints_first;
    }

    const token = pickJobToken(settings.jobs_auth_token);
    if (!token) throw new Error('jobs_auth_token is missing/empty');

    result.baselineMetrics = await collectMetrics();

    const prep = await admin
      .from('system_settings')
      .upsert(
        [
          { key: 'artemis_contracts_job_enabled', value: true },
          { key: 'artemis_sam_disable_job_on_guardrail', value: false },
          { key: 'artemis_sam_stop_on_empty_or_error', value: false },
          { key: 'artemis_sam_probe_both_endpoints_first', value: false },
          { key: 'artemis_sam_single_pass_per_endpoint', value: false }
        ],
        { onConflict: 'key' }
      );
    if (prep.error) throw new Error('prep settings update failed: ' + prep.error.message);

    const afterPrep = await admin
      .from('system_settings')
      .select('key,value')
      .in('key', [
        'artemis_contracts_job_enabled',
        'artemis_sam_disable_job_on_guardrail',
        'artemis_sam_stop_on_empty_or_error',
        'artemis_sam_probe_both_endpoints_first',
        'artemis_sam_single_pass_per_endpoint',
        'artemis_sam_quota_state'
      ]);
    if (!afterPrep.error) result.settingsAfterPrep = toSettingsMap(afterPrep.data || []);

    if (result.settingsBefore && Object.prototype.hasOwnProperty.call(result.settingsBefore, 'artemis_sam_quota_state')) {
      const quota = result.settingsBefore.artemis_sam_quota_state;
      if (quota && typeof quota === 'object' && String(quota.date || '') === nowIso().slice(0, 10)) {
        const used = number(quota.used);
        const limit = number(quota.limit);
        if (limit > 0 && used >= limit) {
          throw new Error('sam quota exhausted before run');
        }
      }
    }

    const stageRuns = [];

    stageRuns.push(await runStage({
      stage: 'all',
      maxAttempts: 8,
      maxNoProgress: 2,
      samMaxRequestsPerRun: 6,
      timeoutMs: 180000,
      jobToken: token
    }));

    result.stageRuns = stageRuns;

    result.finalMetrics = await collectMetrics();
    result.metricDelta = metricDelta(result.baselineMetrics, result.finalMetrics);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    const restore = await admin
      .from('system_settings')
      .upsert(
        [
          { key: 'artemis_contracts_job_enabled', value: restoreEnabled },
          { key: 'artemis_sam_disable_job_on_guardrail', value: restoreDisableGuardrail },
          { key: 'artemis_sam_stop_on_empty_or_error', value: restoreStopOnEmpty },
          { key: 'artemis_sam_probe_both_endpoints_first', value: restoreProbeBothEndpointsFirst }
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
        'artemis_sam_probe_both_endpoints_first',
        'artemis_sam_quota_state'
      ]);

    if (!afterRes.error) {
      result.settingsAfterRestore = toSettingsMap(afterRes.data || []);
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exit(1);
})();
