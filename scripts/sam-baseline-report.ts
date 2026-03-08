import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

type IngestionRunRow = {
  id: string | number;
  started_at: string;
  ended_at: string | null;
  success: boolean | null;
  error: string | null;
  stats: unknown | null;
};

type SettingRow = {
  key: string;
  value: unknown;
  updated_at: string | null;
};

type CronJobRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
};

type SamScopeDistribution = {
  artemis: number;
  'blue-origin': number;
  spacex: number;
  other: number;
};

const DEFAULT_SINCE_HOURS = 24 * 14;
const DEFAULT_LIMIT = 600;

const RELEVANT_SETTING_KEYS = [
  'artemis_contracts_job_enabled',
  'artemis_procurement_job_enabled',
  'artemis_sam_daily_quota_limit',
  'artemis_sam_daily_quota_reserve',
  'artemis_sam_max_requests_per_run',
  'artemis_sam_quota_state',
  'artemis_sam_probe_both_endpoints_first',
  'artemis_sam_single_pass_per_endpoint',
  'artemis_sam_stop_on_empty_or_error',
  'artemis_sam_request_allocation_enabled',
  'artemis_sam_probe_max_budget_share',
  'artemis_sam_probe_min_post_budget',
  'artemis_sam_opportunities_partition_enabled',
  'artemis_sam_opportunities_partition_days',
  'artemis_sam_opportunities_data_services_enabled',
  'artemis_sam_opportunities_api_delta_only',
  'artemis_sam_opportunities_data_services_max_files_per_source_per_run',
  'artemis_sam_opportunities_data_services_max_file_bytes',
  'artemis_sam_opportunities_data_services_active_url',
  'artemis_sam_opportunities_data_services_archived_url',
  'artemis_sam_opportunities_api_weight_when_data_services',
  'artemis_sam_entity_sync_enabled',
  'artemis_procurement_poll_interval_minutes'
] as const;

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    sinceHours: { type: 'string', default: String(DEFAULT_SINCE_HOURS) },
    limit: { type: 'string', default: String(DEFAULT_LIMIT) },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

const usage = `Usage:
  ts-node --project tsconfig.scripts.json --transpile-only scripts/sam-baseline-report.ts [options]

Options:
  --sinceHours N    Lookback window in hours (default: ${DEFAULT_SINCE_HOURS})
  --limit N         Max ingestion_runs rows to scan (default: ${DEFAULT_LIMIT})
  --json            Print JSON output

Notes:
  - Read-only diagnostic script (no writes).
  - Pulls SAM-related run metrics, current system settings, and cron schedules.
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

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item).trim())
    .filter((item) => item.length > 0);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function summarizeScopeDistribution(raw: unknown): SamScopeDistribution {
  const record = asRecord(raw);
  return {
    artemis: asNumber(record.artemis),
    'blue-origin': asNumber(record['blue-origin']),
    spacex: asNumber(record.spacex),
    other: asNumber(record.other)
  };
}

function mergeScopeDistribution(base: SamScopeDistribution, add: SamScopeDistribution): SamScopeDistribution {
  return {
    artemis: base.artemis + add.artemis,
    'blue-origin': base['blue-origin'] + add['blue-origin'],
    spacex: base.spacex + add.spacex,
    other: base.other + add.other
  };
}

function ratio(numerator: number, denominator: number) {
  if (denominator < 1) return 0;
  return numerator / denominator;
}

async function fetchRuns(
  admin: ReturnType<typeof createClient>,
  sinceIso: string,
  limit: number
) {
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to read ingestion_runs: ${error.message}`);
  return (data || []) as IngestionRunRow[];
}

async function fetchSettings(
  admin: ReturnType<typeof createClient>
): Promise<Map<string, { value: unknown; updatedAt: string | null }>> {
  const { data, error } = await admin
    .from('system_settings')
    .select('key,value,updated_at')
    .in('key', [...RELEVANT_SETTING_KEYS]);
  if (error) throw new Error(`Failed to read system_settings: ${error.message}`);

  const map = new Map<string, { value: unknown; updatedAt: string | null }>();
  for (const row of (data || []) as SettingRow[]) {
    map.set(row.key, { value: row.value, updatedAt: row.updated_at });
  }
  return map;
}

async function fetchCronJobs(admin: ReturnType<typeof createClient>): Promise<CronJobRow[]> {
  const { data, error } = await admin.rpc('get_all_cron_jobs');
  if (error) throw new Error(`Failed to read cron jobs: ${error.message}`);
  return (Array.isArray(data) ? data : []) as CronJobRow[];
}

function stableSortStopReasons(reasonCounts: Map<string, number>) {
  return [...reasonCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
}

function summarizeRuns(rows: IngestionRunRow[]) {
  let successRuns = 0;
  let failedRuns = 0;
  let samRequestsGranted = 0;
  let samRequestsAttempted = 0;
  let samAwardsRequestsGranted = 0;
  let samAwardsRequestsAttempted = 0;
  let samOpportunitiesRequestsGranted = 0;
  let samOpportunitiesRequestsAttempted = 0;
  let samEntityRequestsGranted = 0;
  let samAwardsRowsUpserted = 0;
  let samNoticesUpserted = 0;
  let samDataServicesProjectionRowsUpserted = 0;
  let samThrottleRuns = 0;
  let samBlockedRuns = 0;
  const stopReasonCounts = new Map<string, number>();
  let awardCandidateScopeDistribution: SamScopeDistribution = { artemis: 0, 'blue-origin': 0, spacex: 0, other: 0 };
  let opportunitiesFallbackScopeDistribution: SamScopeDistribution = { artemis: 0, 'blue-origin': 0, spacex: 0, other: 0 };

  for (const row of rows) {
    if (row.success === true) successRuns += 1;
    else if (row.success === false) failedRuns += 1;

    const stats = asRecord(row.stats);
    samRequestsAttempted += asNumber(stats.samRequestsAttempted);
    samRequestsGranted += asNumber(stats.samRequestsGranted);
    samAwardsRequestsAttempted += asNumber(stats.samAwardsRequestsAttempted);
    samAwardsRequestsGranted += asNumber(stats.samAwardsRequestsGranted);
    samOpportunitiesRequestsAttempted += asNumber(stats.samOpportunitiesRequestsAttempted);
    samOpportunitiesRequestsGranted += asNumber(stats.samOpportunitiesRequestsGranted);
    samEntityRequestsGranted += asNumber(stats.samEntityRequestsGranted);
    samAwardsRowsUpserted += asNumber(stats.samAwardsRowsUpserted);
    samNoticesUpserted += asNumber(stats.samNoticesUpserted);
    samDataServicesProjectionRowsUpserted += asNumber(stats.samOpportunitiesDataServicesProjectionRowsUpserted);

    awardCandidateScopeDistribution = mergeScopeDistribution(
      awardCandidateScopeDistribution,
      summarizeScopeDistribution(stats.samAwardCandidateScopeDistribution)
    );
    opportunitiesFallbackScopeDistribution = mergeScopeDistribution(
      opportunitiesFallbackScopeDistribution,
      summarizeScopeDistribution(stats.samOpportunitiesFallbackScopeDistribution)
    );

    const stopReasons = new Set<string>([
      ...asStringArray(stats.samStopReasons),
      asString(stats.samRequestStopReason).trim()
    ].filter((reason) => reason.length > 0));
    for (const reason of stopReasons) {
      stopReasonCounts.set(reason, (stopReasonCounts.get(reason) || 0) + 1);
    }
    if (stopReasons.has('sam_quota_throttled')) samThrottleRuns += 1;
    if (stopReasons.has('sam_quota_blocked')) samBlockedRuns += 1;
  }

  return {
    runs: rows.length,
    successRuns,
    failedRuns,
    samRequestsAttempted,
    samRequestsGranted,
    samAwardsRequestsAttempted,
    samAwardsRequestsGranted,
    samOpportunitiesRequestsAttempted,
    samOpportunitiesRequestsGranted,
    samEntityRequestsGranted,
    samAwardsRowsUpserted,
    samNoticesUpserted,
    samDataServicesProjectionRowsUpserted,
    samAwardsRowsPerGrantedRequest: ratio(samAwardsRowsUpserted, samAwardsRequestsGranted),
    samNoticesRowsPerGrantedRequest: ratio(samNoticesUpserted, samOpportunitiesRequestsGranted),
    throttleRunRate: ratio(samThrottleRuns, rows.length),
    blockedRunRate: ratio(samBlockedRuns, rows.length),
    samThrottleRuns,
    samBlockedRuns,
    stopReasonCounts: stableSortStopReasons(stopReasonCounts),
    awardCandidateScopeDistribution,
    opportunitiesFallbackScopeDistribution
  };
}

function formatSettingValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const sinceHours = Math.max(1, Math.min(24 * 60, Math.trunc(asNumber(values.sinceHours))));
  const limit = Math.max(20, Math.min(2_000, Math.trunc(asNumber(values.limit))));
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const [runs, settingsByKey, cronJobs] = await Promise.all([
    fetchRuns(admin, sinceIso, limit),
    fetchSettings(admin),
    fetchCronJobs(admin)
  ]);
  const summary = summarizeRuns(runs);
  const samCronJobs = cronJobs.filter((row) =>
    row.jobname === 'artemis_contracts_ingest' || row.jobname === 'artemis_procurement_ingest'
  );

  const output = {
    generatedAt: new Date().toISOString(),
    window: {
      sinceHours,
      sinceIso,
      runLimit: limit,
      runsScanned: runs.length
    },
    summary,
    settings: [...settingsByKey.entries()].map(([key, value]) => ({
      key,
      value: value.value,
      updatedAt: value.updatedAt
    })),
    cronJobs: samCronJobs
  };

  if (values.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Generated: ${output.generatedAt}`);
  console.log(`Window: ${sinceIso} (last ${sinceHours}h, scanned ${runs.length} runs)`);
  console.log('');
  console.log('Run summary');
  console.log(`- runs: ${summary.runs} (success ${summary.successRuns}, failed ${summary.failedRuns})`);
  console.log(`- SAM requests: granted ${formatNumber(summary.samRequestsGranted)} / attempted ${formatNumber(summary.samRequestsAttempted)}`);
  console.log(`- Contract-awards: granted ${formatNumber(summary.samAwardsRequestsGranted)} / attempted ${formatNumber(summary.samAwardsRequestsAttempted)}`);
  console.log(`- Opportunities: granted ${formatNumber(summary.samOpportunitiesRequestsGranted)} / attempted ${formatNumber(summary.samOpportunitiesRequestsAttempted)}`);
  console.log(`- Entity sync requests granted: ${formatNumber(summary.samEntityRequestsGranted)}`);
  console.log(`- Contract-awards rows upserted: ${formatNumber(summary.samAwardsRowsUpserted)} (${formatNumber(summary.samAwardsRowsPerGrantedRequest)} rows/request)`);
  console.log(`- Opportunity rows upserted: ${formatNumber(summary.samNoticesUpserted)} (${formatNumber(summary.samNoticesRowsPerGrantedRequest)} rows/request)`);
  console.log(`- Data-services projection upserts: ${formatNumber(summary.samDataServicesProjectionRowsUpserted)}`);
  console.log(`- Throttle run rate: ${formatPercent(summary.throttleRunRate * 100)} (${summary.samThrottleRuns}/${summary.runs})`);
  console.log(`- Quota-blocked run rate: ${formatPercent(summary.blockedRunRate * 100)} (${summary.samBlockedRuns}/${summary.runs})`);
  console.log('');
  console.log('Top stop reasons');
  if (summary.stopReasonCounts.length < 1) {
    console.log('- none');
  } else {
    for (const [reason, count] of summary.stopReasonCounts.slice(0, 10)) {
      console.log(`- ${reason}: ${count}`);
    }
  }
  console.log('');
  console.log('Scope distributions');
  console.log(`- award candidates: ${JSON.stringify(summary.awardCandidateScopeDistribution)}`);
  console.log(`- opportunities fallback: ${JSON.stringify(summary.opportunitiesFallbackScopeDistribution)}`);
  console.log('');
  console.log('SAM settings snapshot');
  for (const key of RELEVANT_SETTING_KEYS) {
    const setting = settingsByKey.get(key);
    const value = setting ? formatSettingValue(setting.value) : '(missing)';
    console.log(`- ${key}: ${value}`);
  }
  console.log('');
  console.log('Cron jobs');
  if (samCronJobs.length < 1) {
    console.log('- none');
  } else {
    for (const job of samCronJobs) {
      console.log(`- ${job.jobname}: schedule="${job.schedule}" active=${job.active}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sam-baseline-report: ${message}`);
  process.exit(1);
});
