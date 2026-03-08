import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

type IngestMode = 'incremental' | 'bootstrap';
type IngestStage = 'all' | 'sam-contract-awards' | 'opportunities';

type IngestionRunRow = {
  id: string | number;
  started_at: string | null;
  ended_at: string | null;
  success: boolean | null;
  error: string | null;
  stats: Record<string, unknown> | null;
};

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    stage: { type: 'string', default: 'all' },
    mode: { type: 'string', default: 'incremental' },
    runs: { type: 'string', default: '1' },
    samMaxRequestsPerRun: { type: 'string' },
    singlePassPerEndpoint: { type: 'string' },
    stopOnEmptyOrError: { type: 'string' },
    continueOnData: { type: 'boolean', default: false },
    keepEnabledOnStop: { type: 'boolean', default: false },
    dryRun: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  ts-node --project tsconfig.scripts.json --transpile-only scripts/artemis-sam-manual-session.ts [options]

Options:
  --stage all|sam-contract-awards|opportunities   (default: all)
  --mode incremental|bootstrap                    (default: incremental)
  --runs N                                        (default: 1)
  --samMaxRequestsPerRun N                       override SAM per-run request cap for this session
  --singlePassPerEndpoint=<true|false>            run SAM endpoints once each (if true) instead of using all remaining quota [default: true]
  --stopOnEmptyOrError=<true|false>              stop run on empty/no-candidate conditions [default: true]
  --continueOnData                                continue while runs show new data
  --keepEnabledOnStop                             do not auto-disable job when stop condition is hit
  --dryRun                                        do not invoke function; audit readiness only

Behavior:
  - Forces SAM guardrail settings on.
  - Enables job before manual run.
  - After each run, captures run + checkpoints + SAM source docs.
  - Stops and disables job on fail/error/no-new-data unless --keepEnabledOnStop is set.
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseBooleanInput(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeSamBodyErrorField(body: unknown, ...keys: string[]): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function readMode(value: string): IngestMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'bootstrap') return 'bootstrap';
  return 'incremental';
}

function readStage(value: string): IngestStage {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'opportunities') return 'opportunities';
  if (normalized === 'sam-contract-awards' || normalized === 'sam_contract_awards' || normalized === 'contract-awards') {
    return 'sam-contract-awards';
  }
  return 'all';
}

function readMaxRuns(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, Math.trunc(parsed)));
}

function readOptionalMaxRequests(value: unknown, fallback: number) {
  if (typeof value !== 'string' || !value.trim().length) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10, Math.trunc(parsed)));
}

async function readJobToken(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from('system_settings').select('value').eq('key', 'jobs_auth_token').maybeSingle();
  if (error) throw new Error(`Failed to read jobs_auth_token (${error.message})`);
  const token = asString((data as { value?: unknown } | null)?.value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (!token) throw new Error('jobs_auth_token is empty');
  return token;
}

async function fetchLatestRun(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to read ingestion_runs (${error.message})`);
  return ((data || [])[0] || null) as IngestionRunRow | null;
}

async function fetchLatestRunSince(admin: ReturnType<typeof createClient>, startedAfterUtc: string) {
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .gte('started_at', startedAfterUtc)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to read ingestion_runs since ${startedAfterUtc} (${error.message})`);
  return ((data || [])[0] || null) as IngestionRunRow | null;
}

async function fetchRunById(admin: ReturnType<typeof createClient>, runId: string | number | null | undefined) {
  if (runId === null || runId === undefined) return null;
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .eq('id', String(runId))
    .single();
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to read ingestion run (${error.message})`);
  }
  return (data as IngestionRunRow | null) || null;
}

async function fetchRunArtifacts(admin: ReturnType<typeof createClient>, run: IngestionRunRow) {
  if (!run.started_at || !run.ended_at) {
    return { checkpoints: [], sourceDocs: [] };
  }

  const runSamSessionToken = asString((run.stats as Record<string, unknown> | null)?.samSessionToken);
  const checkpointUpperBound = new Date(new Date(run.ended_at).getTime() + 60_000).toISOString();
  const sourceDocQuery = admin
    .from('artemis_source_documents')
    .select('id,source_key,fetched_at,http_status,error,url,title,summary,raw')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .gte('fetched_at', run.started_at)
    .lte('fetched_at', checkpointUpperBound)
    .order('fetched_at', { ascending: true });

  if (runSamSessionToken) {
    sourceDocQuery.filter('raw->>samSessionToken', 'eq', runSamSessionToken);
  }

  const checkpointQuery = admin
    .from('artemis_ingest_checkpoints')
    .select('source_key,status,records_ingested,last_error,updated_at,metadata')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .gte('updated_at', run.started_at)
    .lte('updated_at', checkpointUpperBound)
    .order('source_key', { ascending: true });

  if (runSamSessionToken) {
    checkpointQuery.filter('metadata->>samSessionToken', 'eq', runSamSessionToken);
  }

  const [{ data: checkpoints, error: checkpointsError }, { data: sourceDocs, error: sourceDocsError }] = await Promise.all([
    checkpointQuery,
    sourceDocQuery
  ]);

  if (checkpointsError) throw new Error(`Failed to read checkpoints (${checkpointsError.message})`);
  if (sourceDocsError) throw new Error(`Failed to read source docs (${sourceDocsError.message})`);
  let resolvedCheckpoints = checkpoints || [];
  let resolvedSourceDocs = sourceDocs || [];

  if (!resolvedCheckpoints.length && runSamSessionToken) {
    const fallbackCheckpointQuery = admin
      .from('artemis_ingest_checkpoints')
      .select('source_key,status,records_ingested,last_error,updated_at,metadata')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
      .gte('updated_at', run.started_at)
      .lte('updated_at', checkpointUpperBound)
      .order('source_key', { ascending: true });
    const { data: fallbackCheckpoints, error: fallbackCheckpointError } = await fallbackCheckpointQuery;
    if (fallbackCheckpointError) {
      throw new Error(`Failed to read checkpoints (${fallbackCheckpointError.message})`);
    }
    resolvedCheckpoints = fallbackCheckpoints || [];
  }

  if (!resolvedSourceDocs.length && runSamSessionToken) {
    const fallbackSourceDocQuery = admin
      .from('artemis_source_documents')
      .select('id,source_key,fetched_at,http_status,error,url,title,summary,raw')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
      .gte('fetched_at', run.started_at)
      .lte('fetched_at', checkpointUpperBound)
      .order('fetched_at', { ascending: true });
    const { data: fallbackSourceDocs, error: fallbackSourceDocsError } = await fallbackSourceDocQuery;
    if (fallbackSourceDocsError) {
      throw new Error(`Failed to read source docs (${fallbackSourceDocsError.message})`);
    }
    resolvedSourceDocs = fallbackSourceDocs || [];
  }

  const compactDocs = ((resolvedSourceDocs || []) as Array<Record<string, unknown>>).map((row) => {
    const raw = (row.raw && typeof row.raw === 'object' ? row.raw : null) as Record<string, unknown> | null;
    const body = (raw?.body && typeof raw.body === 'object' ? raw.body : null) as Record<string, unknown> | null;
    const errorCode = normalizeSamBodyErrorField(body, 'code', 'errorCode');
    const errorMessage = normalizeSamBodyErrorField(body, 'message', 'errorMessage', 'description');
    return {
      id: row.id,
      source_key: row.source_key,
      fetched_at: row.fetched_at,
      http_status: row.http_status,
      error: row.error,
      url: row.url,
      title: row.title,
      summary: row.summary,
      requestMeta: {
        samSessionToken: raw?.samSessionToken || null,
        solicitationId: raw?.solicitationId || null,
        contractKey: raw?.contractKey || null,
        piid: raw?.piid || null,
        probeRequest: raw?.probeRequest || false,
        noticeCount: raw?.noticeCount || null,
        rowCount: raw?.rowCount || null,
        paging: raw?.paging || null,
        dateWindow: raw?.dateWindow || null
      },
      responseMeta: {
        code: errorCode,
        message: errorMessage,
        description: normalizeSamBodyErrorField(body, 'description'),
        nextAccessTime: body?.nextAccessTime || null
      }
    };
  });

  return { checkpoints: resolvedCheckpoints || [], sourceDocs: compactDocs };
}

function resolveRunIdFromInvoke(invokeResult: { data?: unknown; error?: { message?: unknown } | null }) {
  if (!invokeResult || !invokeResult.data || typeof invokeResult.data !== 'object') return null;
  return asString((invokeResult.data as Record<string, unknown>).runId);
}

function asRunId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

async function waitForRunRecord(
  admin: ReturnType<typeof createClient>,
  options: { runId: string | null; fallbackStartedAfter: string | null }
) {
  const fallbackStartedAfter = options.fallbackStartedAfter;
  let lastSeenRun: IngestionRunRow | null = null;

  for (let attempt = 1; attempt <= 16; attempt += 1) {
    const runById = options.runId ? await fetchRunById(admin, options.runId) : null;
    const run = runById || (fallbackStartedAfter ? await fetchLatestRunSince(admin, fallbackStartedAfter) : null);
    if (run) {
      if (run.ended_at) return run;
      lastSeenRun = run;
    }
    await delay(750);
  }

  if (lastSeenRun) return lastSeenRun;
  return null;
}

function summarizeCheckpointBySource(
  checkpoints: Array<Record<string, unknown>>,
  sourceKey: 'sam_contract_awards' | 'sam_opportunities'
) {
  const matched = checkpoints.find((row) => (row.source_key as string | null) === sourceKey) as Record<string, unknown> | undefined;
  if (!matched) return null;
  return {
    sourceKey,
    status: matched.status as unknown as string | null,
    recordsIngested: matched.records_ingested as unknown as number | null,
    stopReason: (matched.metadata && typeof matched.metadata === 'object' ? (matched.metadata as Record<string, unknown>).stopReason : null) || null,
    skippedBecause: (matched.metadata && typeof matched.metadata === 'object' ? (matched.metadata as Record<string, unknown>).skippedBecause : null) || null,
    probeBothEndpointsFirst: (matched.metadata && typeof matched.metadata === 'object' ? (matched.metadata as Record<string, unknown>).probeBothEndpointsFirst : null),
    metadata: matched.metadata as Record<string, unknown> | null
  };
}

async function persistManualAudit(
  admin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  attempt: number,
  stage: IngestStage
) {
  const { error } = await admin.from('artemis_source_documents').insert({
    source_key: 'sam_manual_audit',
    source_type: 'procurement',
    url: 'https://api.sam.gov/manual-session',
    title: `SAM manual session audit (attempt ${attempt}, stage ${stage})`,
    summary: 'Manual SAM run audit artifact with run/checkpoint/source-document trace.',
    announced_time: new Date().toISOString(),
    content_type: 'application/json',
    raw: payload,
    parse_version: 'v1',
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`Failed to persist manual audit (${error.message})`);
}

async function main() {
  const stage = readStage(String(values.stage || 'all'));
  const mode = readMode(String(values.mode || 'incremental'));
  const maxRuns = readMaxRuns(String(values.runs || '1'));
  const requestedSamMaxRequestsPerRun = readOptionalMaxRequests(values.samMaxRequestsPerRun as unknown, Number.NaN);
  const shouldOverrideSamMaxRequestsPerRun = Number.isFinite(requestedSamMaxRequestsPerRun);
  const singlePassPerEndpoint = parseBooleanInput(values.singlePassPerEndpoint, true);
  const stopOnEmptyOrError = parseBooleanInput(values.stopOnEmptyOrError, true);
  const continueOnData = Boolean(values.continueOnData);
  const keepEnabledOnStop = Boolean(values.keepEnabledOnStop);
  const dryRun = Boolean(values.dryRun);
  const requiresTwoEndpointCallsForAll = stage === 'all' && singlePassPerEndpoint;
  const effectiveSamMaxRequestsPerRun = shouldOverrideSamMaxRequestsPerRun
    ? requiresTwoEndpointCallsForAll && requestedSamMaxRequestsPerRun > 0 && requestedSamMaxRequestsPerRun < 2
      ? 2
      : requestedSamMaxRequestsPerRun
    : Number.NaN;
  const samMaxRequestsAdjustment =
    shouldOverrideSamMaxRequestsPerRun && effectiveSamMaxRequestsPerRun > requestedSamMaxRequestsPerRun
      ? 'auto-adjusted_for_all_endpoints'
      : null;

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const token = await readJobToken(admin);

  const readinessUpdates = [
    { key: 'artemis_sam_disable_job_on_guardrail', value: true },
    { key: 'artemis_sam_stop_on_empty_or_error', value: stopOnEmptyOrError },
    { key: 'artemis_sam_probe_both_endpoints_first', value: true },
    { key: 'artemis_sam_single_pass_per_endpoint', value: singlePassPerEndpoint }
  ];
  const { error: readinessError } = await admin.from('system_settings').upsert(readinessUpdates, { onConflict: 'key' });
  if (readinessError) throw new Error(`Failed to enforce readiness settings (${readinessError.message})`);

  const report: Record<string, unknown> = {
    startedAtUtc: new Date().toISOString(),
    dryRun,
    stage,
    mode,
    maxRuns,
    requestedSamMaxRequestsPerRun: shouldOverrideSamMaxRequestsPerRun ? requestedSamMaxRequestsPerRun : null,
    effectiveSamMaxRequestsPerRun: shouldOverrideSamMaxRequestsPerRun ? effectiveSamMaxRequestsPerRun : null,
    samMaxRequestsAdjustment,
    singlePassPerEndpoint,
    stopOnEmptyOrError,
    continueOnData,
    keepEnabledOnStop,
    readinessUpdates,
    attempts: [] as Array<Record<string, unknown>>
  };

  if (dryRun) {
    const [latestRun, settingsSnapshot] = await Promise.all([
      fetchLatestRun(admin),
      admin
        .from('system_settings')
        .select('key,value,updated_at')
        .in('key', [
          'artemis_contracts_job_enabled',
          'artemis_contracts_job_disabled_reason',
          'artemis_sam_disable_job_on_guardrail',
          'artemis_sam_stop_on_empty_or_error',
          'artemis_sam_probe_both_endpoints_first',
          'artemis_sam_single_pass_per_endpoint',
          'artemis_sam_max_requests_per_run',
          'artemis_sam_daily_quota_limit',
          'artemis_sam_daily_quota_reserve',
          'artemis_sam_quota_state'
        ])
        .order('key', { ascending: true })
    ]);
    if (settingsSnapshot.error) throw new Error(`Failed to read settings snapshot (${settingsSnapshot.error.message})`);
    report.latestRun = latestRun;
    report.settingsSnapshot = settingsSnapshot.data || [];
    report.finishedAtUtc = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { error: enableError } = await admin
    .from('system_settings')
    .upsert([{ key: 'artemis_contracts_job_enabled', value: true }], { onConflict: 'key' });
  if (enableError) throw new Error(`Failed to enable artemis_contracts_job (${enableError.message})`);

  for (let attempt = 1; attempt <= maxRuns; attempt += 1) {
    const startedAt = new Date().toISOString();
    const invokeBody: Record<string, unknown> = { mode, stage };
    const samSessionToken = `manual-${new Date(startedAt).getTime()}-${attempt}`;
    if (shouldOverrideSamMaxRequestsPerRun) {
      invokeBody.samMaxRequestsPerRun = effectiveSamMaxRequestsPerRun;
    }
    invokeBody.samSinglePassPerEndpoint = singlePassPerEndpoint;
    invokeBody.samSessionToken = samSessionToken;

    const invoke = await admin.functions.invoke('artemis-contracts-ingest', {
      method: 'POST',
      headers: { 'x-job-token': token },
      body: invokeBody
    });

    const runIdFromInvoke = asRunId(resolveRunIdFromInvoke(invoke));
    const run = await waitForRunRecord(admin, {
      runId: runIdFromInvoke,
      fallbackStartedAfter: startedAt
    });
    if (!run) throw new Error('No ingestion run found after invoke');
    const artifacts = await fetchRunArtifacts(admin, run);

    const stats = (run.stats || {}) as Record<string, unknown>;
    const samStepTrace = (stats.samStepTrace as Array<Record<string, unknown>>) || [];
    const samRequestsAttempted = asNumber(stats.samRequestsAttempted);
    const samRequestsGranted = asNumber(stats.samRequestsGranted);
    const samAwardsRowsUpserted = asNumber(stats.samAwardsRowsUpserted);
    const samNoticesUpserted = asNumber(stats.samNoticesUpserted);
    const samAwardsRequestsAttempted = asNumber(stats.samAwardsRequestsAttempted);
    const samOpportunitiesRequestsAttempted = asNumber(stats.samOpportunitiesRequestsAttempted);
    const samAwardsRequestsGranted = asNumber(stats.samAwardsRequestsGranted);
    const samOpportunitiesRequestsGranted = asNumber(stats.samOpportunitiesRequestsGranted);
    const stopReason = asString(stats.samRequestStopReason) || asString(stats.samSkippedReason) || null;
    const guardrailReason = asString(stats.samGuardrailReason);
    const samStopReasons = Array.isArray(stats.samStopReasons) ? stats.samStopReasons : [];
    const endpointSummaries = {
      contractAwards: summarizeCheckpointBySource(artifacts.checkpoints as Array<Record<string, unknown>>, 'sam_contract_awards'),
      opportunities: summarizeCheckpointBySource(artifacts.checkpoints as Array<Record<string, unknown>>, 'sam_opportunities')
    };
    const endpointDecisions = Array.isArray(stats.samEndpointDecisions) ? stats.samEndpointDecisions : [];
    const contractEndpointStopReason = asString(stats.samContractAwardsStopReason);
    const opportunityEndpointStopReason = asString(stats.samOpportunitiesStopReason);
    const endpointStopReason =
      asString(endpointSummaries.contractAwards?.stopReason) ||
      asString(endpointSummaries.opportunities?.stopReason) ||
      null;
    const hasRunFailure = run.success === false || Boolean(run.error);
    const noNewData = samRequestsGranted > 0 && samAwardsRowsUpserted < 1 && samNoticesUpserted < 1;
    const endpointNoNewData = endpointStopReason === 'sam_no_new_data';
    const endpointNoCandidates = asString(endpointSummaries.contractAwards?.stopReason) === 'sam_no_candidates'
      || asString(endpointSummaries.opportunities?.stopReason) === 'sam_no_candidates';
    const noSamActivity = samAwardsRequestsAttempted + samOpportunitiesRequestsAttempted < 1;
    const shouldStop = hasRunFailure || Boolean(stopReason) || endpointStopReason !== null || noNewData || noSamActivity;
    const stopReasonLabel =
      stopReason || guardrailReason || endpointStopReason || (noSamActivity ? 'sam-no-activity' : 'none');

    const decision = {
      shouldStop,
      reason: hasRunFailure
        ? `run_failure:${run.error || 'unknown'}`
        : endpointStopReason || stopReason || (endpointNoNewData || endpointNoCandidates ? 'no_candidate_or_data'
          : noNewData
            ? 'no_new_data'
            : noSamActivity
              ? 'no_sam_activity'
              : continueOnData
                ? 'continue_on_data'
                : 'single_run_complete'),
      stopReasonLabel,
      hasRunFailure,
      stopReason,
      guardrailReason,
      samStopReasons,
      endpointStopReason,
      noNewData,
      noSamActivity,
      endpointNoData: endpointNoNewData || endpointNoCandidates,
      newDataObserved: samAwardsRowsUpserted > 0 || samNoticesUpserted > 0
    };

    const attemptPayload: Record<string, unknown> = {
      attempt,
      invokedAtUtc: startedAt,
      invokeBody,
      invokeResult: {
        errorName: invoke.error?.name || null,
        errorMessage: invoke.error?.message || null,
        ok: (invoke.data as Record<string, unknown> | null)?.ok || false
      },
      run,
      runSelection: {
        requestedRunId: runIdFromInvoke,
        usedFallbackRunSince: runIdFromInvoke ? null : startedAt,
        resolvedRunId: String(run.id)
      },
      samMaxRequestsAdjustment,
      samStepTrace,
      runStats: {
        samRunRequestCapRequested: asNumber(stats.samRunRequestCapRequested),
        samRunRequestCap: asNumber(stats.samRunRequestCap),
        samRunRequestsRemaining: asNumber(stats.samRunRequestsRemaining),
        samRunCapReached: Boolean(stats.samRunCapReached),
        samRunStopReason: asString(stats.samRunStopReason),
        samRunStoppedByEndpoint: asString(stats.samRunStoppedByEndpoint),
        samRunStoppedAt: asString(stats.samRunStoppedAt),
        samRequestStopReason: asString(stats.samRequestStopReason),
        samSkippedReason: asString(stats.samSkippedReason),
        samGuardrailReason: asString(stats.samGuardrailReason),
        samAwardsRequestsAttempted,
        samAwardsRequestsGranted,
        samOpportunitiesRequestsAttempted,
        samOpportunitiesRequestsGranted,
        samContractAwardsStopReason: contractEndpointStopReason || null,
        samOpportunitiesStopReason: opportunityEndpointStopReason || null,
        samEndpointDecisions: endpointDecisions,
        samStopReasons
      },
      checkpoints: artifacts.checkpoints,
      sourceDocs: artifacts.sourceDocs,
      endpointSummaries,
      decision
    };

    (report.attempts as Array<Record<string, unknown>>).push(attemptPayload);
    await persistManualAudit(admin, attemptPayload, attempt, stage);

    if (shouldStop) {
      if (!keepEnabledOnStop) {
        const disabledReason = {
          reason: `manual_session_stop:${decision.reason}`,
          disabledAt: new Date().toISOString(),
          context: {
            attempt,
            runId: run.id,
            stage,
            mode,
            samRequestsAttempted,
            samRequestsGranted,
            samAwardsRowsUpserted,
            samNoticesUpserted
          }
        };
        const { error: disableError } = await admin.from('system_settings').upsert(
          [
            { key: 'artemis_contracts_job_enabled', value: false },
            { key: 'artemis_contracts_job_disabled_reason', value: disabledReason }
          ],
          { onConflict: 'key' }
        );
        if (disableError) throw new Error(`Failed to disable job on stop (${disableError.message})`);
        report.autoDisabledByScript = true;
        report.autoDisabledReason = disabledReason;
      }
      break;
    }

    if (!continueOnData) {
      break;
    }
  }

  report.finishedAtUtc = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
