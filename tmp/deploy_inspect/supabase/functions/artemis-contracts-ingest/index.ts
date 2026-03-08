import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  claimDailyQuota,
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  readDailyQuotaWindow,
  readNumberSetting,
  readSystemSetting,
  readStringSetting,
  startIngestionRun,
  stringifyError,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/artemisIngest.ts';

type MissionKey = 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii' | 'artemis-iv' | 'artemis-v' | 'artemis-vi' | 'artemis-vii';
type ProgramScope = 'artemis' | 'blue-origin' | 'spacex' | 'other';
type ContractType = 'definitive' | 'idv' | 'order' | 'unknown';
type IngestMode = 'incremental' | 'bootstrap';
type IngestStage = 'all' | 'normalize' | 'sam-contract-awards' | 'opportunities' | 'spending' | 'budget-map';

type ProcurementAwardRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | string | null;
  awarded_on: string | null;
  mission_key: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ContractRow = {
  contract_key: string;
  piid: string;
  referenced_idv_piid: string | null;
  parent_award_id: string | null;
  agency_code: string | null;
  subtier_code: string | null;
  mission_key: MissionKey;
  awardee_name: string | null;
  awardee_uei: string | null;
  contract_type: ContractType;
  description: string | null;
  base_award_date: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type ContractActionRow = {
  action_key: string;
  contract_key: string;
  mod_number: string;
  action_date: string | null;
  obligation_delta: number | null;
  solicitation_id: string | null;
  source_record_hash: string;
  source_document_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type ContractRecordRef = {
  id: string;
  contract_key: string;
  piid: string;
  referenced_idv_piid: string | null;
  description: string | null;
  mission_key: MissionKey;
};

type BudgetLineRow = {
  id: string;
  line_item: string | null;
  program: string | null;
  fiscal_year: number | null;
};

type OpportunityNoticeRow = {
  notice_id: string;
  solicitation_id: string | null;
  ptype: string | null;
  title: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  latest_active_version: boolean;
  awardee_name: string | null;
  award_amount: number | null;
  notice_url: string | null;
  attachment_count: number | null;
  source_document_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type SamPagingMeta = {
  totalRecords: number | null;
  limit: number | null;
  offset: number | null;
  truncated: boolean;
};

type SamOpportunityResponse = {
  ok: boolean;
  status: number;
  url: string;
  notices: OpportunityNoticeRow[];
  paging: SamPagingMeta;
  dateWindow?: {
    requestedLookbackDays: number;
    appliedLookbackDays: number;
    postedFrom: string;
    postedTo: string;
    clampReason: string | null;
  };
  body: unknown;
};

type ContractAwardsLookupCandidate = {
  contractId: string;
  contractKey: string;
  piid: string;
  referencedIdvPiid: string | null;
  missionKey: MissionKey;
  awardeeName: string | null;
  description: string | null;
  programScope: ProgramScope;
  scopePriority: number;
  missingActionCount: number;
};

type SamScopeDistribution = Record<ProgramScope, number>;

type SolicitationLookupCandidate = {
  solicitationId: string;
  programScope: ProgramScope;
};

type SamContractAwardRow = {
  solicitationId: string | null;
  piid: string | null;
  referencedIdvPiid: string | null;
  metadata: Record<string, unknown>;
};

type SamContractAwardsResponse = {
  ok: boolean;
  status: number;
  url: string;
  method: 'GET' | 'POST';
  awards: SamContractAwardRow[];
  paging: SamPagingMeta;
  body: unknown;
};

type SamOpportunityNoticeUpsertResult = {
  fetched: number;
  inserted: number;
  duplicates: number;
};

type SamOpportunityNoticeVersionUpsertResult = {
  fetched: number;
  inserted: number;
  duplicates: number;
};

type SamContractAwardRowUpsertResult = {
  fetched: number;
  inserted: number;
  duplicates: number;
};

type SamOpportunitiesSyncResult = {
  solicitationIdsEvaluated: number;
  noticesFetched: number;
  samRequestsAttempted: number;
  samRequestsGranted: number;
  noticesUpserted: number;
  noticesExisting: number;
  versionRowsFetched: number;
  versionRowsUpserted: number;
  versionRowsExisting: number;
  projectionRowsUpserted: number;
  projectionRowsExisting: number;
  sourceDocumentsInserted: number;
  truncatedResponses: number;
  samQuota: Record<string, unknown> | null;
  samQuotaBlocked: boolean;
  samRunCapReached: boolean;
  stopReason: string | null;
  lookupSource: 'targeted' | 'mixed' | 'catalog' | 'probe' | 'partition' | 'none';
  fallbackScopeDistribution: SamScopeDistribution;
  fingerprintSkips: number;
  partitionRequestsEvaluated: number;
};

type SamOpportunitiesDataServicesSource = 'active' | 'archived';

type SamOpportunitiesDataServicesSyncResult = {
  enabled: boolean;
  skipped: boolean;
  skippedReason: string | null;
  maxFilesPerSourcePerRun: number;
  maxFileBytes: number;
  sourcesEvaluated: number;
  sourcesSucceeded: number;
  sourcesErrored: number;
  noticesFetched: number;
  versionsFetched: number;
  versionsUpserted: number;
  versionsExisting: number;
  projectionRowsUpserted: number;
  projectionRowsExisting: number;
  sourceDocumentsInserted: number;
  manifestEntriesDiscovered: number;
  manifestEntriesScanned: number;
  manifestFilesDownloaded: number;
  manifestFilesSkippedLarge: number;
  manifestFilesDeferred: number;
  errors: string[];
};

type SamOpportunitiesDataServicesManifestEntry = {
  displayKey: string | null;
  href: string | null;
  fileFormat: string | null;
  dateModified: string | null;
  bucketName: string | null;
  key: string | null;
};

type SamOpportunitiesDataServicesManifestCursor = {
  manifestHash: string;
  nextIndex: number;
  totalEntries: number;
  updatedAt: string;
};

type SamContractAwardsBackfillResult = {
  contractsEvaluated: number;
  awardRowsFetched: number;
  contractsBackfilled: number;
  actionsBackfilled: number;
  awardRowsUpserted: number;
  awardRowsExisting: number;
  ambiguousContracts: number;
  targetedSolicitationIds: string[];
  samRequestsAttempted: number;
  samRequestsGranted: number;
  sourceDocumentsInserted: number;
  truncatedResponses: number;
  samQuota: Record<string, unknown> | null;
  samQuotaBlocked: boolean;
  samRunCapReached: boolean;
  stopReason: string | null;
  candidateScopeDistribution: SamScopeDistribution;
  fingerprintSkips: number;
  extractEnabled: boolean;
  extractFormat: SamExtractFormat;
  extractPollLimit: number;
  extractJobsRequested: number;
  extractJobsSkipped: number;
  extractJobsPolled: number;
  extractJobsReady: number;
  extractJobsApplied: number;
  extractJobsFailed: number;
  extractRowsFetched: number;
  extractRowsUpserted: number;
  extractRowsExisting: number;
};

type SamQueryPolicy = {
  emptyCooldownDays: number;
  duplicateCooldownHours: number;
  retryBackoffBaseMinutes: number;
};

type SamQueryExecutionGate = {
  allowed: boolean;
  reason: 'sam_query_cooldown' | 'sam_query_retry_backoff' | null;
  cooldownUntil: string | null;
  nextRetryAt: string | null;
  existingFailures: number;
  fingerprint: string;
  normalizedParams: Record<string, unknown>;
};

type SamOpportunityPartitionSeed = {
  partitionKey: string;
  endpoint: 'opportunities';
  programScope: ProgramScope;
  keyword: string;
  organizationName: string | null;
  postedFrom: string;
  postedTo: string;
  status: 'active';
  currentOffset: number;
  metadata: Record<string, unknown>;
};

type SamEntityAliasSeed = {
  scope: Extract<ProgramScope, 'blue-origin' | 'spacex'>;
  legalBusinessName: string;
};

type SamEntitySyncResult = {
  enabled: boolean;
  skipped: boolean;
  skippedReason: string | null;
  aliasesEvaluated: number;
  aliasesSucceeded: number;
  aliasesErrored: number;
  requestsAttempted: number;
  requestsGranted: number;
  entitiesExtracted: number;
  entitiesUpserted: number;
  sourceDocumentsInserted: number;
  lastStatus: number | null;
  samQuota: Record<string, unknown> | null;
  quotaBlocked: boolean;
  stopReason: string | null;
  errors: string[];
};

type SamExtractFormat = 'json' | 'csv';

type SamExtractJobStatus = 'requested' | 'pending' | 'processing' | 'ready' | 'applied' | 'failed';

type SamAwardExtractJobRow = {
  id: string;
  job_key: string;
  contract_id: string;
  contract_key: string;
  mission_key: string | null;
  program_scope: string | null;
  piid: string;
  referenced_idv_piid: string | null;
  extract_format: SamExtractFormat;
  request_url: string;
  status: SamExtractJobStatus;
  token: string | null;
  job_status_url: string | null;
  download_url: string | null;
  response_status: number | null;
  row_count: number | null;
  source_document_id: string | null;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  updated_at: string | null;
};

type SamAwardsExtractProcessingResult = {
  jobsRequested: number;
  jobsSkipped: number;
  jobsPolled: number;
  jobsReady: number;
  jobsApplied: number;
  jobsFailed: number;
  rowsFetched: number;
  rowsUpserted: number;
  rowsExisting: number;
  contractsBackfilled: number;
  actionsBackfilled: number;
  ambiguousContracts: number;
  targetedSolicitationIds: string[];
  samRequestsAttempted: number;
  samRequestsGranted: number;
  sourceDocumentsInserted: number;
  samQuota: Record<string, unknown> | null;
  samQuotaBlocked: boolean;
  samRunCapReached: boolean;
  stopReason: string | null;
};

type SamOpportunityPartitionRow = {
  partition_key: string;
  endpoint: 'opportunities';
  program_scope: ProgramScope | null;
  keyword: string | null;
  organization_name: string | null;
  posted_from: string | null;
  posted_to: string | null;
  current_offset: number | null;
  status: string | null;
  next_retry_at: string | null;
  last_scanned_at: string | null;
  metadata: Record<string, unknown> | null;
};

type SamOpportunityQueryTask = {
  mode: 'solicitation' | 'partition';
  solicitationId: string | null;
  partitionKey: string | null;
  programScope: ProgramScope | null;
  keyword: string | null;
  organizationName: string | null;
  dateWindow: {
    requestedLookbackDays: number;
    appliedLookbackDays: number;
    postedFrom: Date;
    postedToUtc: Date;
    clampReason: string | null;
  };
  offset: number;
};

type ExistingSamAwardSolicitationBackfillResult = {
  contractsEvaluated: number;
  awardRowsReferenced: number;
  contractsBackfilled: number;
  actionsBackfilled: number;
  ambiguousContracts: number;
  targetedSolicitationIds: string[];
  backfilledContractIds: string[];
};

const RUN_NAME = 'artemis_contracts_ingest';
const CHECKPOINT_NORMALIZED = 'artemis_contracts_normalized';
const CHECKPOINT_SAM_CONTRACT_AWARDS = 'sam_contract_awards';
const CHECKPOINT_OPPORTUNITIES = 'sam_opportunities';
const CHECKPOINT_OPPORTUNITIES_DATA_SERVICES = 'sam_opportunities_data_services';
const CHECKPOINT_SAM_ENTITIES = 'sam_entities';
const CHECKPOINT_SPENDING = 'usaspending_contract_spending';
const SETTING_CONTRACTS_JOB_ENABLED = 'artemis_contracts_job_enabled';
const SETTING_CONTRACTS_JOB_DISABLED_REASON = 'artemis_contracts_job_disabled_reason';
const SETTING_SAM_DISABLE_ON_GUARDRAIL = 'artemis_sam_disable_job_on_guardrail';
const SETTING_SAM_STOP_ON_EMPTY_OR_ERROR = 'artemis_sam_stop_on_empty_or_error';
const SETTING_SAM_PROBE_BOTH_ENDPOINTS_FIRST = 'artemis_sam_probe_both_endpoints_first';
const SETTING_SAM_SINGLE_PASS_PER_ENDPOINT = 'artemis_sam_single_pass_per_endpoint';
const SETTING_SAM_QUERY_COOLDOWN_DAYS_EMPTY = 'artemis_sam_query_cooldown_days_empty';
const SETTING_SAM_QUERY_COOLDOWN_HOURS_DUPLICATE = 'artemis_sam_query_cooldown_hours_duplicate';
const SETTING_SAM_QUERY_RETRY_BACKOFF_BASE_MINUTES = 'artemis_sam_query_retry_backoff_base_minutes';
const SETTING_SAM_OPPORTUNITIES_PARTITION_DAYS = 'artemis_sam_opportunities_partition_days';
const SETTING_SAM_OPPORTUNITIES_PARTITION_ENABLED = 'artemis_sam_opportunities_partition_enabled';
const SETTING_SAM_OPPORTUNITIES_API_DELTA_ONLY = 'artemis_sam_opportunities_api_delta_only';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED = 'artemis_sam_opportunities_data_services_enabled';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ACTIVE_URL = 'artemis_sam_opportunities_data_services_active_url';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ARCHIVED_URL = 'artemis_sam_opportunities_data_services_archived_url';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM = 'artemis_sam_opportunities_data_services_api_key_param';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_TIMEOUT_MS = 'artemis_sam_opportunities_data_services_timeout_ms';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN =
  'artemis_sam_opportunities_data_services_max_files_per_source_per_run';
const SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES = 'artemis_sam_opportunities_data_services_max_file_bytes';
const SETTING_SAM_ENTITY_SYNC_ENABLED = 'artemis_sam_entity_sync_enabled';
const SETTING_SAM_ENTITY_API_URL = 'artemis_sam_entity_api_url';
const SETTING_SAM_ENTITY_ALIAS_JSON = 'artemis_sam_entity_alias_json';
const SETTING_SAM_CONTRACT_AWARDS_INCLUDE_DELETED = 'artemis_sam_contract_awards_include_deleted';
const SETTING_SAM_CONTRACT_AWARDS_INCLUDE_SECTIONS = 'artemis_sam_contract_awards_include_sections';
const SETTING_SAM_CONTRACT_AWARDS_EXTRACT_ENABLED = 'artemis_sam_contract_awards_extract_enabled';
const SETTING_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT = 'artemis_sam_contract_awards_extract_format';
const SETTING_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT = 'artemis_sam_contract_awards_extract_poll_limit';

const DEFAULT_BATCH_LIMIT = 2000;
const DEFAULT_LOOKBACK_DAYS = 365;
const DEFAULT_SAM_DAILY_LIMIT = 10;
const DEFAULT_SAM_DAILY_RESERVE = 0;
const DEFAULT_SAM_MAX_REQUESTS_PER_RUN = 10;
const DEFAULT_SAM_QUERY_COOLDOWN_DAYS_EMPTY = 14;
const DEFAULT_SAM_QUERY_COOLDOWN_HOURS_DUPLICATE = 24;
const DEFAULT_SAM_QUERY_RETRY_BACKOFF_BASE_MINUTES = 30;
const DEFAULT_SAM_OPPORTUNITIES_PARTITION_DAYS = 30;
const DEFAULT_SAM_OPPORTUNITIES_PARTITION_ENABLED = true;
const DEFAULT_SAM_OPPORTUNITIES_PARTITION_CANDIDATE_MULTIPLIER = 3;
const DEFAULT_SAM_OPPORTUNITIES_API_DELTA_ONLY = true;
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED = true;
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ACTIVE_URL = '';
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ARCHIVED_URL = '';
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM = 'api_key';
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_TIMEOUT_MS = 120_000;
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN = 1;
const DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES = 250_000_000;
const DEFAULT_SAM_ENTITY_SYNC_ENABLED = true;
const DEFAULT_SAM_ENTITY_API_URL = 'https://api.sam.gov/entity-information/v4/entities';
const DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_DELETED = true;
const DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_SECTIONS = 'coreData,contractId,nasaSpecific';
const DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_ENABLED = true;
const DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT: SamExtractFormat = 'json';
const DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT = 5;
const SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT_MAX = 25;
const MAX_SAM_QUERY_RETRY_EXPONENT = 6;
const SPENDING_ACTION_CONTRACT_ID_LIMIT = 1000;
const SPENDING_ACTION_CONTRACT_ID_CHUNK_SIZE = 200;
// Scan wider candidate pools so each run can fairly cover Artemis + Blue Origin + SpaceX.
const SAM_CONTRACT_AWARDS_CANDIDATE_MULTIPLIER = 200;
const SAM_OPPORTUNITIES_SOLICITATION_SCAN_MULTIPLIER = 10;
const SAM_CONTRACT_AWARDS_LIMIT = 100;
const SAM_OPPORTUNITIES_LIMIT = 1000;
const SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS = 364;
const SAM_OPPORTUNITIES_MAX_WINDOW_DAYS = SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS;
const SAM_HTTP_TIMEOUT_MS = 20_000;
const ACTION_LINKAGE_FETCH_CHUNK_SIZE = 20;
const CONTRACT_LOOKUP_FETCH_CHUNK_SIZE = 50;
const SAM_AWARD_ROW_KEY_FETCH_CHUNK_SIZE = 50;
const SAM_EXISTING_AWARD_BACKFILL_ACTION_SCAN_LIMIT = 10_000;
const RUN_PROGRESS_HEARTBEAT_MS = 15_000;
const RUN_PHASE_TRACE_LIMIT = 200;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const UPSERT_CHUNK_SIZE = 250;
const TARGET_SAM_PROGRAM_SCOPES = ['artemis', 'blue-origin', 'spacex'] as const;
const SAM_OPPORTUNITIES_PARTITION_KEYWORDS: Record<'artemis' | 'blue-origin' | 'spacex', string[]> = {
  artemis: ['Artemis', 'Human Landing System', 'HLS', 'Gateway', 'Orion', 'SLS', 'lunar'],
  'blue-origin': ['Blue Origin', 'Blue Moon', 'New Glenn', 'BE-4', 'BE-7'],
  spacex: ['SpaceX', 'Space Exploration Technologies', 'Starship', 'Falcon', 'Dragon', 'Starlink']
};
const DEFAULT_SAM_ENTITY_ALIAS_SEEDS: SamEntityAliasSeed[] = [
  { scope: 'spacex', legalBusinessName: 'Space Exploration Technologies Corp' },
  { scope: 'spacex', legalBusinessName: 'SpaceX' },
  { scope: 'blue-origin', legalBusinessName: 'Blue Origin, LLC' },
  { scope: 'blue-origin', legalBusinessName: 'Blue Origin' }
];

const KEYWORD_ALIGNMENT_RULES: Array<{ lineToken: string; contractTokens: string[]; confidence: number }> = [
  { lineToken: 'space launch system', contractTokens: ['space launch system', 'sls', 'core stage', 'exploration upper stage'], confidence: 0.92 },
  { lineToken: 'orion', contractTokens: ['orion', 'crew capsule', 'crew module', 'service module'], confidence: 0.92 },
  {
    lineToken: 'exploration ground systems',
    contractTokens: ['exploration ground systems', 'egs', 'mobile launcher', 'ground systems', 'vab'],
    confidence: 0.9
  },
  { lineToken: 'human landing system', contractTokens: ['human landing system', 'hls', 'lunar lander'], confidence: 0.93 },
  { lineToken: 'gateway', contractTokens: ['gateway', 'halo', 'ppe'], confidence: 0.91 },
  { lineToken: 'xeva', contractTokens: ['x-eva', 'xeva', 'extravehicular'], confidence: 0.88 },
  { lineToken: 'moon to mars', contractTokens: ['moon to mars', 'moon-to-mars'], confidence: 0.85 }
];

function createSamScopeDistribution(): SamScopeDistribution {
  return {
    artemis: 0,
    'blue-origin': 0,
    spacex: 0,
    other: 0
  };
}

function normalizeProgramScopeOrder(targetScopes: readonly ProgramScope[]): ProgramScope[] {
  const seen = new Set<ProgramScope>();
  const ordered: ProgramScope[] = [];
  for (const scope of targetScopes) {
    if (!scope) continue;
    if (!seen.has(scope)) {
      seen.add(scope);
      ordered.push(scope);
    }
  }
  return ordered;
}

function tallyProgramScope(rows: ReadonlyArray<{ programScope: ProgramScope }>): SamScopeDistribution {
  const counts = createSamScopeDistribution();
  for (const row of rows) {
    counts[row.programScope] = counts[row.programScope] + 1;
  }
  return counts;
}

function mergeSamScopeDistribution(base: SamScopeDistribution, add: SamScopeDistribution): SamScopeDistribution {
  return {
    artemis: base.artemis + add.artemis,
    'blue-origin': base['blue-origin'] + add['blue-origin'],
    spacex: base.spacex + add.spacex,
    other: base.other + add.other
  };
}

function interleaveScopeOrderedCandidates<T extends { programScope: ProgramScope }>(
  rows: ReadonlyArray<T>,
  targetScopes: readonly ProgramScope[]
): T[] {
  const orderedScopes = normalizeProgramScopeOrder(targetScopes);
  if (!orderedScopes.length || !rows.length) return [...rows];

  const buckets = new Map<ProgramScope, T[]>();
  for (const scope of orderedScopes) {
    buckets.set(scope, []);
  }

  for (const row of rows) {
    const scope = row.programScope;
    const bucket = buckets.get(scope);
    if (bucket) bucket.push(row);
    else if (!buckets.has(scope) && orderedScopes.includes(scope)) {
      buckets.set(scope, [row]);
    }
  }

  const enabledScopes = orderedScopes.filter((scope) => {
    const bucket = buckets.get(scope);
    return !!bucket && bucket.length > 0;
  });
  if (!enabledScopes.length) return [];

  const result: T[] = [];
  while (result.length < rows.length) {
    let added = false;
    for (const scope of enabledScopes) {
      const bucket = buckets.get(scope);
      if (!bucket || bucket.length < 1) continue;
      const row = bucket.shift();
      if (row) {
        result.push(row);
        added = true;
      }
    }
    if (!added) break;
  }

  return result;
}

async function persistIngestionRunStatsSnapshot(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  stats: Record<string, unknown>
) {
  const { error } = await supabase.from('ingestion_runs').update({ stats }).eq('id', runId);
  if (error) throw error;
}

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, RUN_NAME);
  let disableJobOnGuardrail = true;
  const stats: Record<string, unknown> = {
    mode: 'incremental',
    stage: 'all',
    procurementRowsRead: 0,
    normalizedContractsUpserted: 0,
    normalizedActionsUpserted: 0,
    budgetMappingsUpserted: 0,
    spendingRowsUpserted: 0,
    solicitationIdsEvaluated: 0,
    samRequestsAttempted: 0,
    samRequestsGranted: 0,
    samAwardsRequestsAttempted: 0,
    samAwardsRequestsGranted: 0,
    samOpportunitiesRequestsAttempted: 0,
    samOpportunitiesRequestsGranted: 0,
    samEntityRequestsAttempted: 0,
    samEntityRequestsGranted: 0,
    samRunRequestCapRequested: 0,
    samRunRequestCap: 0,
    samRunRequestsRemaining: 0,
    samNoticesUpserted: 0,
    samNoticesFetched: 0,
    samNoticesExisting: 0,
    samOpportunitiesVersionRowsFetched: 0,
    samOpportunitiesVersionRowsUpserted: 0,
    samOpportunitiesVersionRowsExisting: 0,
    samOpportunitiesProjectionRowsUpserted: 0,
    samOpportunitiesProjectionRowsExisting: 0,
    samOpportunitiesTruncatedResponses: 0,
    samOpportunitiesApiDeltaOnly: DEFAULT_SAM_OPPORTUNITIES_API_DELTA_ONLY,
    samOpportunitiesDataServicesEnabled: DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED,
    samOpportunitiesDataServicesMaxFilesPerSourcePerRun:
      DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN,
    samOpportunitiesDataServicesMaxFileBytes: DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES,
    samOpportunitiesDataServicesSync: null as SamOpportunitiesDataServicesSyncResult | null,
    samOpportunitiesDataServicesSourcesEvaluated: 0,
    samOpportunitiesDataServicesSourcesSucceeded: 0,
    samOpportunitiesDataServicesSourcesErrored: 0,
    samOpportunitiesDataServicesNoticesFetched: 0,
    samOpportunitiesDataServicesVersionRowsFetched: 0,
    samOpportunitiesDataServicesVersionRowsUpserted: 0,
    samOpportunitiesDataServicesVersionRowsExisting: 0,
    samOpportunitiesDataServicesProjectionRowsUpserted: 0,
    samOpportunitiesDataServicesProjectionRowsExisting: 0,
    samAwardsContractsEvaluated: 0,
    samAwardRowsFetched: 0,
    samAwardRowsExisting: 0,
    samAwardsContractsBackfilled: 0,
    samAwardsActionsBackfilled: 0,
    samAwardsAmbiguousContracts: 0,
    samAwardsSolicitationIdsBackfilled: 0,
    samAwardsTruncatedResponses: 0,
    samAwardsExtractEnabled: false,
    samAwardsExtractFormat: DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT,
    samAwardsExtractPollLimit: DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT,
    samAwardsExtractJobsRequested: 0,
    samAwardsExtractJobsSkipped: 0,
    samAwardsExtractJobsPolled: 0,
    samAwardsExtractJobsReady: 0,
    samAwardsExtractJobsApplied: 0,
    samAwardsExtractJobsFailed: 0,
    samAwardsExtractRowsFetched: 0,
    samAwardsExtractRowsUpserted: 0,
    samAwardsExtractRowsExisting: 0,
    samStepTrace: [] as Array<Record<string, unknown>>,
    samStopReasons: [] as string[],
    samEndpointDecisions: [] as Array<Record<string, unknown>>,
    samAwardCandidateScopeDistribution: createSamScopeDistribution(),
    samOpportunitiesFallbackScopeDistribution: createSamScopeDistribution(),
    samContractAwardsStopReason: null as string | null,
    samOpportunitiesStopReason: null as string | null,
    samRunStopReason: null as string | null,
    samRunStoppedByEndpoint: null as string | null,
    samRunStoppedAt: null as string | null,
    samGuardrailReason: null as string | null,
    samSinglePassPerEndpoint: false,
    sourceDocumentsInserted: 0,
    runPhaseTrace: [] as Array<Record<string, unknown>>,
    runPhaseDurationsMs: {} as Record<string, number>,
    runCurrentPhase: null as string | null,
    runLastCompletedPhase: null as string | null,
    runLastProgressAt: null as string | null,
    errors: [] as Array<{ step: string; error: string }>,
    samSessionToken: null as string | null
  };
  let bodySamSessionToken: string | null = null;
  let lastProgressPersistAt = 0;
  const runPhaseTrace = stats.runPhaseTrace as Array<Record<string, unknown>>;
  const runPhaseDurationsMs = stats.runPhaseDurationsMs as Record<string, number>;
  let activePhaseName: string | null = null;
  let activePhaseStartedAtMs: number | null = null;

  const pushRunPhaseTrace = (entry: Record<string, unknown>) => {
    runPhaseTrace.push({ at: new Date().toISOString(), ...entry });
    if (runPhaseTrace.length > RUN_PHASE_TRACE_LIMIT) {
      runPhaseTrace.splice(0, runPhaseTrace.length - RUN_PHASE_TRACE_LIMIT);
    }
  };

  const persistRunProgress = async (options?: { force?: boolean; phase?: string | null }) => {
    const force = Boolean(options?.force);
    const nowMs = Date.now();
    if (!force && nowMs - lastProgressPersistAt < RUN_PROGRESS_HEARTBEAT_MS) return;
    const nowIso = new Date(nowMs).toISOString();
    if (options && Object.prototype.hasOwnProperty.call(options, 'phase')) {
      stats.runCurrentPhase = options.phase || null;
    }
    stats.runLastProgressAt = nowIso;
    stats.elapsedMs = nowMs - startedAt;
    lastProgressPersistAt = nowMs;
    await persistIngestionRunStatsSnapshot(supabase, runId, stats);
  };

  const beginRunPhase = async (phase: string, details: Record<string, unknown> = {}) => {
    activePhaseName = phase;
    activePhaseStartedAtMs = Date.now();
    stats.runCurrentPhase = phase;
    pushRunPhaseTrace({ phase, status: 'start', ...details });
    await persistRunProgress({ force: true, phase });
  };

  const endRunPhase = async (phase: string, details: Record<string, unknown> = {}) => {
    const durationMs =
      activePhaseName === phase && activePhaseStartedAtMs !== null ? Math.max(0, Date.now() - activePhaseStartedAtMs) : 0;
    runPhaseDurationsMs[phase] = Number(runPhaseDurationsMs[phase] || 0) + durationMs;
    stats.runLastCompletedPhase = phase;
    stats.runCurrentPhase = null;
    pushRunPhaseTrace({ phase, status: 'end', durationMs, ...details });
    activePhaseName = null;
    activePhaseStartedAtMs = null;
    await persistRunProgress({ force: true, phase: null });
  };

  const failRunPhase = async (phase: string, errorMessage: string, details: Record<string, unknown> = {}) => {
    const durationMs =
      activePhaseName === phase && activePhaseStartedAtMs !== null ? Math.max(0, Date.now() - activePhaseStartedAtMs) : 0;
    stats.runCurrentPhase = null;
    pushRunPhaseTrace({ phase, status: 'error', durationMs, error: errorMessage, ...details });
    activePhaseName = null;
    activePhaseStartedAtMs = null;
    await persistRunProgress({ force: true, phase: null }).catch(() => undefined);
  };

  try {
    await beginRunPhase('config_load', { runId });
    const enabled = await readBooleanSetting(supabase, SETTING_CONTRACTS_JOB_ENABLED, true);
    if (!enabled) {
      stats.samRequestStopReason = 'job_disabled';
      stats.samSkippedReason = 'job_disabled';
      (stats.samStepTrace as Array<Record<string, unknown>>).push({
        at: new Date().toISOString(),
        step: 'sam_job_disabled',
        reason: 'job_disabled'
      });
      await endRunPhase('config_load', { skipped: true, reason: 'job_disabled' });
      await finishIngestionRun(supabase, runId, true, {
        skipped: true,
        reason: 'job_disabled',
        samStepTrace: stats.samStepTrace
      });
      return jsonResponse({
        ok: true,
        runId,
        skipped: true,
        reason: 'job_disabled',
        elapsedMs: Date.now() - startedAt
      });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    disableJobOnGuardrail = await readBooleanSetting(supabase, SETTING_SAM_DISABLE_ON_GUARDRAIL, true);
    const configuredStopOnEmptyOrError = await readBooleanSetting(supabase, SETTING_SAM_STOP_ON_EMPTY_OR_ERROR, true);
    const hasBodyStopOnEmptyOrErrorFlag = Object.prototype.hasOwnProperty.call(body, 'samStopOnEmptyOrError');
    const bodyStopOnEmptyOrErrorRaw = hasBodyStopOnEmptyOrErrorFlag ? readBooleanValue(body.samStopOnEmptyOrError) : null;
    const enforceStopOnEmptyOrError =
      bodyStopOnEmptyOrErrorRaw === null ? configuredStopOnEmptyOrError : bodyStopOnEmptyOrErrorRaw;
    const probeBothEndpointsFirst = await readBooleanSetting(supabase, SETTING_SAM_PROBE_BOTH_ENDPOINTS_FIRST, true);
    const configuredSamSinglePassPerEndpoint = await readBooleanSetting(
      supabase,
      SETTING_SAM_SINGLE_PASS_PER_ENDPOINT,
      true
    );
    stats.samDisableJobOnGuardrail = disableJobOnGuardrail;
    stats.samStopOnEmptyOrError = enforceStopOnEmptyOrError;
    (stats as Record<string, unknown>).samConfiguredStopOnEmptyOrError = configuredStopOnEmptyOrError;
    stats.samProbeBothEndpointsFirst = probeBothEndpointsFirst;

    bodySamSessionToken = stringOrNull(body.samSessionToken);
    const bodyRequestedSamMaxRequestsPerRun = readOptionalInteger(body?.samMaxRequestsPerRun, { min: 0, max: 9999 });
    const hasBodySinglePassFlag = Object.prototype.hasOwnProperty.call(body, 'samSinglePassPerEndpoint');
    const bodySinglePassRaw = hasBodySinglePassFlag ? readBooleanValue(body.samSinglePassPerEndpoint) : null;
    const bodySamSinglePassPerEndpoint =
      bodySinglePassRaw === null ? configuredSamSinglePassPerEndpoint : bodySinglePassRaw;

    const configuredMode = readIngestMode(await readStringSetting(supabase, 'artemis_contracts_ingest_mode', 'incremental'));
    const mode = readIngestMode(stringOrNull(body.mode)) || configuredMode;
    const stage = readIngestStage(stringOrNull(body.stage)) || 'all';
    const configuredSamMaxRequestsPerRun = Math.max(
      0,
      Math.trunc(await readNumberSetting(supabase, 'artemis_sam_max_requests_per_run', DEFAULT_SAM_MAX_REQUESTS_PER_RUN))
    );
    const samMaxRequestsPerRun = bodyRequestedSamMaxRequestsPerRun === null
      ? configuredSamMaxRequestsPerRun
      : Math.min(bodyRequestedSamMaxRequestsPerRun, configuredSamMaxRequestsPerRun);

    stats.mode = mode;
    stats.stage = stage;
    stats.samSessionToken = bodySamSessionToken;
    stats.samSinglePassPerEndpoint = bodySamSinglePassPerEndpoint;
    stats.samMaxRequestsPerRunRequested = bodyRequestedSamMaxRequestsPerRun;
    stats.samMaxRequestsPerRunConfigured = configuredSamMaxRequestsPerRun;
    stats.samMaxRequestsPerRunApplied = samMaxRequestsPerRun;
    await endRunPhase('config_load', { mode, stage });
    await beginRunPhase('procurement_fetch', {
      shouldReadProcurementRows: stage === 'all' || stage === 'normalize'
    });

    const shouldReadProcurementRows = stage === 'all' || stage === 'normalize';
    const shouldMarkNormalizedRunning = shouldReadProcurementRows || stage === 'budget-map';
    if (shouldMarkNormalizedRunning) {
      const nowIso = new Date().toISOString();
      await updateCheckpoint(supabase, CHECKPOINT_NORMALIZED, {
        sourceType: 'procurement',
        status: 'running',
        startedAt: nowIso,
        lastError: null,
        metadata: { mode, stage }
      });
    }

    const previousCursor =
      shouldReadProcurementRows && mode === 'incremental' ? await readCheckpointCursor(supabase, CHECKPOINT_NORMALIZED) : null;
    const procurementRows = shouldReadProcurementRows
      ? await fetchProcurementAwards(supabase, {
          mode,
          cursor: previousCursor,
          limit: Math.max(100, Math.trunc(await readNumberSetting(supabase, 'artemis_contracts_batch_limit', DEFAULT_BATCH_LIMIT)))
        })
      : [];

    stats.procurementRowsRead = procurementRows.length;
    await endRunPhase('procurement_fetch', {
      procurementRowsRead: procurementRows.length,
      previousCursor
    });
    await beginRunPhase('normalize_contracts');

    const normalized = buildNormalizedContracts(procurementRows);
    const contractRefs =
      stage === 'opportunities' || stage === 'spending' || stage === 'budget-map' || stage === 'sam-contract-awards'
        ? await fetchContractRefs(supabase)
        : await upsertNormalizedContracts(supabase, normalized.contracts, stats);
    const contractIdByKey = new Map(contractRefs.map((row) => [row.contract_key, row.id]));
    await endRunPhase('normalize_contracts', {
      contractRefs: contractRefs.length,
      normalizedContractsUpserted: Number(stats.normalizedContractsUpserted || 0)
    });

    if (stage === 'all' || stage === 'normalize') {
      await beginRunPhase('normalize_actions');
      const actions = buildContractActions(procurementRows, contractIdByKey);
      const actionCount = await upsertContractActions(supabase, actions, stats);
      stats.normalizedActionsUpserted = actionCount;

      const nextCursor = resolveNextCursor(procurementRows);
      await updateCheckpoint(supabase, CHECKPOINT_NORMALIZED, {
        sourceType: 'procurement',
        status: 'complete',
        cursor: nextCursor,
        recordsIngested: Number(stats.normalizedContractsUpserted || 0) + Number(stats.normalizedActionsUpserted || 0),
        endedAt: new Date().toISOString(),
        lastError: null,
        metadata: {
          mode,
          stage,
          previousCursor,
          nextCursor,
          procurementRowsRead: procurementRows.length
        }
      });
      await endRunPhase('normalize_actions', {
        normalizedActionsUpserted: actionCount
      });
    }

    if (stage === 'all' || stage === 'budget-map') {
      await beginRunPhase('budget_map');
      await updateCheckpoint(supabase, CHECKPOINT_NORMALIZED, {
        sourceType: 'procurement',
        status: 'running',
        metadata: {
          ...(await safeCheckpointMetadata(supabase, CHECKPOINT_NORMALIZED)),
          budgetMappingStartedAt: new Date().toISOString()
        }
      });

      const mapped = await upsertBudgetMappings(supabase, contractRefs, stats);
      stats.budgetMappingsUpserted = mapped;

      await updateCheckpoint(supabase, CHECKPOINT_NORMALIZED, {
        sourceType: 'procurement',
        status: 'complete',
        endedAt: new Date().toISOString(),
        lastError: null,
        metadata: {
          ...(await safeCheckpointMetadata(supabase, CHECKPOINT_NORMALIZED)),
          budgetMappingEndedAt: new Date().toISOString(),
          budgetMappingsUpserted: mapped
        }
      });
      await endRunPhase('budget_map', { budgetMappingsUpserted: mapped });
    }

    if (stage === 'all' || stage === 'spending') {
      await beginRunPhase('spending_overlay');
      await updateCheckpoint(supabase, CHECKPOINT_SPENDING, {
        sourceType: 'procurement',
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null
      });

      const spendingRows = await upsertSpendingTimeseries(supabase, contractRefs, stats);
      stats.spendingRowsUpserted = spendingRows;

      await updateCheckpoint(supabase, CHECKPOINT_SPENDING, {
        sourceType: 'procurement',
        status: 'complete',
        recordsIngested: spendingRows,
        endedAt: new Date().toISOString(),
        lastError: null
      });
      await endRunPhase('spending_overlay', { spendingRowsUpserted: spendingRows });
    }

    await beginRunPhase('sam_orchestration');
    const runSamContractAwards = stage === 'all' || stage === 'sam-contract-awards';
    const runSamOpportunities = stage === 'all' || stage === 'opportunities';
    const allowFallbackLookup = stage === 'all' || stage === 'opportunities';
    const shouldProbeBothEndpoints =
      probeBothEndpointsFirst &&
      (stage === 'all' || stage === 'sam-contract-awards') &&
      runSamContractAwards &&
      runSamOpportunities;
    const samApiKey = (Deno.env.get('SAM_GOV_API_KEY') || '').trim();
    let remainingSamRequests = 0;
    let samGuardrailTriggered = false;
    let samGuardrailReason: string | null = null;
    let samRunStopReason: string | null = null;
    let samRunStopByEndpoint: 'contract-awards' | 'opportunities' | null = null;
    let samRunStopStepAt: string | null = null;
    const targetedSolicitationIds = new Set<string>();
    const targetedContractIds = new Set<string>();
    const probeStopReasons: string[] = [];
    let samContractAwardsStopReason: string | null = null;
    let samOpportunitiesStopReason: string | null = null;
    const stopReasonIsGuardrail = (reason: string | null, includeNoDataAndNoCandidates: boolean) => {
      if (!reason) return false;
      if (reason === 'sam_no_new_data' || reason === 'sam_no_candidates') return includeNoDataAndNoCandidates;
      if (reason === 'sam_no_activity') return true;
      if (reason === 'sam_quota_blocked') return true;
      if (reason === 'sam_quota_throttled') return true;
      if (reason === 'sam_http_404_not_found') return true;
      if (reason === 'sam_run_cap_exhausted') return true;
      if (reason === 'sam_probe_insufficient_run_cap') return true;
      if (reason.startsWith('sam_http_error_')) return true;
      if (reason.startsWith('sam_auth_error_')) return true;
      return false;
    };
    const shouldStopSamRun = (reason: string | null) => stopReasonIsGuardrail(reason, enforceStopOnEmptyOrError);
    const shouldStopSamRunForEndpoint = (endpoint: 'contract-awards' | 'opportunities', reason: string | null) => {
      if (reason === 'sam_quota_throttled' && endpoint === 'contract-awards' && runSamOpportunities) {
        return false;
      }
      return shouldStopSamRun(reason);
    };
    const samStepTrace = stats.samStepTrace as Array<Record<string, unknown>>;
    const getSamEndpointDecisions = () =>
      (Array.isArray(stats.samEndpointDecisions)
        ? stats.samEndpointDecisions
        : ((stats.samEndpointDecisions = [] as Array<Record<string, unknown>>) as Array<Record<string, unknown>>));
    const pushSamStep = (step: string, details: Record<string, unknown> = {}) => {
      samStepTrace.push({
        at: new Date().toISOString(),
        step,
        ...details
      });
    };
    const logSamEndpointDecision = (
      endpoint: 'contract-awards' | 'opportunities',
      phase: string,
      action: string,
      reason: string | null = null,
      details: Record<string, unknown> = {}
    ) => {
      const decision = {
        at: new Date().toISOString(),
        endpoint,
        phase,
        action,
        reason,
        ...details
      };
      getSamEndpointDecisions().push(decision);
      pushSamStep('sam_endpoint_decision', decision as Record<string, unknown>);
    };
    const recordSamRunStop = (
      endpoint: 'contract-awards' | 'opportunities',
      reason: string | null,
      options: { phase: string; details?: Record<string, unknown> }
    ) => {
      if (!shouldStopSamRun(reason)) return;
      const stopReason = String(reason);
      if (!samRunStopReason) {
        samRunStopReason = stopReason;
        samRunStopByEndpoint = endpoint;
        samRunStopStepAt = new Date().toISOString();
        stats.samRunStopReason = stopReason;
        if (!stats.samSkippedReason) stats.samSkippedReason = stopReason;
        if (!stats.samRequestStopReason) stats.samRequestStopReason = stopReason;
        pushSamStep('sam_run_stop', {
          endpoint,
          stopReason,
          phase: options.phase,
          ...options.details
        });
      } else if (samRunStopReason !== stopReason) {
        pushSamStep('sam_run_stop', {
          endpoint,
          stopReason,
          priorStopReason: samRunStopReason,
          phase: options.phase,
          ...options.details
        });
      }

      logSamEndpointDecision(endpoint, options.phase, 'endpoint_stop', stopReason, {
        stopReason,
        stoppingEndpoint: samRunStopByEndpoint,
        ...options.details
      });
      const stopReasons = getSamStopReasons();
      if (!stopReasons.includes(stopReason)) stopReasons.push(stopReason);
      recordSamGuardrail(`sam_${endpoint.replace('-', '_')}:${stopReason}`, stopReason, false);
    };
    stats.samProbeBothEndpointsArmed = shouldProbeBothEndpoints;

    if (runSamContractAwards || runSamOpportunities) {
      const requestedRunCap = Math.max(0, Math.trunc(samMaxRequestsPerRun));
      let quotaWindow: Awaited<ReturnType<typeof readDailyQuotaWindow>> | null = null;
      try {
        const quotaWindowTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('sam_quota_window_timeout')), 8_000);
        });
        quotaWindow = await Promise.race([
          readDailyQuotaWindow(supabase, {
            stateKey: 'artemis_sam_quota_state',
            limitKey: 'artemis_sam_daily_quota_limit',
            reserveKey: 'artemis_sam_daily_quota_reserve',
            defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
            defaultReserve: DEFAULT_SAM_DAILY_RESERVE
          }),
          quotaWindowTimeout
        ]);
      } catch (error) {
        const message = stringifyError(error);
        (stats.errors as Array<{ step: string; error: string }>).push({
          step: 'sam_quota_window',
          error: message
        });
        pushSamStep('sam_quota_window_error', {
          requestedRunCap,
          error: message,
          fallback: 'run_cap_only'
        });
      }
      remainingSamRequests = quotaWindow
        ? Math.max(0, Math.min(requestedRunCap, quotaWindow.available))
        : requestedRunCap;

      stats.samRunRequestCapRequested = requestedRunCap;
      stats.samRunRequestCap = remainingSamRequests;
      stats.samRunRequestsRemaining = remainingSamRequests;
      stats.samQuotaWindow = quotaWindow;
      stats.samQuota = quotaWindow;
      pushSamStep('sam_quota_window', {
        requestedRunCap,
        effectiveRunCap: remainingSamRequests,
        quotaDate: quotaWindow?.date || null,
        quotaUsed: quotaWindow?.used ?? null,
        quotaLimit: quotaWindow?.limit ?? null,
        quotaReserve: quotaWindow?.reserve ?? null,
        quotaAvailable: quotaWindow?.available ?? null,
        fallbackApplied: quotaWindow ? false : true
      });
    }

    const shouldTreatSamStopReasonAsGuardrail = (reason: string | null) => stopReasonIsGuardrail(reason, enforceStopOnEmptyOrError);
    const getSamStopReasons = () =>
      (Array.isArray(stats.samStopReasons) ? stats.samStopReasons : ((stats.samStopReasons = [] as string[]) as string[])) as string[];
    const getSamProbeStopReasons = () =>
      (Array.isArray(stats.samProbeStopReasons)
        ? stats.samProbeStopReasons
        : ((stats.samProbeStopReasons = [] as string[]) as string[])) as string[];

    const recordSamGuardrail = (guardrailReason: string, stopReason: string, deferGuardrail: boolean) => {
      if (!stopReason) return;
      if (!shouldTreatSamStopReasonAsGuardrail(stopReason)) return;
      if (samGuardrailTriggered) {
        const stopReasons = getSamStopReasons();
        if (!stopReasons.includes(stopReason)) stopReasons.push(stopReason);
        if (deferGuardrail && !probeStopReasons.includes(guardrailReason)) {
          probeStopReasons.push(guardrailReason);
          pushSamStep('sam_guardrail_reason', { guardrailReason, stopReason, deferred: deferGuardrail });
        }
        return;
      }

      const currentStopReason = stringOrNull(stats.samRequestStopReason);
      if (!currentStopReason) stats.samRequestStopReason = stopReason;
      if (!stats.samSkippedReason) stats.samSkippedReason = stopReason;
      const stopReasons = (Array.isArray(stats.samStopReasons)
        ? stats.samStopReasons
        : ((stats.samStopReasons = [] as string[]) as string[])) as string[];
      if (stopReason && !stopReasons.includes(stopReason)) {
        stopReasons.push(stopReason);
      }
      pushSamStep('sam_guardrail_reason', { guardrailReason, stopReason, deferred: deferGuardrail });
      samGuardrailTriggered = true;
      if (!samGuardrailReason) samGuardrailReason = guardrailReason;
      if (deferGuardrail && !probeStopReasons.includes(guardrailReason)) {
        probeStopReasons.push(guardrailReason);
      }
    };

    if (runSamContractAwards) {
      const requestedRunCap = Math.max(0, Math.trunc(samMaxRequestsPerRun));
      if (requestedRunCap < 1) {
        recordSamGuardrail('sam_run_cap:requested_zero', 'sam_run_cap_exhausted', false);
        recordSamRunStop('contract-awards', 'sam_run_cap_exhausted', {
          phase: 'init',
          details: { configuredRunCap: requestedRunCap, runCapRemaining: remainingSamRequests }
        });
      } else if (remainingSamRequests < 1) {
        recordSamGuardrail('sam_run_cap:quota_exhausted', 'sam_run_cap_exhausted', false);
        recordSamRunStop('contract-awards', 'sam_run_cap_exhausted', {
          phase: 'init',
          details: { configuredRunCap: requestedRunCap, runCapRemaining: remainingSamRequests }
        });
      }
    }

    const mergeLookupSource = (incoming: SamOpportunitiesSyncResult['lookupSource']) => {
      if (!incoming || incoming === 'none') return;
      const existing = stringOrNull(stats.samLookupSource);
      if (!existing || existing === 'none') {
        stats.samLookupSource = incoming;
        return;
      }
      if (existing === incoming) return;
      stats.samLookupSource = 'mixed';
    };

    const applyContractAwardsResult = (
      result: SamContractAwardsBackfillResult,
      options: { phase: string }
    ) => {
      for (const solicitationId of result.targetedSolicitationIds) {
        targetedSolicitationIds.add(solicitationId);
      }

      stats.samAwardsContractsEvaluated = Number(stats.samAwardsContractsEvaluated || 0) + result.contractsEvaluated;
      stats.samAwardsContractsBackfilled = Number(stats.samAwardsContractsBackfilled || 0) + result.contractsBackfilled;
      stats.samAwardsActionsBackfilled = Number(stats.samAwardsActionsBackfilled || 0) + result.actionsBackfilled;
      stats.samAwardsRowsUpserted = Number(stats.samAwardsRowsUpserted || 0) + result.awardRowsUpserted;
      stats.samAwardRowsFetched = Number(stats.samAwardRowsFetched || 0) + result.awardRowsFetched;
      stats.samAwardRowsExisting = Number(stats.samAwardRowsExisting || 0) + result.awardRowsExisting;
      stats.samAwardsAmbiguousContracts = Number(stats.samAwardsAmbiguousContracts || 0) + result.ambiguousContracts;
      stats.samAwardsSolicitationIdsBackfilled = targetedSolicitationIds.size;
      stats.samAwardsTruncatedResponses = Number(stats.samAwardsTruncatedResponses || 0) + result.truncatedResponses;
      stats.samAwardsFingerprintSkips = Number(stats.samAwardsFingerprintSkips || 0) + result.fingerprintSkips;
      stats.samAwardsExtractEnabled = result.extractEnabled;
      stats.samAwardsExtractFormat = result.extractFormat;
      stats.samAwardsExtractPollLimit = result.extractPollLimit;
      stats.samAwardsExtractJobsRequested = Number(stats.samAwardsExtractJobsRequested || 0) + result.extractJobsRequested;
      stats.samAwardsExtractJobsSkipped = Number(stats.samAwardsExtractJobsSkipped || 0) + result.extractJobsSkipped;
      stats.samAwardsExtractJobsPolled = Number(stats.samAwardsExtractJobsPolled || 0) + result.extractJobsPolled;
      stats.samAwardsExtractJobsReady = Number(stats.samAwardsExtractJobsReady || 0) + result.extractJobsReady;
      stats.samAwardsExtractJobsApplied = Number(stats.samAwardsExtractJobsApplied || 0) + result.extractJobsApplied;
      stats.samAwardsExtractJobsFailed = Number(stats.samAwardsExtractJobsFailed || 0) + result.extractJobsFailed;
      stats.samAwardsExtractRowsFetched = Number(stats.samAwardsExtractRowsFetched || 0) + result.extractRowsFetched;
      stats.samAwardsExtractRowsUpserted = Number(stats.samAwardsExtractRowsUpserted || 0) + result.extractRowsUpserted;
      stats.samAwardsExtractRowsExisting = Number(stats.samAwardsExtractRowsExisting || 0) + result.extractRowsExisting;
      stats.samAwardCandidateScopeDistribution = mergeSamScopeDistribution(
        (stats.samAwardCandidateScopeDistribution as SamScopeDistribution) || createSamScopeDistribution(),
        result.candidateScopeDistribution
      );

      stats.samRequestsAttempted = Number(stats.samRequestsAttempted || 0) + result.samRequestsAttempted;
      stats.samRequestsGranted = Number(stats.samRequestsGranted || 0) + result.samRequestsGranted;
      stats.samAwardsRequestsAttempted = Number(stats.samAwardsRequestsAttempted || 0) + result.samRequestsAttempted;
      stats.samAwardsRequestsGranted = Number(stats.samAwardsRequestsGranted || 0) + result.samRequestsGranted;
      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + result.sourceDocumentsInserted;

      if (result.samQuota) stats.samQuota = result.samQuota;
      if (result.samQuotaBlocked) stats.samQuotaBlocked = true;
      if (result.samRunCapReached) stats.samRunCapReached = true;
      if (result.stopReason) {
        if (shouldStopSamRunForEndpoint('contract-awards', result.stopReason)) {
          samContractAwardsStopReason = result.stopReason;
          recordSamRunStop('contract-awards', result.stopReason, {
            phase: options.phase,
            details: {
              samRequestsGranted: result.samRequestsGranted,
              samRequestsAttempted: result.samRequestsAttempted
            }
          });
        } else if (!samContractAwardsStopReason) {
          samContractAwardsStopReason = result.stopReason;
        }
      }
      stats.samContractAwardsStopReason = samContractAwardsStopReason;

      remainingSamRequests = Math.max(0, remainingSamRequests - result.samRequestsGranted);
      stats.samRunRequestsRemaining = remainingSamRequests;
    };

    const applyOpportunitiesResult = (result: SamOpportunitiesSyncResult, options: { phase: string }) => {
      stats.solicitationIdsEvaluated = Number(stats.solicitationIdsEvaluated || 0) + result.solicitationIdsEvaluated;
      stats.samNoticesUpserted = Number(stats.samNoticesUpserted || 0) + result.noticesUpserted;
      stats.samNoticesFetched = Number(stats.samNoticesFetched || 0) + result.noticesFetched;
      stats.samNoticesExisting = Number(stats.samNoticesExisting || 0) + result.noticesExisting;
      stats.samOpportunitiesVersionRowsFetched =
        Number(stats.samOpportunitiesVersionRowsFetched || 0) + result.versionRowsFetched;
      stats.samOpportunitiesVersionRowsUpserted =
        Number(stats.samOpportunitiesVersionRowsUpserted || 0) + result.versionRowsUpserted;
      stats.samOpportunitiesVersionRowsExisting =
        Number(stats.samOpportunitiesVersionRowsExisting || 0) + result.versionRowsExisting;
      stats.samOpportunitiesProjectionRowsUpserted =
        Number(stats.samOpportunitiesProjectionRowsUpserted || 0) + result.projectionRowsUpserted;
      stats.samOpportunitiesProjectionRowsExisting =
        Number(stats.samOpportunitiesProjectionRowsExisting || 0) + result.projectionRowsExisting;
      stats.samOpportunitiesTruncatedResponses = Number(stats.samOpportunitiesTruncatedResponses || 0) + result.truncatedResponses;
      stats.samOpportunitiesFingerprintSkips =
        Number(stats.samOpportunitiesFingerprintSkips || 0) + result.fingerprintSkips;
      stats.samOpportunitiesPartitionRequestsEvaluated =
        Number(stats.samOpportunitiesPartitionRequestsEvaluated || 0) + result.partitionRequestsEvaluated;
      stats.samRequestsAttempted = Number(stats.samRequestsAttempted || 0) + result.samRequestsAttempted;
      stats.samRequestsGranted = Number(stats.samRequestsGranted || 0) + result.samRequestsGranted;
      stats.samOpportunitiesRequestsAttempted = Number(stats.samOpportunitiesRequestsAttempted || 0) + result.samRequestsAttempted;
      stats.samOpportunitiesRequestsGranted = Number(stats.samOpportunitiesRequestsGranted || 0) + result.samRequestsGranted;
      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + result.sourceDocumentsInserted;
      stats.samOpportunitiesFallbackScopeDistribution = mergeSamScopeDistribution(
        (stats.samOpportunitiesFallbackScopeDistribution as SamScopeDistribution) || createSamScopeDistribution(),
        result.fallbackScopeDistribution
      );

      if (result.samQuota) stats.samQuota = result.samQuota;
      if (result.samQuotaBlocked) stats.samQuotaBlocked = true;
      if (result.samRunCapReached) stats.samRunCapReached = true;
      if (result.stopReason) {
        if (shouldStopSamRunForEndpoint('opportunities', result.stopReason)) {
          samOpportunitiesStopReason = result.stopReason;
          recordSamRunStop('opportunities', result.stopReason, {
            phase: options.phase,
            details: {
              lookupSource: result.lookupSource,
              samRequestsGranted: result.samRequestsGranted,
              samRequestsAttempted: result.samRequestsAttempted
            }
          });
        } else if (!samOpportunitiesStopReason) {
          samOpportunitiesStopReason = result.stopReason;
        }
      }
      stats.samOpportunitiesStopReason = samOpportunitiesStopReason;
      remainingSamRequests = Math.max(0, remainingSamRequests - result.samRequestsGranted);
      stats.samRunRequestsRemaining = remainingSamRequests;
      mergeLookupSource(result.lookupSource);
    };

    const checkpointMetadata = {
      runId,
      ...(bodySamSessionToken ? { samSessionToken: bodySamSessionToken } : {})
    };

    if (runSamContractAwards) {
      await updateCheckpoint(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
        sourceType: 'procurement',
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null,
        metadata: checkpointMetadata
      });
      pushSamStep('sam_checkpoint_running', { checkpoint: CHECKPOINT_SAM_CONTRACT_AWARDS });
    }
    if (runSamOpportunities) {
      await updateCheckpoint(supabase, CHECKPOINT_OPPORTUNITIES, {
        sourceType: 'procurement',
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null,
        metadata: checkpointMetadata
      });
      pushSamStep('sam_checkpoint_running', { checkpoint: CHECKPOINT_OPPORTUNITIES });
    }

    if ((runSamContractAwards || runSamOpportunities) && !samApiKey) {
      recordSamGuardrail('sam_config:missing_sam_api_key', 'missing_sam_api_key', false);
    } else if (runSamContractAwards || runSamOpportunities) {
      const contractAwardsApiUrl = runSamContractAwards
        ? await readStringSetting(supabase, 'artemis_sam_contract_awards_api_url', 'https://api.sam.gov/contract-awards/v1/search')
        : null;
      const opportunityApiUrl = runSamOpportunities
        ? await readStringSetting(supabase, 'artemis_sam_opportunities_api_url', 'https://api.sam.gov/opportunities/v2/search')
        : null;
      const lookbackDays = runSamOpportunities
        ? Math.max(
            30,
            Math.min(
              SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS,
              Math.trunc(await readNumberSetting(supabase, 'artemis_sam_lookback_days', DEFAULT_LOOKBACK_DAYS))
            )
          )
        : DEFAULT_LOOKBACK_DAYS;
      const samQueryPolicy: SamQueryPolicy = {
        emptyCooldownDays: Math.max(
          1,
          Math.min(
            90,
            Math.trunc(
              await readNumberSetting(
                supabase,
                SETTING_SAM_QUERY_COOLDOWN_DAYS_EMPTY,
                DEFAULT_SAM_QUERY_COOLDOWN_DAYS_EMPTY
              )
            )
          )
        ),
        duplicateCooldownHours: Math.max(
          1,
          Math.min(
            168,
            Math.trunc(
              await readNumberSetting(
                supabase,
                SETTING_SAM_QUERY_COOLDOWN_HOURS_DUPLICATE,
                DEFAULT_SAM_QUERY_COOLDOWN_HOURS_DUPLICATE
              )
            )
          )
        ),
        retryBackoffBaseMinutes: Math.max(
          1,
          Math.min(
            720,
            Math.trunc(
              await readNumberSetting(
                supabase,
                SETTING_SAM_QUERY_RETRY_BACKOFF_BASE_MINUTES,
                DEFAULT_SAM_QUERY_RETRY_BACKOFF_BASE_MINUTES
              )
            )
          )
        )
      };
      const samOpportunitiesPartitionEnabled = runSamOpportunities
        ? await readBooleanSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_PARTITION_ENABLED,
            DEFAULT_SAM_OPPORTUNITIES_PARTITION_ENABLED
          )
        : false;
      const samOpportunitiesPartitionDays = runSamOpportunities
        ? Math.max(
            7,
            Math.min(
              90,
              Math.trunc(
                await readNumberSetting(
                  supabase,
                  SETTING_SAM_OPPORTUNITIES_PARTITION_DAYS,
                  DEFAULT_SAM_OPPORTUNITIES_PARTITION_DAYS
                )
              )
            )
          )
        : DEFAULT_SAM_OPPORTUNITIES_PARTITION_DAYS;
      const samOpportunitiesApiDeltaOnly = runSamOpportunities
        ? await readBooleanSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_API_DELTA_ONLY,
            DEFAULT_SAM_OPPORTUNITIES_API_DELTA_ONLY
          )
        : DEFAULT_SAM_OPPORTUNITIES_API_DELTA_ONLY;
      const samOpportunitiesDataServicesEnabled = runSamOpportunities
        ? await readBooleanSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED,
            DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED
          )
        : false;
      const samOpportunitiesDataServicesActiveUrl = runSamOpportunities
        ? await readStringSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ACTIVE_URL,
            DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ACTIVE_URL
          )
        : '';
      const samOpportunitiesDataServicesArchivedUrl = runSamOpportunities
        ? await readStringSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_ARCHIVED_URL,
            DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ARCHIVED_URL
          )
        : '';
      const samOpportunitiesDataServicesApiKeyParam = runSamOpportunities
        ? await readStringSetting(
            supabase,
            SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM,
            DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM
          )
        : DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM;
      const samOpportunitiesDataServicesTimeoutMs = runSamOpportunities
        ? Math.max(
            10_000,
            Math.min(
              600_000,
              Math.trunc(
                await readNumberSetting(
                  supabase,
                  SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_TIMEOUT_MS,
                  DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_TIMEOUT_MS
                )
              )
            )
          )
        : DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_TIMEOUT_MS;
      const samOpportunitiesDataServicesMaxFilesPerSourcePerRun = runSamOpportunities
        ? Math.max(
            1,
            Math.min(
              10,
              Math.trunc(
                await readNumberSetting(
                  supabase,
                  SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN,
                  DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN
                )
              )
            )
          )
        : DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILES_PER_SOURCE_PER_RUN;
      const samOpportunitiesDataServicesMaxFileBytes = runSamOpportunities
        ? Math.max(
            5_000_000,
            Math.min(
              2_000_000_000,
              Math.trunc(
                await readNumberSetting(
                  supabase,
                  SETTING_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES,
                  DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES
                )
              )
            )
          )
        : DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_MAX_FILE_BYTES;
      const samEntitySyncEnabled = runSamContractAwards || runSamOpportunities
        ? await readBooleanSetting(supabase, SETTING_SAM_ENTITY_SYNC_ENABLED, DEFAULT_SAM_ENTITY_SYNC_ENABLED)
        : false;
      const samContractAwardsIncludeDeleted = runSamContractAwards
        ? await readBooleanSetting(
            supabase,
            SETTING_SAM_CONTRACT_AWARDS_INCLUDE_DELETED,
            DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_DELETED
          )
        : DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_DELETED;
      const samContractAwardsIncludeSections = runSamContractAwards
        ? parseSamContractAwardSections(
            await readStringSetting(
              supabase,
              SETTING_SAM_CONTRACT_AWARDS_INCLUDE_SECTIONS,
              DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_SECTIONS
            )
          )
        : parseSamContractAwardSections(DEFAULT_SAM_CONTRACT_AWARDS_INCLUDE_SECTIONS);
      const samContractAwardsExtractEnabled = runSamContractAwards
        ? await readBooleanSetting(
            supabase,
            SETTING_SAM_CONTRACT_AWARDS_EXTRACT_ENABLED,
            DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_ENABLED
          )
        : false;
      const configuredSamContractAwardsExtractFormat = runSamContractAwards
        ? parseSamExtractFormat(
            await readStringSetting(
              supabase,
              SETTING_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT,
              DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT
            )
          )
        : DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT;
      // CSV extract ingestion is not implemented in this worker; coerce to JSON for deterministic behavior.
      const samContractAwardsExtractFormat: SamExtractFormat = 'json';
      const samContractAwardsExtractPollLimit = runSamContractAwards
        ? Math.max(
            1,
            Math.min(
              SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT_MAX,
              Math.trunc(
                await readNumberSetting(
                  supabase,
                  SETTING_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT,
                  DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT
                )
              )
            )
          )
        : DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT;
      stats.samQueryPolicy = samQueryPolicy;
      stats.samOpportunitiesPartitionEnabled = samOpportunitiesPartitionEnabled;
      stats.samOpportunitiesPartitionDays = samOpportunitiesPartitionDays;
      stats.samOpportunitiesApiDeltaOnly = samOpportunitiesApiDeltaOnly;
      stats.samOpportunitiesDataServicesEnabled = samOpportunitiesDataServicesEnabled;
      stats.samOpportunitiesDataServicesMaxFilesPerSourcePerRun = samOpportunitiesDataServicesMaxFilesPerSourcePerRun;
      stats.samOpportunitiesDataServicesMaxFileBytes = samOpportunitiesDataServicesMaxFileBytes;
      stats.samEntitySyncEnabled = samEntitySyncEnabled;
      stats.samContractAwardsIncludeDeleted = samContractAwardsIncludeDeleted;
      stats.samContractAwardsIncludeSections = samContractAwardsIncludeSections;
      stats.samAwardsExtractEnabled = samContractAwardsExtractEnabled;
      stats.samAwardsExtractFormat = samContractAwardsExtractFormat;
      stats.samAwardsExtractPollLimit = samContractAwardsExtractPollLimit;
      if (runSamContractAwards && configuredSamContractAwardsExtractFormat !== samContractAwardsExtractFormat) {
        pushSamStep('sam_awards_extract_format_coerced', {
          configuredFormat: configuredSamContractAwardsExtractFormat,
          appliedFormat: samContractAwardsExtractFormat
        });
      }

      if (samEntitySyncEnabled && (runSamContractAwards || runSamOpportunities)) {
        try {
          const entitySync = await syncSamEntityRegistry(supabase, {
            apiKey: samApiKey,
            sessionToken: bodySamSessionToken
          });
          stats.samEntitySync = entitySync;
          stats.samEntityRequestsAttempted =
            Number(stats.samEntityRequestsAttempted || 0) + Number(entitySync.requestsAttempted || 0);
          stats.samEntityRequestsGranted =
            Number(stats.samEntityRequestsGranted || 0) + Number(entitySync.requestsGranted || 0);
          stats.samRequestsAttempted = Number(stats.samRequestsAttempted || 0) + Number(entitySync.requestsAttempted || 0);
          stats.samRequestsGranted = Number(stats.samRequestsGranted || 0) + Number(entitySync.requestsGranted || 0);
          remainingSamRequests = Math.max(0, remainingSamRequests - Number(entitySync.requestsGranted || 0));
          stats.samRunRequestsRemaining = remainingSamRequests;
          if (entitySync.samQuota) stats.samQuota = entitySync.samQuota;
          if (entitySync.quotaBlocked) {
            stats.samQuotaBlocked = true;
            recordSamGuardrail('sam_entity_sync:sam_quota_blocked', 'sam_quota_blocked', false);
            if (!stats.samRequestStopReason) stats.samRequestStopReason = 'sam_quota_blocked';
            if (!stats.samSkippedReason) stats.samSkippedReason = 'sam_quota_blocked';
          }
          if (entitySync.stopReason && shouldStopSamRun(entitySync.stopReason)) {
            const stopReason = String(entitySync.stopReason);
            if (!stats.samRequestStopReason) stats.samRequestStopReason = stopReason;
            if (!stats.samSkippedReason) stats.samSkippedReason = stopReason;
          }
          stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + entitySync.sourceDocumentsInserted;
          pushSamStep('sam_entity_sync', {
            enabled: entitySync.enabled,
            skipped: entitySync.skipped,
            skippedReason: entitySync.skippedReason,
            aliasesEvaluated: entitySync.aliasesEvaluated,
            aliasesSucceeded: entitySync.aliasesSucceeded,
            aliasesErrored: entitySync.aliasesErrored,
            requestsAttempted: entitySync.requestsAttempted,
            requestsGranted: entitySync.requestsGranted,
            quotaBlocked: entitySync.quotaBlocked,
            stopReason: entitySync.stopReason,
            entitiesExtracted: entitySync.entitiesExtracted,
            entitiesUpserted: entitySync.entitiesUpserted,
            sourceDocumentsInserted: entitySync.sourceDocumentsInserted,
            remainingSamRequests
          });
        } catch (error) {
          const message = stringifyError(error);
          (stats.errors as Array<{ step: string; error: string }>).push({
            step: 'sam_entity_sync',
            error: message
          });
          pushSamStep('sam_entity_sync_error', { error: message });
        }
      }

      let samOpportunitiesDataServicesSynced = false;
      const applyOpportunitiesDataServicesResult = (result: SamOpportunitiesDataServicesSyncResult) => {
        stats.samOpportunitiesDataServicesSync = result;
        stats.samOpportunitiesDataServicesSourcesEvaluated =
          Number(stats.samOpportunitiesDataServicesSourcesEvaluated || 0) + result.sourcesEvaluated;
        stats.samOpportunitiesDataServicesSourcesSucceeded =
          Number(stats.samOpportunitiesDataServicesSourcesSucceeded || 0) + result.sourcesSucceeded;
        stats.samOpportunitiesDataServicesSourcesErrored =
          Number(stats.samOpportunitiesDataServicesSourcesErrored || 0) + result.sourcesErrored;
        stats.samOpportunitiesDataServicesNoticesFetched =
          Number(stats.samOpportunitiesDataServicesNoticesFetched || 0) + result.noticesFetched;
        stats.samOpportunitiesDataServicesVersionRowsFetched =
          Number(stats.samOpportunitiesDataServicesVersionRowsFetched || 0) + result.versionsFetched;
        stats.samOpportunitiesDataServicesVersionRowsUpserted =
          Number(stats.samOpportunitiesDataServicesVersionRowsUpserted || 0) + result.versionsUpserted;
        stats.samOpportunitiesDataServicesVersionRowsExisting =
          Number(stats.samOpportunitiesDataServicesVersionRowsExisting || 0) + result.versionsExisting;
        stats.samOpportunitiesDataServicesProjectionRowsUpserted =
          Number(stats.samOpportunitiesDataServicesProjectionRowsUpserted || 0) + result.projectionRowsUpserted;
        stats.samOpportunitiesDataServicesProjectionRowsExisting =
          Number(stats.samOpportunitiesDataServicesProjectionRowsExisting || 0) + result.projectionRowsExisting;
        stats.samNoticesFetched = Number(stats.samNoticesFetched || 0) + result.noticesFetched;
        stats.samOpportunitiesVersionRowsFetched =
          Number(stats.samOpportunitiesVersionRowsFetched || 0) + result.versionsFetched;
        stats.samOpportunitiesVersionRowsUpserted =
          Number(stats.samOpportunitiesVersionRowsUpserted || 0) + result.versionsUpserted;
        stats.samOpportunitiesVersionRowsExisting =
          Number(stats.samOpportunitiesVersionRowsExisting || 0) + result.versionsExisting;
        stats.samOpportunitiesProjectionRowsUpserted =
          Number(stats.samOpportunitiesProjectionRowsUpserted || 0) + result.projectionRowsUpserted;
        stats.samOpportunitiesProjectionRowsExisting =
          Number(stats.samOpportunitiesProjectionRowsExisting || 0) + result.projectionRowsExisting;
        stats.samNoticesUpserted = Number(stats.samNoticesUpserted || 0) + result.projectionRowsUpserted;
        stats.samNoticesExisting = Number(stats.samNoticesExisting || 0) + result.projectionRowsExisting;
        stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + result.sourceDocumentsInserted;
      };

      const runContractAwardsPass = async (
        maxRequests: number,
        options: { phase: string; targetScopes?: readonly ProgramScope[] }
      ): Promise<SamContractAwardsBackfillResult | null> => {
        const normalizedTargetScopes = normalizeProgramScopeOrder(options.targetScopes || TARGET_SAM_PROGRAM_SCOPES);
        if (!runSamContractAwards || !contractAwardsApiUrl) {
          logSamEndpointDecision('contract-awards', options.phase, 'endpoint_disabled', {
            configured: false,
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests
          });
          return null;
        }
        if (samRunStopReason || samGuardrailTriggered) {
          logSamEndpointDecision('contract-awards', options.phase, 'skip', 'sam_guardrail_triggered', {
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests,
            stoppedByEndpoint: samRunStopByEndpoint,
            existingStopReason: samRunStopReason || stringOrNull(stats.samRequestStopReason),
            stopReason: stringOrNull(stats.samRequestStopReason)
          });
          return null;
        }
        if (maxRequests < 1) {
          stats.samRunCapReached = true;
          recordSamGuardrail('sam_contract_awards:run_cap_exhausted', 'sam_run_cap_exhausted', false);
          logSamEndpointDecision('contract-awards', options.phase, 'skip', 'max_requests_lt_1', {
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests
          });
          return null;
        }
        logSamEndpointDecision('contract-awards', options.phase, 'start', null, {
          maxRequests,
          targetScopes: normalizedTargetScopes,
          remainingSamRequestsBefore: remainingSamRequests
        });
        const result = await backfillSolicitationsFromSamContractAwards(supabase, {
          apiKey: samApiKey,
          apiUrl: contractAwardsApiUrl,
          maxRequests,
          sessionToken: bodySamSessionToken,
          stopOnEmptyOrError: enforceStopOnEmptyOrError,
          targetScopes: normalizedTargetScopes,
          excludedContractIds: targetedContractIds,
          queryPolicy: samQueryPolicy,
          includeDeletedStatus: samContractAwardsIncludeDeleted,
          includeSections: samContractAwardsIncludeSections,
          extract: {
            enabled: samContractAwardsExtractEnabled,
            format: samContractAwardsExtractFormat,
            pollLimit: samContractAwardsExtractPollLimit
          }
        });
        pushSamStep('sam_contract_awards_pass_end', {
          phase: options.phase,
          targetScopes: normalizedTargetScopes,
          stopReason: result.stopReason,
          samRequestsAttempted: result.samRequestsAttempted,
          samRequestsGranted: result.samRequestsGranted,
          candidateScopeDistribution: result.candidateScopeDistribution,
          contractsEvaluated: result.contractsEvaluated,
          contractsBackfilled: result.contractsBackfilled,
          actionsBackfilled: result.actionsBackfilled,
          awardRowsFetched: result.awardRowsFetched,
          awardRowsUpserted: result.awardRowsUpserted,
          awardRowsExisting: result.awardRowsExisting,
          extract: {
            enabled: result.extractEnabled,
            format: result.extractFormat,
            jobsRequested: result.extractJobsRequested,
            jobsPolled: result.extractJobsPolled,
            jobsApplied: result.extractJobsApplied,
            rowsFetched: result.extractRowsFetched,
            rowsUpserted: result.extractRowsUpserted
          }
        });
        logSamEndpointDecision('contract-awards', options.phase, 'end', result.stopReason || null, {
          phase: options.phase,
          targetScopes: normalizedTargetScopes,
          stopReason: result.stopReason,
          samRequestsAttempted: result.samRequestsAttempted,
          samRequestsGranted: result.samRequestsGranted,
          contractsEvaluated: result.contractsEvaluated,
          contractsBackfilled: result.contractsBackfilled,
          actionsBackfilled: result.actionsBackfilled,
          awardRowsFetched: result.awardRowsFetched,
          candidateScopeDistribution: result.candidateScopeDistribution,
          awardRowsUpserted: result.awardRowsUpserted,
          awardRowsExisting: result.awardRowsExisting,
          extractEnabled: result.extractEnabled,
          extractFormat: result.extractFormat,
          extractJobsRequested: result.extractJobsRequested,
          extractJobsPolled: result.extractJobsPolled,
          extractJobsApplied: result.extractJobsApplied,
          extractRowsUpserted: result.extractRowsUpserted
        });
        if (result.stopReason) {
          logSamEndpointDecision('contract-awards', options.phase, 'endpoint_end_with_stop_reason', result.stopReason, {
            samRequestsGranted: result.samRequestsGranted,
            samRequestsAttempted: result.samRequestsAttempted
          });
        }
        applyContractAwardsResult(result, options);
        return result;
      };

      const runOpportunitiesPass = async (
        maxRequests: number,
        options: { phase: string; targetScopes?: readonly ProgramScope[] },
        prioritizedSolicitationIds: string[] = []
      ): Promise<SamOpportunitiesSyncResult | null> => {
        const normalizedTargetScopes = normalizeProgramScopeOrder(options.targetScopes || TARGET_SAM_PROGRAM_SCOPES);
        if (!runSamOpportunities || !opportunityApiUrl) {
          logSamEndpointDecision('opportunities', options.phase, 'skip', 'endpoint_disabled', {
            configured: false,
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests
          });
          return null;
        }
        if (samRunStopReason || samGuardrailTriggered) {
          logSamEndpointDecision('opportunities', options.phase, 'skip', 'sam_guardrail_triggered', {
            stoppedByEndpoint: samRunStopByEndpoint,
            existingStopReason: samRunStopReason || stringOrNull(stats.samRequestStopReason),
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests,
            stopReason: stringOrNull(stats.samRequestStopReason)
          });
          return null;
        }
        const opportunitiesAllowFallbackLookup =
          allowFallbackLookup && !(samOpportunitiesDataServicesEnabled && samOpportunitiesApiDeltaOnly);
        if (samOpportunitiesDataServicesEnabled && !samOpportunitiesDataServicesSynced) {
          const dataServicesResult = await syncSamOpportunitiesDataServicesSnapshots(supabase, {
            apiKey: samApiKey,
            sessionToken: bodySamSessionToken,
            activeUrl: samOpportunitiesDataServicesActiveUrl,
            archivedUrl: samOpportunitiesDataServicesArchivedUrl,
            apiKeyParam: samOpportunitiesDataServicesApiKeyParam,
            timeoutMs: samOpportunitiesDataServicesTimeoutMs,
            maxFilesPerSourcePerRun: samOpportunitiesDataServicesMaxFilesPerSourcePerRun,
            maxFileBytes: samOpportunitiesDataServicesMaxFileBytes
          });
          samOpportunitiesDataServicesSynced = true;
          applyOpportunitiesDataServicesResult(dataServicesResult);
          pushSamStep('sam_opportunities_data_services_sync', {
            phase: options.phase,
            enabled: dataServicesResult.enabled,
            skipped: dataServicesResult.skipped,
            skippedReason: dataServicesResult.skippedReason,
            maxFilesPerSourcePerRun: dataServicesResult.maxFilesPerSourcePerRun,
            maxFileBytes: dataServicesResult.maxFileBytes,
            sourcesEvaluated: dataServicesResult.sourcesEvaluated,
            sourcesSucceeded: dataServicesResult.sourcesSucceeded,
            sourcesErrored: dataServicesResult.sourcesErrored,
            noticesFetched: dataServicesResult.noticesFetched,
            versionsFetched: dataServicesResult.versionsFetched,
            versionsUpserted: dataServicesResult.versionsUpserted,
            projectionRowsUpserted: dataServicesResult.projectionRowsUpserted,
            manifestEntriesDiscovered: dataServicesResult.manifestEntriesDiscovered,
            manifestEntriesScanned: dataServicesResult.manifestEntriesScanned,
            manifestFilesDownloaded: dataServicesResult.manifestFilesDownloaded,
            manifestFilesSkippedLarge: dataServicesResult.manifestFilesSkippedLarge,
            manifestFilesDeferred: dataServicesResult.manifestFilesDeferred,
            sourceDocumentsInserted: dataServicesResult.sourceDocumentsInserted,
            errors: dataServicesResult.errors
          });
        }
        if (maxRequests < 1) {
          if (samOpportunitiesDataServicesEnabled && samOpportunitiesApiDeltaOnly) {
            logSamEndpointDecision('opportunities', options.phase, 'skip', 'max_requests_lt_1_data_services_only', {
              targetScopes: normalizedTargetScopes,
              remainingSamRequestsBefore: remainingSamRequests
            });
            return null;
          }
          stats.samRunCapReached = true;
          recordSamGuardrail('sam_opportunities:run_cap_exhausted', 'sam_run_cap_exhausted', false);
          logSamEndpointDecision('opportunities', options.phase, 'skip', 'max_requests_lt_1', {
            targetScopes: normalizedTargetScopes,
            remainingSamRequestsBefore: remainingSamRequests
          });
          return null;
        }
        logSamEndpointDecision('opportunities', options.phase, 'start', null, {
          maxRequests,
          targetScopes: normalizedTargetScopes,
          remainingSamRequestsBefore: remainingSamRequests,
          allowFallbackLookup: opportunitiesAllowFallbackLookup,
          apiDeltaOnly: samOpportunitiesApiDeltaOnly,
        });
        const prioritizedIdsSource = prioritizedSolicitationIds.length > 0
          ? prioritizedSolicitationIds
          : Array.from(targetedSolicitationIds);
        const normalizedPrioritizedSolicitationIds = Array.from(
          new Set(
            prioritizedIdsSource.filter(
              (value) => typeof value === 'string' && value.length > 0
            )
          )
        );
        const result = await runSamOpportunitiesSync(supabase, {
          apiKey: samApiKey,
          apiUrl: opportunityApiUrl,
          lookbackDays,
          maxRequests,
          prioritizedSolicitationIds: normalizedPrioritizedSolicitationIds,
          allowFallbackLookup: opportunitiesAllowFallbackLookup,
          stopOnEmptyOrError: enforceStopOnEmptyOrError,
          sessionToken: bodySamSessionToken,
          targetScopes: normalizedTargetScopes,
          queryPolicy: samQueryPolicy,
          opportunitiesPartitionEnabled: samOpportunitiesPartitionEnabled,
          opportunitiesPartitionDays: samOpportunitiesPartitionDays
        });
        pushSamStep('sam_opportunities_pass_end', {
          phase: options.phase,
          targetScopes: normalizedTargetScopes,
          stopReason: result.stopReason,
          samRequestsAttempted: result.samRequestsAttempted,
          samRequestsGranted: result.samRequestsGranted,
          solicitationIdsEvaluated: result.solicitationIdsEvaluated,
          noticesFetched: result.noticesFetched,
          noticesUpserted: result.noticesUpserted,
          noticesExisting: result.noticesExisting,
          fallbackScopeDistribution: result.fallbackScopeDistribution,
          lookupSource: result.lookupSource
        });
        logSamEndpointDecision('opportunities', options.phase, 'end', result.stopReason || null, {
          phase: options.phase,
          targetScopes: normalizedTargetScopes,
          stopReason: result.stopReason,
          samRequestsAttempted: result.samRequestsAttempted,
          samRequestsGranted: result.samRequestsGranted,
          solicitationIdsEvaluated: result.solicitationIdsEvaluated,
          noticesFetched: result.noticesFetched,
          noticesUpserted: result.noticesUpserted,
          noticesExisting: result.noticesExisting,
          fallbackScopeDistribution: result.fallbackScopeDistribution,
          lookupSource: result.lookupSource
        });
        if (result.stopReason) {
          logSamEndpointDecision('opportunities', options.phase, 'endpoint_end_with_stop_reason', result.stopReason, {
            lookupSource: result.lookupSource,
            samRequestsGranted: result.samRequestsGranted,
            samRequestsAttempted: result.samRequestsAttempted
          });
        }
        applyOpportunitiesResult(result, options);
        return result;
      };

      const singlePassPerEndpoint = bodySamSinglePassPerEndpoint;
      const probeRequiredEndpoints = (runSamContractAwards ? 1 : 0) + (runSamOpportunities ? 1 : 0);
      const perScopeProbeRequests = shouldProbeBothEndpoints ? TARGET_SAM_PROGRAM_SCOPES.length * probeRequiredEndpoints : 0;
      const requiredProbeRequests = shouldProbeBothEndpoints ? perScopeProbeRequests : 0;

      const runPerScopeInitialPass = async (phaseBase: string, maxRequestsPerScope: number) => {
        for (const programScope of TARGET_SAM_PROGRAM_SCOPES) {
          const phase = `${phaseBase}:${programScope}`;
          const requested = Math.min(maxRequestsPerScope, remainingSamRequests);
          const scopedTargets = [programScope] as const;
          const contractAwardsResult = runSamContractAwards
            ? await runContractAwardsPass(requested, { phase, targetScopes: scopedTargets })
            : null;
          const scopeTargetedSolicitations = contractAwardsResult?.targetedSolicitationIds || [];
          const scopeTargets = scopedTargets;
          if (runSamOpportunities && !samRunStopReason && !samGuardrailTriggered) {
            await runOpportunitiesPass(requested, { phase, targetScopes: scopeTargets }, scopeTargetedSolicitations);
          } else if (runSamOpportunities) {
            logSamEndpointDecision('opportunities', phase, 'skip', 'sam_guardrail_triggered', {
              targetScopes: scopeTargets,
              remainingSamRequestsBefore: remainingSamRequests,
              stoppedByEndpoint: samRunStopByEndpoint,
              stopReason: stringOrNull(stats.samRequestStopReason)
            });
          }

          if (samRunStopReason || samGuardrailTriggered) {
            break;
          }
        }
      };

      if (shouldProbeBothEndpoints && remainingSamRequests < requiredProbeRequests) {
        stats.samRunCapReached = true;
        recordSamGuardrail('sam_probe:insufficient_run_cap', 'sam_probe_insufficient_run_cap', false);
        recordSamRunStop('opportunities', 'sam_probe_insufficient_run_cap', {
          phase: 'probe',
          details: {
            remainingSamRequests,
            requiredProbeRequests
          }
        });
        const probeStopReasonsList = getSamProbeStopReasons();
        if (!probeStopReasonsList.includes('sam_probe:insufficient_run_cap')) {
          probeStopReasonsList.push('sam_probe:insufficient_run_cap');
        }
        pushSamStep('sam_probe_insufficient_run_cap', {
          remainingSamRequests,
          requiredRequests: requiredProbeRequests
        });
      } else {
        const initialPhase = shouldProbeBothEndpoints ? 'probe' : 'single';
        if (shouldProbeBothEndpoints) {
          await runPerScopeInitialPass(initialPhase, 1);
        } else if (runSamContractAwards) {
          const initialAwardsRequests = singlePassPerEndpoint ? Math.min(1, remainingSamRequests) : remainingSamRequests;
          await runContractAwardsPass(initialAwardsRequests, { phase: initialPhase });
        }

        if (runSamOpportunities && !shouldProbeBothEndpoints) {
          const initialOpportunitiesRequests = singlePassPerEndpoint
            ? Math.min(1, remainingSamRequests)
            : remainingSamRequests;
          await runOpportunitiesPass(
            initialOpportunitiesRequests,
            { phase: initialPhase },
            Array.from(targetedSolicitationIds)
          );
        } else if (runSamOpportunities && shouldProbeBothEndpoints && !samRunStopReason && !samGuardrailTriggered) {
          // already handled in per-scope initial probe
        } else if (runSamOpportunities) {
          logSamEndpointDecision('opportunities', initialPhase, 'skip', 'sam_guardrail_triggered', {
            remainingSamRequestsBefore: remainingSamRequests,
            stoppedByEndpoint: samRunStopByEndpoint,
            stopReason: stringOrNull(stats.samRequestStopReason),
            existingStopReason: samRunStopReason || stringOrNull(stats.samRequestStopReason)
          });
        }

        if (shouldProbeBothEndpoints && probeStopReasons.length > 0) {
          samGuardrailTriggered = true;
          samGuardrailReason = probeStopReasons.join('|');
          stats.samProbeStopReasons = probeStopReasons;
          if (!stats.samSkippedReason) stats.samSkippedReason = 'sam_probe_guardrail_triggered';
          pushSamStep('sam_probe_guardrail_triggered', { probeStopReasons });
        }

        if (!samRunStopReason && !samGuardrailTriggered && !singlePassPerEndpoint && remainingSamRequests > 0) {
          if (runSamContractAwards) {
            logSamEndpointDecision('contract-awards', 'remaining', 'start', null, {
              maxRequests: remainingSamRequests,
              remainingSamRequestsBefore: remainingSamRequests
            });
            await runContractAwardsPass(remainingSamRequests, { phase: 'remaining' });
          }
          if (runSamOpportunities && !samRunStopReason && !samGuardrailTriggered && remainingSamRequests > 0) {
            logSamEndpointDecision('opportunities', 'remaining', 'start', null, {
              maxRequests: remainingSamRequests,
              remainingSamRequestsBefore: remainingSamRequests
            });
            await runOpportunitiesPass(remainingSamRequests, { phase: 'remaining' });
          } else if (runSamOpportunities && (samRunStopReason || samGuardrailTriggered)) {
            logSamEndpointDecision(
              'opportunities',
              'remaining',
              'skip',
              'sam_guardrail_triggered',
              {
                remainingSamRequestsBefore: remainingSamRequests,
                stoppedByEndpoint: samRunStopByEndpoint,
                existingStopReason: samRunStopReason || stringOrNull(stats.samRequestStopReason),
                stopReason: stringOrNull(stats.samRequestStopReason)
              }
            );
          }
        }
      }
    }
    await endRunPhase('sam_orchestration', {
      samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
      samRequestsGranted: Number(stats.samRequestsGranted || 0),
      samStopReason: stats.samRequestStopReason || null
    });
    await beginRunPhase('finalize_outputs');

    let finalSamStopReason = stringOrNull(samRunStopReason) || stringOrNull(stats.samRequestStopReason);
    const runCapRequestedForInference = Number(stats.samRunRequestCapRequested || 0);
    const runCapBudgetForInference = Number(stats.samRunRequestCap || 0);
    const runGrantedForInference = Number(stats.samRequestsGranted || 0);
    const runRemainingForInference = Number(stats.samRunRequestsRemaining || remainingSamRequests || 0);
    if (
      !samGuardrailTriggered &&
      runCapRequestedForInference > 0 &&
      runCapBudgetForInference === 0 &&
      runGrantedForInference === 0 &&
      runRemainingForInference === 0 &&
      !finalSamStopReason
    ) {
      recordSamGuardrail('sam_run_cap:run_cap_budget_exhausted', 'sam_run_cap_exhausted', false);
      finalSamStopReason = stringOrNull(stats.samRequestStopReason) || 'sam_run_cap_exhausted';
      if (!stats.samSkippedReason) stats.samSkippedReason = finalSamStopReason;
      if (!samRunStopReason) {
        samRunStopReason = finalSamStopReason;
        samRunStopByEndpoint = null;
        if (!samRunStopStepAt) samRunStopStepAt = new Date().toISOString();
      }
    }

    const hadSamEndpointRequests = Number(stats.samRequestsAttempted || 0) > 0;
    const hadSamEndpointFingerprintSkips =
      Number(stats.samAwardsFingerprintSkips || 0) > 0 || Number(stats.samOpportunitiesFingerprintSkips || 0) > 0;
    const hadSamEndpointActivity = hadSamEndpointRequests || hadSamEndpointFingerprintSkips;
    if (!finalSamStopReason && (runSamContractAwards || runSamOpportunities) && !hadSamEndpointActivity) {
      recordSamGuardrail('sam_run:zero_endpoint_requests', 'sam_no_activity', false);
      finalSamStopReason = stringOrNull(stats.samRequestStopReason) || 'sam_no_activity';
      if (!stats.samSkippedReason) stats.samSkippedReason = finalSamStopReason;
      if (!samRunStopReason) {
        samRunStopReason = finalSamStopReason;
        samRunStopByEndpoint = null;
        if (!samRunStopStepAt) samRunStopStepAt = new Date().toISOString();
      }
    }

    if (!finalSamStopReason && samGuardrailTriggered && remainingSamRequests < 1) {
      finalSamStopReason = 'sam_run_cap_exhausted';
      stats.samRequestStopReason = finalSamStopReason;
      if (!samRunStopReason) {
        samRunStopReason = finalSamStopReason;
        samRunStopByEndpoint = null;
        if (!samRunStopStepAt) samRunStopStepAt = new Date().toISOString();
      }
    }
    const finalSamStopReasons = getSamStopReasons();
    if (samRunStopReason) {
      stats.samRunStopReason = samRunStopReason;
      stats.samRunStoppedByEndpoint = samRunStopByEndpoint || null;
      stats.samRunStoppedAt = samRunStopStepAt;
    }
    if (finalSamStopReason && !finalSamStopReasons.includes(finalSamStopReason)) {
      finalSamStopReasons.push(finalSamStopReason);
    }
    if (shouldTreatSamStopReasonAsGuardrail(finalSamStopReason)) {
      samGuardrailTriggered = true;
      stats.samSkippedReason = stats.samSkippedReason || finalSamStopReason;
      if (!samGuardrailReason) samGuardrailReason = 'sam_guardrail:' + finalSamStopReason;
    }
    if (!samGuardrailReason && stats.samSkippedReason) {
      samGuardrailReason = 'sam_guardrail:' + stats.samSkippedReason;
    }
    if (samGuardrailReason && stats.samGuardrailReason !== samGuardrailReason) {
      stats.samGuardrailReason = samGuardrailReason;
    }
    if (finalSamStopReason) {
      const hasGuardrailTrace = (samStepTrace as Array<Record<string, unknown>>).some(
        (step) =>
          step.step === 'sam_guardrail_reason' &&
          stringOrNull(step.stopReason as unknown) === finalSamStopReason
      );
      if (!hasGuardrailTrace) {
        pushSamStep('sam_guardrail_reason', {
          guardrailReason: samGuardrailReason || finalSamStopReason,
          stopReason: finalSamStopReason,
          deferred: false,
          finalizationPass: true
        });
      }
    }


    if (runSamContractAwards) {
      await updateCheckpoint(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
        sourceType: 'procurement',
        status: 'complete',
        recordsIngested: Number(stats.samAwardsRowsUpserted || 0),
        endedAt: new Date().toISOString(),
        lastError: null,
        metadata: {
          ...checkpointMetadata,
          contractsEvaluated: stats.samAwardsContractsEvaluated,
          contractsBackfilled: stats.samAwardsContractsBackfilled,
          actionsBackfilled: stats.samAwardsActionsBackfilled,
          awardRowsUpserted: stats.samAwardsRowsUpserted,
          awardRowsFetched: stats.samAwardRowsFetched,
          awardRowsExisting: stats.samAwardRowsExisting,
          ambiguousContracts: stats.samAwardsAmbiguousContracts,
          solicitationIdsBackfilled: stats.samAwardsSolicitationIdsBackfilled,
          truncatedResponses: stats.samAwardsTruncatedResponses,
          samRequestsAttempted: stats.samAwardsRequestsAttempted,
          samRequestsGranted: stats.samAwardsRequestsGranted,
          fingerprintSkips: stats.samAwardsFingerprintSkips || 0,
          includeDeletedStatus: stats.samContractAwardsIncludeDeleted ?? null,
          includeSections: stats.samContractAwardsIncludeSections || [],
          extractEnabled: stats.samAwardsExtractEnabled ?? false,
          extractFormat: stats.samAwardsExtractFormat || DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_FORMAT,
          extractPollLimit: stats.samAwardsExtractPollLimit || DEFAULT_SAM_CONTRACT_AWARDS_EXTRACT_POLL_LIMIT,
          extractJobsRequested: stats.samAwardsExtractJobsRequested || 0,
          extractJobsSkipped: stats.samAwardsExtractJobsSkipped || 0,
          extractJobsPolled: stats.samAwardsExtractJobsPolled || 0,
          extractJobsReady: stats.samAwardsExtractJobsReady || 0,
          extractJobsApplied: stats.samAwardsExtractJobsApplied || 0,
          extractJobsFailed: stats.samAwardsExtractJobsFailed || 0,
          extractRowsFetched: stats.samAwardsExtractRowsFetched || 0,
          extractRowsUpserted: stats.samAwardsExtractRowsUpserted || 0,
          extractRowsExisting: stats.samAwardsExtractRowsExisting || 0,
          entitySync: stats.samEntitySync || null,
          samQuota: stats.samQuota || null,
          candidateScopeDistribution: stats.samAwardCandidateScopeDistribution || null,
          stopReason: samContractAwardsStopReason || finalSamStopReason,
          samRequestStopReason: finalSamStopReason || null,
          samRunStopReason: samRunStopReason || finalSamStopReason || null,
          samRunStoppedByEndpoint: samRunStopByEndpoint || null,
          samRunStoppedAt: samRunStopStepAt || null,
          samStopReasons: finalSamStopReasons,
          guardrailReason: samGuardrailReason || null,
          skippedReason: stats.samSkippedReason || null,
          probeBothEndpointsFirst: shouldProbeBothEndpoints,
          probeStopReasons: getSamProbeStopReasons()
        }
      });
    }

    if (runSamOpportunities) {
      await updateCheckpoint(supabase, CHECKPOINT_OPPORTUNITIES, {
        sourceType: 'procurement',
        status: 'complete',
        recordsIngested: Number(stats.samNoticesUpserted || 0),
        endedAt: new Date().toISOString(),
        lastError: null,
        metadata: {
          ...checkpointMetadata,
          solicitationIdsEvaluated: stats.solicitationIdsEvaluated,
          lookupSource: stats.samLookupSource || null,
          noticesFetched: stats.samNoticesFetched,
          noticesExisting: stats.samNoticesExisting,
          versionRowsFetched: stats.samOpportunitiesVersionRowsFetched || 0,
          versionRowsUpserted: stats.samOpportunitiesVersionRowsUpserted || 0,
          versionRowsExisting: stats.samOpportunitiesVersionRowsExisting || 0,
          projectionRowsUpserted: stats.samOpportunitiesProjectionRowsUpserted || 0,
          projectionRowsExisting: stats.samOpportunitiesProjectionRowsExisting || 0,
          truncatedResponses: stats.samOpportunitiesTruncatedResponses,
          samRequestsAttempted: stats.samOpportunitiesRequestsAttempted,
          samRequestsGranted: stats.samOpportunitiesRequestsGranted,
          fingerprintSkips: stats.samOpportunitiesFingerprintSkips || 0,
          partitionRequestsEvaluated: stats.samOpportunitiesPartitionRequestsEvaluated || 0,
          apiDeltaOnly: stats.samOpportunitiesApiDeltaOnly ?? DEFAULT_SAM_OPPORTUNITIES_API_DELTA_ONLY,
          dataServicesEnabled: stats.samOpportunitiesDataServicesEnabled ?? DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_ENABLED,
          dataServicesSync: stats.samOpportunitiesDataServicesSync || null,
          dataServicesSourcesEvaluated: stats.samOpportunitiesDataServicesSourcesEvaluated || 0,
          dataServicesSourcesSucceeded: stats.samOpportunitiesDataServicesSourcesSucceeded || 0,
          dataServicesSourcesErrored: stats.samOpportunitiesDataServicesSourcesErrored || 0,
          dataServicesNoticesFetched: stats.samOpportunitiesDataServicesNoticesFetched || 0,
          dataServicesVersionRowsFetched: stats.samOpportunitiesDataServicesVersionRowsFetched || 0,
          dataServicesVersionRowsUpserted: stats.samOpportunitiesDataServicesVersionRowsUpserted || 0,
          dataServicesVersionRowsExisting: stats.samOpportunitiesDataServicesVersionRowsExisting || 0,
          dataServicesProjectionRowsUpserted: stats.samOpportunitiesDataServicesProjectionRowsUpserted || 0,
          dataServicesProjectionRowsExisting: stats.samOpportunitiesDataServicesProjectionRowsExisting || 0,
          samQuota: stats.samQuota || null,
          fallbackScopeDistribution: stats.samOpportunitiesFallbackScopeDistribution || null,
          stopReason: samOpportunitiesStopReason || finalSamStopReason,
          samRequestStopReason: finalSamStopReason || null,
          samRunStopReason: samRunStopReason || finalSamStopReason || null,
          samRunStoppedByEndpoint: samRunStopByEndpoint || null,
          samRunStoppedAt: samRunStopStepAt || null,
          samStopReasons: finalSamStopReasons,
          guardrailReason: samGuardrailReason || null,
          skippedReason: stats.samSkippedReason || null,
          skippedBecause: samGuardrailTriggered ? samGuardrailReason : null,
          probeBothEndpointsFirst: shouldProbeBothEndpoints,
          probeStopReasons: getSamProbeStopReasons()
        }
      });
    }

    const autoDisableReason = stringOrNull(samGuardrailReason) || finalSamStopReason || null;
    if (disableJobOnGuardrail && samGuardrailTriggered && autoDisableReason) {
      pushSamStep('sam_guardrail_auto_disable', { reason: autoDisableReason, stopReasons: finalSamStopReasons });
      await disableArtemisContractsJob(supabase, autoDisableReason, {
        runId,
        stage,
        samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
        samRequestsGranted: Number(stats.samRequestsGranted || 0),
        samAwardsRowsUpserted: Number(stats.samAwardsRowsUpserted || 0),
        samNoticesUpserted: Number(stats.samNoticesUpserted || 0)
      });
      stats.jobAutoDisabled = true;
      stats.jobAutoDisabledReason = autoDisableReason;
    }

    const refreshDocId = await insertSourceDocument(supabase, {
      sourceKey: CHECKPOINT_NORMALIZED,
      sourceType: 'procurement',
      url: 'https://api.sam.gov',
      title: 'Artemis contract story ingest refresh',
      summary: `Normalized ${Number(stats.normalizedContractsUpserted || 0)} contracts and ${Number(stats.normalizedActionsUpserted || 0)} actions.`,
      announcedTime: new Date().toISOString(),
      contentType: 'application/json',
      raw: { stats }
    });
    stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;

    await upsertTimelineEvent(supabase, {
      fingerprint: ['contract-story-refresh', new Date().toISOString().slice(0, 10)].join('|'),
      missionKey: 'program',
      title: 'Artemis contract story data refreshed',
      summary: 'Normalized contract, action, solicitation, and spending overlays were refreshed for Artemis procurement monitoring.',
      eventTime: null,
      eventTimePrecision: 'unknown',
      announcedTime: new Date().toISOString(),
      sourceType: 'procurement',
      confidence: 'secondary',
      sourceDocumentId: refreshDocId,
      sourceUrl: 'https://api.sam.gov',
      tags: ['procurement', 'contract-story']
    });
    await endRunPhase('finalize_outputs', {
      sourceDocumentsInserted: Number(stats.sourceDocumentsInserted || 0)
    });
    await beginRunPhase('finish_run');
    await endRunPhase('finish_run', { success: true });
    await persistRunProgress({ force: true, phase: null });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, runId, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    const failedPhase = activePhaseName || 'unknown';
    await failRunPhase(failedPhase, message, { runId });
    (stats.errors as Array<{ step: string; error: string }>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, CHECKPOINT_NORMALIZED, {
      sourceType: 'procurement',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);
    await updateCheckpoint(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
      sourceType: 'procurement',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message,
      metadata: {
        runId,
        ...(bodySamSessionToken ? { samSessionToken: bodySamSessionToken } : {})
      }
    }).catch(() => undefined);
    await updateCheckpoint(supabase, CHECKPOINT_OPPORTUNITIES, {
      sourceType: 'procurement',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message,
      metadata: {
        runId,
        ...(bodySamSessionToken ? { samSessionToken: bodySamSessionToken } : {})
      }
    }).catch(() => undefined);

    if (disableJobOnGuardrail) {
      (stats.samStepTrace as Array<Record<string, unknown>>).push({
        at: new Date().toISOString(),
        step: 'sam_fatal_auto_disable',
        reason: `fatal:${message}`
      });
      await disableArtemisContractsJob(supabase, `fatal:${message}`, {
        runId,
        stage: stats.stage || null,
        samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
        samRequestsGranted: Number(stats.samRequestsGranted || 0)
      }).catch(() => undefined);
      stats.jobAutoDisabled = true;
      stats.jobAutoDisabledReason = `fatal:${message}`;
    }

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, runId, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function readIngestMode(value: string | null): IngestMode | null {
  const normalized = normalizeText(value);
  if (normalized === 'bootstrap') return 'bootstrap';
  if (normalized === 'incremental') return 'incremental';
  return null;
}

function readIngestStage(value: string | null): IngestStage | null {
  const normalized = normalizeText(value);
  if (normalized === 'all') return 'all';
  if (normalized === 'normalize') return 'normalize';
  if (normalized === 'sam-contract-awards' || normalized === 'sam_contract_awards' || normalized === 'contract-awards') {
    return 'sam-contract-awards';
  }
  if (normalized === 'opportunities') return 'opportunities';
  if (normalized === 'spending') return 'spending';
  if (normalized === 'budget-map' || normalized === 'budget_map') return 'budget-map';
  return null;
}

function normalizeText(value: string | null | undefined) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function stringOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalInteger(value: unknown, options: { min: number; max: number }): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = Math.trunc(value);
    if (parsed < options.min || parsed > options.max) return null;
    return parsed;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Math.trunc(Number(trimmed));
    if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) return null;
    return parsed;
  }
  return null;
}

function readBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
    return null;
  }
  return null;
}

function parseSamContractAwardSections(value: string | null): string[] {
  const normalized = stringOrNull(value);
  if (!normalized) return [];
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const raw of normalized.split(',')) {
    const section = raw.trim();
    if (!section) continue;
    const key = section.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push(section);
  }
  return sections;
}

function parseSamExtractFormat(value: string | null): SamExtractFormat {
  const normalized = normalizeText(value);
  if (normalized === 'csv') return 'csv';
  return 'json';
}

function dateOnlyOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function formatSamDate(value: Date) {
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const year = String(value.getUTCFullYear());
  return `${month}/${day}/${year}`;
}

function buildSamOpportunityDateWindow(lookbackDays: number) {
  const requestedLookbackDays = Math.max(1, Math.min(Math.trunc(lookbackDays), SAM_OPPORTUNITIES_MAX_WINDOW_DAYS));
  const postedTo = new Date();
  const postedToUtc = new Date(Date.UTC(postedTo.getUTCFullYear(), postedTo.getUTCMonth(), postedTo.getUTCDate()));

  let requestedPostedFrom = new Date(postedToUtc.getTime() - requestedLookbackDays * MILLISECONDS_PER_DAY);
  let clampReason: string | null = requestedLookbackDays === SAM_OPPORTUNITIES_MAX_WINDOW_DAYS ? 'max_window_cap' : null;
  if (requestedPostedFrom.getUTCMonth() === postedToUtc.getUTCMonth() && requestedPostedFrom.getUTCDate() === postedToUtc.getUTCDate()) {
    requestedPostedFrom = new Date(requestedPostedFrom.getTime() - MILLISECONDS_PER_DAY);
    clampReason = clampReason || 'year_boundary_guard';
  }

  const appliedLookbackDays = Math.max(1, Math.round((postedToUtc.getTime() - requestedPostedFrom.getTime()) / MILLISECONDS_PER_DAY));

  return {
    requestedLookbackDays,
    appliedLookbackDays,
    postedFrom: requestedPostedFrom,
    postedToUtc,
    clampReason
  };
}

function missionKeyOrProgram(value: unknown): MissionKey {
  if (typeof value !== 'string') return 'program';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return 'program';
}

function contractTypeOrUnknown(value: unknown): ContractType {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'definitive') return 'definitive';
  if (normalized === 'idv') return 'idv';
  if (normalized === 'order') return 'order';
  return 'unknown';
}

function isLikelySamContractLookupCandidate(input: {
  piid: string;
  contractType: ContractType;
  metadata: Record<string, unknown>;
}) {
  const piid = input.piid.trim().toLowerCase();
  if (!piid.length) return false;
  if (piid.startsWith('asst_')) return false;
  if (piid.startsWith('grant_')) return false;

  const awardType = normalizeText(readMetaString(input.metadata, 'awardType') || readMetaString(input.metadata, 'award_type'));
  if (awardType.includes('grant') || awardType.includes('cooperative')) return false;

  if (input.contractType === 'idv' || input.contractType === 'order' || input.contractType === 'definitive') {
    return true;
  }

  // Unknown types are allowed only when PIID resembles a federal contract identifier.
  if (/^cont_(awd|idv)_|^fa\d|^w\d|^n\d|^80[a-z0-9]/i.test(input.piid)) return true;
  return false;
}

function normalizeSamIdentifier(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  if (trimmed === '-NONE-') return null;
  if (trimmed.toLowerCase() === 'none') return null;
  return trimmed;
}

function normalizeSamLookupIdentifiers(piid: string, referencedIdvPiid: string | null) {
  const basePiid = normalizeSamIdentifier(piid);
  let lookupRef = normalizeSamIdentifier(referencedIdvPiid);
  if (!basePiid) return { piid: null, referencedIdvPiid: lookupRef };

  const upper = basePiid.toUpperCase();
  if (upper.startsWith('ASST_') || upper.startsWith('GRANT_')) {
    return { piid: null, referencedIdvPiid: null };
  }

  const parts = basePiid.split('_');
  let lookupPiid = basePiid;

  if (upper.startsWith('CONT_AWD_')) {
    const extractedPiid = normalizeSamIdentifier(parts[2] || null);
    const extractedRef = normalizeSamIdentifier(parts[4] || null);
    if (extractedPiid) lookupPiid = extractedPiid;
    if (extractedRef) lookupRef = extractedRef;
    return { piid: lookupPiid, referencedIdvPiid: lookupRef };
  }

  if (upper.startsWith('CONT_IDV_')) {
    const extractedPiid = normalizeSamIdentifier(parts[2] || null);
    if (extractedPiid) lookupPiid = extractedPiid;
    return { piid: lookupPiid, referencedIdvPiid: lookupRef };
  }

  if (upper.startsWith('CONT_')) {
    const extractedPiid = normalizeSamIdentifier(parts[2] || null);
    if (extractedPiid) lookupPiid = extractedPiid;
  }

  return { piid: lookupPiid, referencedIdvPiid: lookupRef };
}

function normalizeProgramScope(value: string | null | undefined): ProgramScope | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'artemis') return 'artemis';
  if (normalized === 'blue-origin' || normalized === 'blue_origin' || normalized === 'blueorigin' || normalized === 'blue') {
    return 'blue-origin';
  }
  if (normalized === 'spacex' || normalized === 'space-x' || normalized === 'space_x' || normalized === 'space x') {
    return 'spacex';
  }
  if (normalized === 'other') return 'other';
  return null;
}

function scopePriority(scope: ProgramScope) {
  if (scope === 'artemis') return 1;
  if (scope === 'blue-origin') return 2;
  if (scope === 'spacex') return 3;
  return 4;
}

function inferContractProgramScope(input: {
  missionKey: MissionKey;
  awardeeName: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  contractKey: string;
}): ProgramScope {
  const directScope = normalizeProgramScope(
    stringOrNull(input.metadata.programScope) || stringOrNull(input.metadata.program_scope)
  );
  if (directScope) return directScope;

  const rawScopes = Array.isArray(input.metadata.programScopes)
    ? input.metadata.programScopes
    : Array.isArray(input.metadata.program_scopes)
      ? input.metadata.program_scopes
      : [];

  if (rawScopes.length > 0) {
    const scoped = rawScopes
      .map((value) => normalizeProgramScope(typeof value === 'string' ? value : null))
      .filter((value): value is ProgramScope => Boolean(value))
      .sort((a, b) => scopePriority(a) - scopePriority(b));
    if (scoped.length > 0) return scoped[0];
  }

  if (input.missionKey !== 'program') return 'artemis';

  const text = [
    input.awardeeName,
    input.description,
    input.contractKey,
    stringOrNull(readMetaString(input.metadata, 'recipient')),
    stringOrNull(readMetaString(input.metadata, 'keyword'))
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b/.test(text)) return 'blue-origin';
  if (/\bspace\s*x\b|\bspacex\b|\bspace exploration technologies\b|\bstarship\b|\bfalcon\b|\bdragon\b|\bstarlink\b/.test(text)) {
    return 'spacex';
  }
  if (/\bartemis\b|\bsls\b|\borion\b|\bhuman\s+landing\s+system\b|\bgateway\b/.test(text)) return 'artemis';
  return 'other';
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isMissingRelationError(error: unknown) {
  const code = stringOrNull(safeRecord(error).code);
  return code === '42P01' || code === 'PGRST205';
}

async function readCheckpointCursor(supabase: ReturnType<typeof createSupabaseAdminClient>, sourceKey: string) {
  const { data, error } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('cursor')
    .eq('source_key', sourceKey)
    .maybeSingle();

  if (error) throw error;
  return typeof data?.cursor === 'string' && data.cursor.length > 0 ? data.cursor : null;
}

async function safeCheckpointMetadata(supabase: ReturnType<typeof createSupabaseAdminClient>, sourceKey: string) {
  const { data, error } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('metadata')
    .eq('source_key', sourceKey)
    .maybeSingle();

  if (error) return {};
  return safeRecord(data?.metadata);
}

async function fetchProcurementAwards(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  options: { mode: IngestMode; cursor: string | null; limit: number }
) {
  let query = supabase
    .from('artemis_procurement_awards')
    .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,metadata,updated_at')
    .order('updated_at', { ascending: true, nullsFirst: false })
    .limit(options.limit);

  if (options.mode === 'incremental' && options.cursor) {
    query = query.gt('updated_at', options.cursor);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data || []) as ProcurementAwardRow[]).filter((row) => {
    return Boolean(stringOrNull(row.usaspending_award_id) || stringOrNull(readMetaString(row.metadata, 'piid')));
  });
}

function resolveNextCursor(rows: ProcurementAwardRow[]) {
  const sorted = rows
    .map((row) => stringOrNull(row.updated_at))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return sorted[0] || null;
}

function buildNormalizedContracts(rows: ProcurementAwardRow[]) {
  const nowIso = new Date().toISOString();
  const map = new Map<string, ContractRow>();

  for (const row of rows) {
    const meta = safeRecord(row.metadata);
    const piid =
      stringOrNull(readMetaString(meta, 'piid')) ||
      stringOrNull(readMetaString(meta, 'awardId')) ||
      stringOrNull(readMetaString(meta, 'generatedAwardId')) ||
      stringOrNull(row.usaspending_award_id);

    if (!piid) continue;

    const referencedIdvPiid =
      stringOrNull(readMetaString(meta, 'referencedIdvPiid')) ||
      stringOrNull(readMetaString(meta, 'referenced_idv_piid')) ||
      stringOrNull(readMetaString(meta, 'parentAwardId')) ||
      null;

    const contractKey = buildContractKey(piid, referencedIdvPiid);
    const contractType = inferContractType(meta, referencedIdvPiid);

    const candidate: ContractRow = {
      contract_key: contractKey,
      piid,
      referenced_idv_piid: referencedIdvPiid,
      parent_award_id: stringOrNull(readMetaString(meta, 'parentAwardId')),
      agency_code: stringOrNull(readMetaString(meta, 'agencyCode')),
      subtier_code: stringOrNull(readMetaString(meta, 'subtierCode')) || '8000',
      mission_key: missionKeyOrProgram(row.mission_key),
      awardee_name: stringOrNull(row.recipient),
      awardee_uei: stringOrNull(readMetaString(meta, 'awardeeUei')),
      contract_type: contractType,
      description: stringOrNull(row.award_title) || stringOrNull(readMetaString(meta, 'description')),
      base_award_date: dateOnlyOrNull(row.awarded_on),
      source_document_id: stringOrNull(row.source_document_id),
      metadata: {
        ...meta,
        normalizedFrom: 'artemis_procurement_awards',
        sourceAwardId: row.usaspending_award_id || null
      },
      updated_at: nowIso
    };

    const existing = map.get(contractKey);
    if (!existing) {
      map.set(contractKey, candidate);
      continue;
    }

    map.set(contractKey, choosePreferredContract(existing, candidate));
  }

  return { contracts: [...map.values()] };
}

function choosePreferredContract(a: ContractRow, b: ContractRow) {
  const aDate = Date.parse(a.base_award_date || '');
  const bDate = Date.parse(b.base_award_date || '');
  const safeA = Number.isFinite(aDate) ? aDate : 0;
  const safeB = Number.isFinite(bDate) ? bDate : 0;

  if (safeA !== safeB) return safeB > safeA ? b : a;

  const aScore = contractCompletenessScore(a);
  const bScore = contractCompletenessScore(b);
  return bScore > aScore ? b : a;
}

function contractCompletenessScore(row: ContractRow) {
  let score = 0;
  if (row.awardee_name) score += 1;
  if (row.description) score += 1;
  if (row.base_award_date) score += 1;
  if (row.referenced_idv_piid) score += 1;
  if (row.agency_code) score += 1;
  if (row.source_document_id) score += 1;
  return score;
}

async function upsertNormalizedContracts(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contracts: ContractRow[],
  stats: Record<string, unknown>
): Promise<ContractRecordRef[]> {
  if (contracts.length === 0) {
    stats.normalizedContractsUpserted = 0;
    return [];
  }

  const refs: ContractRecordRef[] = [];

  for (const chunk of chunkArray(contracts, UPSERT_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_contracts')
      .upsert(chunk, { onConflict: 'contract_key' })
      .select('id,contract_key,piid,referenced_idv_piid,description,mission_key');

    if (error) throw error;
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      refs.push({
        id: String(row.id),
        contract_key: String(row.contract_key),
        piid: String(row.piid),
        referenced_idv_piid: stringOrNull(row.referenced_idv_piid),
        description: stringOrNull(row.description),
        mission_key: missionKeyOrProgram(row.mission_key)
      });
    }
  }

  stats.normalizedContractsUpserted = refs.length;
  return refs;
}

async function fetchContractRefs(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<ContractRecordRef[]> {
  const { data, error } = await supabase
    .from('artemis_contracts')
    .select('id,contract_key,piid,referenced_idv_piid,description,mission_key')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(DEFAULT_BATCH_LIMIT);

  if (error) throw error;

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    contract_key: String(row.contract_key),
    piid: String(row.piid),
    referenced_idv_piid: stringOrNull(row.referenced_idv_piid),
    description: stringOrNull(row.description),
    mission_key: missionKeyOrProgram(row.mission_key)
  }));
}

function buildContractActions(rows: ProcurementAwardRow[], contractIdByKey: Map<string, string>) {
  const nowIso = new Date().toISOString();
  const actions: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const meta = safeRecord(row.metadata);
    const piid =
      stringOrNull(readMetaString(meta, 'piid')) ||
      stringOrNull(readMetaString(meta, 'awardId')) ||
      stringOrNull(readMetaString(meta, 'generatedAwardId')) ||
      stringOrNull(row.usaspending_award_id);
    if (!piid) continue;

    const referencedIdvPiid =
      stringOrNull(readMetaString(meta, 'referencedIdvPiid')) ||
      stringOrNull(readMetaString(meta, 'referenced_idv_piid')) ||
      stringOrNull(readMetaString(meta, 'parentAwardId')) ||
      null;

    const contractKey = buildContractKey(piid, referencedIdvPiid);
    const contractId = contractIdByKey.get(contractKey);
    if (!contractId) continue;

    const actionDate =
      dateOnlyOrNull(readMetaString(meta, 'actionDate')) ||
      dateOnlyOrNull(readMetaString(meta, 'periodOfPerformanceStartDate')) ||
      dateOnlyOrNull(row.awarded_on);

    const modNumber =
      stringOrNull(readMetaString(meta, 'modNumber')) ||
      stringOrNull(readMetaString(meta, 'modificationNumber')) ||
      stringOrNull(readMetaString(meta, 'modification_number')) ||
      '0';

    const solicitationId =
      stringOrNull(readMetaString(meta, 'solicitationId')) ||
      stringOrNull(readMetaString(meta, 'solicitation_id')) ||
      stringOrNull(readMetaString(meta, 'solicitationNumber')) ||
      null;

    const amount = numberOrNull(row.obligated_amount);
    const hashInput = [contractKey, modNumber, actionDate || 'na', String(amount || 0), row.source_document_id || 'na'].join('|');
    const sourceRecordHash = deterministicHash(hashInput);

    actions.push({
      contract_id: contractId,
      action_key: [contractKey, modNumber, actionDate || 'na', sourceRecordHash].join('|'),
      mod_number: modNumber,
      action_date: actionDate,
      obligation_delta: amount,
      obligation_cumulative: null,
      solicitation_id: solicitationId,
      sam_notice_id: null,
      source: 'usaspending',
      source_record_hash: sourceRecordHash,
      source_document_id: stringOrNull(row.source_document_id),
      metadata: {
        ...meta,
        sourceAwardId: row.usaspending_award_id || null
      },
      updated_at: nowIso
    });
  }

  return actions;
}

async function upsertContractActions(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  actions: Array<Record<string, unknown>>,
  stats: Record<string, unknown>
) {
  if (actions.length === 0) return 0;

  let total = 0;
  for (const chunk of chunkArray(actions, UPSERT_CHUNK_SIZE)) {
    const existingByActionKey = await fetchExistingActionLinkageByActionKeys(
      supabase,
      chunk
        .map((row) => stringOrNull(row.action_key))
        .filter((value): value is string => value !== null)
    );
    const mergedChunk = chunk.map((row) => {
      const actionKey = stringOrNull(row.action_key);
      if (!actionKey) return row;
      const existing = existingByActionKey.get(actionKey);
      if (!existing) return row;

      const incomingSolicitationId = stringOrNull(row.solicitation_id);
      const incomingSamNoticeId = stringOrNull(row.sam_notice_id);
      return {
        ...row,
        solicitation_id: incomingSolicitationId || existing.solicitationId || null,
        sam_notice_id: incomingSamNoticeId || existing.samNoticeId || null
      };
    });

    const { error } = await supabase.from('artemis_contract_actions').upsert(mergedChunk, { onConflict: 'action_key' });
    if (error) throw error;
    total += mergedChunk.length;
  }

  stats.normalizedActionsUpserted = total;
  return total;
}

async function fetchExistingActionLinkageByActionKeys(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  actionKeys: string[]
) {
  const normalizedActionKeys = Array.from(new Set(actionKeys.filter((value) => value.length > 0)));
  const existingByActionKey = new Map<string, { solicitationId: string | null; samNoticeId: string | null }>();
  if (!normalizedActionKeys.length) return existingByActionKey;

  for (const chunk of chunkArray(normalizedActionKeys, ACTION_LINKAGE_FETCH_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_contract_actions')
      .select('action_key,solicitation_id,sam_notice_id')
      .in('action_key', chunk);
    if (error) throw error;

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const actionKey = stringOrNull(row.action_key);
      if (!actionKey) continue;
      existingByActionKey.set(actionKey, {
        solicitationId: stringOrNull(row.solicitation_id),
        samNoticeId: stringOrNull(row.sam_notice_id)
      });
    }
  }

  return existingByActionKey;
}

async function upsertBudgetMappings(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contracts: ContractRecordRef[],
  stats: Record<string, unknown>
) {
  if (contracts.length === 0) return 0;

  const { data: budgetRows, error } = await supabase
    .from('artemis_budget_lines')
    .select('id,line_item,program,fiscal_year')
    .order('fiscal_year', { ascending: false, nullsFirst: false })
    .limit(1500);

  if (error) throw error;

  const budget = (budgetRows || []) as BudgetLineRow[];
  if (!budget.length) return 0;

  const mappings: Array<Record<string, unknown>> = [];

  for (const contract of contracts) {
    const description = normalizeText(contract.description || '');
    if (!description.length) continue;

    for (const rule of KEYWORD_ALIGNMENT_RULES) {
      const contractMatched = rule.contractTokens.some((token) => description.includes(token));
      if (!contractMatched) continue;

      for (const line of budget) {
        const lineText = normalizeText(`${line.line_item || ''} ${line.program || ''}`);
        if (!lineText.includes(rule.lineToken)) continue;

        mappings.push({
          contract_id: contract.id,
          budget_line_id: line.id,
          match_method: 'rule',
          confidence: rule.confidence,
          metadata: {
            ruleLineToken: rule.lineToken,
            contractTokenMatch: rule.contractTokens,
            fiscalYear: line.fiscal_year || null
          },
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  if (!mappings.length) return 0;

  let total = 0;
  for (const chunk of chunkArray(dedupeBudgetMappings(mappings), UPSERT_CHUNK_SIZE)) {
    const { error: upsertError } = await supabase
      .from('artemis_contract_budget_map')
      .upsert(chunk, { onConflict: 'contract_id,budget_line_id,match_method' });
    if (upsertError) throw upsertError;
    total += chunk.length;
  }

  stats.budgetMappingsUpserted = total;
  return total;
}

function dedupeBudgetMappings(rows: Array<Record<string, unknown>>) {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = [row.contract_id, row.budget_line_id, row.match_method].join('|');
    if (!seen.has(key)) {
      seen.set(key, row);
      continue;
    }

    const existing = seen.get(key)!;
    const existingConfidence = numberOrNull(existing.confidence) || 0;
    const nextConfidence = numberOrNull(row.confidence) || 0;
    if (nextConfidence > existingConfidence) {
      seen.set(key, row);
    }
  }
  return [...seen.values()];
}

async function upsertSpendingTimeseries(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contracts: ContractRecordRef[],
  stats: Record<string, unknown>
) {
  if (!contracts.length) return 0;

  const contractIdByKey = new Map(contracts.map((contract) => [contract.contract_key, contract.id]));
  const contractKeyById = new Map(contracts.map((contract) => [contract.id, contract.contract_key]));
  const contractIds = [...new Set([...contractIdByKey.values()].slice(0, SPENDING_ACTION_CONTRACT_ID_LIMIT))];
  const actionRows: Array<Record<string, unknown>> = [];

  // Large `in(...)` filters can exceed PostgREST request limits and surface as generic 400s.
  for (const chunk of chunkArray(contractIds, SPENDING_ACTION_CONTRACT_ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_contract_actions')
      .select('contract_id,action_date,obligation_delta')
      .in('contract_id', chunk);
    if (error) throw error;
    actionRows.push(...((data || []) as Array<Record<string, unknown>>));
  }

  const totals = new Map<string, { contractId: string; fiscalYear: number; fiscalMonth: number; obligations: number }>();

  for (const row of actionRows) {
    const contractId = stringOrNull(row.contract_id);
    const actionDate = dateOnlyOrNull(row.action_date);
    const delta = numberOrNull(row.obligation_delta) || 0;
    if (!contractId || !actionDate) continue;

    const fiscal = resolveFiscalBucket(actionDate);
    const key = [contractId, fiscal.fiscalYear, fiscal.fiscalMonth].join('|');
    const existing = totals.get(key) || { contractId, fiscalYear: fiscal.fiscalYear, fiscalMonth: fiscal.fiscalMonth, obligations: 0 };
    existing.obligations += delta;
    totals.set(key, existing);
  }

  const rows = [...totals.values()].map((entry) => ({
    contract_id: entry.contractId,
    fiscal_year: entry.fiscalYear,
    fiscal_month: entry.fiscalMonth,
    obligations: entry.obligations,
    outlays: null,
    source: 'usaspending',
    metadata: {
      method: 'derived_from_contract_actions',
      contractKey: contractKeyById.get(entry.contractId) || null
    },
    updated_at: new Date().toISOString()
  }));

  if (!rows.length) return 0;

  let total = 0;
  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    const { error: upsertError } = await supabase
      .from('artemis_spending_timeseries')
      .upsert(chunk, { onConflict: 'contract_id,fiscal_year,fiscal_month,source' });
    if (upsertError) throw upsertError;
    total += chunk.length;
  }

  stats.spendingRowsUpserted = total;
  return total;
}

function resolveFiscalBucket(dateOnly: string) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (month >= 10) {
    return { fiscalYear: year + 1, fiscalMonth: month - 9 };
  }

  return { fiscalYear: year, fiscalMonth: month + 3 };
}

async function fetchSolicitationIdsForLookup(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  limit: number,
  targetScopes: readonly ProgramScope[] = TARGET_SAM_PROGRAM_SCOPES
): Promise<SolicitationLookupCandidate[]> {
  if (limit < 1) return [];

  const normalizedTargetScopes = normalizeProgramScopeOrder(targetScopes);
  const targetSet = new Set(normalizedTargetScopes);
  if (targetSet.size < 1) return [];

  const solicitationScanLimit = Math.max(1, limit * SAM_OPPORTUNITIES_SOLICITATION_SCAN_MULTIPLIER);
  const { data: solicitationRows, error } = await supabase
    .from('artemis_contract_actions')
    .select('solicitation_id,contract_id,updated_at')
    .not('solicitation_id', 'is', null)
    .is('sam_notice_id', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(solicitationScanLimit);

  if (error) throw error;

  const actionContractIds = Array.from(
    new Set(
      ((solicitationRows || []) as Array<Record<string, unknown>>)
        .map((row) => stringOrNull(row.contract_id))
        .filter(Boolean) as string[]
    )
  );

  if (!actionContractIds.length) return [];

  const contractRows = await fetchContractsByIds(supabase, actionContractIds);

  const contractsById = new Map(
    ((contractRows || []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const scopeByContractId = new Map<string, ProgramScope>();

  const allowedContractIds = [];
  for (const contractId of actionContractIds) {
    const contract = contractsById.get(contractId);
    if (!contract) continue;
    const inferredScope = inferContractProgramScope({
      missionKey: missionKeyOrProgram(contract.mission_key),
      awardeeName: stringOrNull(contract.awardee_name),
      description: stringOrNull(contract.description),
      metadata: safeRecord(contract.metadata),
      contractKey: stringOrNull((contract as Record<string, unknown>).contract_key)
    });

    if (!targetSet.has(inferredScope)) continue;
    allowedContractIds.push(contractId);
    scopeByContractId.set(contractId, inferredScope);
  }

  if (!allowedContractIds.length) return [];

  const seen = new Set<string>();
  const ids: SolicitationLookupCandidate[] = [];
  const targetIds = new Set<string>(allowedContractIds);
  for (const row of (solicitationRows || []) as Array<Record<string, unknown>>) {
    const solicitationId = stringOrNull(row.solicitation_id);
    const contractId = stringOrNull(row.contract_id);
    if (!solicitationId || !contractId) continue;
    if (!targetIds.has(contractId)) continue;
    if (seen.has(solicitationId)) continue;
    const programScope = scopeByContractId.get(contractId);
    if (!programScope) continue;
    seen.add(solicitationId);
    ids.push({ solicitationId, programScope });
    if (ids.length >= limit) break;
  }

  return interleaveScopeOrderedCandidates(ids, normalizedTargetScopes);
}

async function runSamOpportunitiesSync(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    apiKey: string;
    apiUrl: string;
    lookbackDays: number;
    maxRequests: number;
    stopOnEmptyOrError: boolean;
    prioritizedSolicitationIds: string[];
    allowFallbackLookup: boolean;
    sessionToken: string | null;
    targetScopes?: readonly ProgramScope[];
    queryPolicy: SamQueryPolicy;
    opportunitiesPartitionEnabled: boolean;
    opportunitiesPartitionDays: number;
  }
): Promise<SamOpportunitiesSyncResult> {
  const result: SamOpportunitiesSyncResult = {
    solicitationIdsEvaluated: 0,
    noticesFetched: 0,
    samRequestsAttempted: 0,
    samRequestsGranted: 0,
    noticesUpserted: 0,
    noticesExisting: 0,
    versionRowsFetched: 0,
    versionRowsUpserted: 0,
    versionRowsExisting: 0,
    projectionRowsUpserted: 0,
    projectionRowsExisting: 0,
    sourceDocumentsInserted: 0,
    truncatedResponses: 0,
    samQuota: null,
    samQuotaBlocked: false,
    samRunCapReached: false,
    stopReason: null,
    fallbackScopeDistribution: createSamScopeDistribution(),
    lookupSource: 'none',
    fingerprintSkips: 0,
    partitionRequestsEvaluated: 0
  };

  if (input.maxRequests < 1) {
    result.samRunCapReached = true;
    return result;
  }

  const mergeLookupSource = (incoming: SamOpportunitiesSyncResult['lookupSource']) => {
    if (!incoming || incoming === 'none') return;
    if (!result.lookupSource || result.lookupSource === 'none') {
      result.lookupSource = incoming;
      return;
    }
    if (result.lookupSource === incoming) return;
    result.lookupSource = 'mixed';
  };
  const normalizedTargetScopes = normalizeProgramScopeOrder(input.targetScopes || TARGET_SAM_PROGRAM_SCOPES);
  const queue = await buildOpportunitySolicitationQueue(supabase, {
    prioritizedSolicitationIds: input.prioritizedSolicitationIds,
    maxCandidates: Math.max(input.maxRequests, input.maxRequests * 2),
    allowFallbackLookup: input.allowFallbackLookup,
    targetScopes: normalizedTargetScopes
  });
  result.fallbackScopeDistribution = mergeSamScopeDistribution(
    createSamScopeDistribution(),
    queue.fallbackScopeDistribution
  );

  result.solicitationIdsEvaluated = queue.ids.length;
  if (queue.usedTargeted && queue.usedFallback) {
    result.lookupSource = 'mixed';
  } else if (queue.usedTargeted) {
    result.lookupSource = 'targeted';
  } else if (queue.usedFallback) {
    result.lookupSource = 'catalog';
  }

  const requestQueue: SamOpportunityQueryTask[] = [];
  const defaultDateWindow = buildSamOpportunityDateWindow(input.lookbackDays);
  for (const solicitationId of queue.ids) {
    requestQueue.push({
      mode: 'solicitation',
      solicitationId,
      partitionKey: null,
      programScope: null,
      keyword: null,
      organizationName: null,
      dateWindow: defaultDateWindow,
      offset: 0
    });
  }

  if (input.opportunitiesPartitionEnabled) {
    await seedSamOpportunityPartitions(supabase, {
      lookbackDays: input.lookbackDays,
      partitionDays: input.opportunitiesPartitionDays,
      targetScopes: normalizedTargetScopes
    });
    const partitionRows = await fetchSamOpportunityPartitionsForRun(
      supabase,
      Math.max(1, input.maxRequests * DEFAULT_SAM_OPPORTUNITIES_PARTITION_CANDIDATE_MULTIPLIER)
    );
    for (const row of partitionRows) {
      const postedFrom = dateOnlyOrNull(row.posted_from);
      const postedTo = dateOnlyOrNull(row.posted_to);
      if (!postedFrom || !postedTo) continue;
      const postedFromDate = new Date(`${postedFrom}T00:00:00.000Z`);
      const postedToDate = new Date(`${postedTo}T00:00:00.000Z`);
      if (Number.isNaN(postedFromDate.getTime()) || Number.isNaN(postedToDate.getTime())) continue;
      const appliedLookbackDays = Math.max(
        1,
        Math.round((postedToDate.getTime() - postedFromDate.getTime()) / MILLISECONDS_PER_DAY)
      );
      requestQueue.push({
        mode: 'partition',
        solicitationId: null,
        partitionKey: row.partition_key,
        programScope: normalizeProgramScope(row.program_scope) || null,
        keyword: stringOrNull(row.keyword),
        organizationName: stringOrNull(row.organization_name),
        dateWindow: {
          requestedLookbackDays: appliedLookbackDays,
          appliedLookbackDays,
          postedFrom: postedFromDate,
          postedToUtc: postedToDate,
          clampReason: 'partition_window'
        },
        offset: Math.max(0, Math.trunc(numberOrNull(row.current_offset) || 0))
      });
    }
    if (partitionRows.length > 0) {
      mergeLookupSource('partition');
    }
  }

  if (requestQueue.length === 0) {
    if (input.stopOnEmptyOrError) {
      result.stopReason = 'sam_no_candidates';
    }
    return result;
  }

  while (requestQueue.length > 0) {
    if (result.samRequestsGranted >= input.maxRequests) {
      result.samRunCapReached = true;
      break;
    }
    const task = requestQueue.shift() as SamOpportunityQueryTask;
    if (task.mode === 'partition') {
      result.partitionRequestsEvaluated += 1;
    }
    const queryParams: Record<string, unknown> = {
      solnum: task.solicitationId || null,
      q: task.keyword || null,
      organizationName: task.organizationName || null,
      postedFrom: formatSamDate(task.dateWindow.postedFrom),
      postedTo: formatSamDate(task.dateWindow.postedToUtc),
      limit: SAM_OPPORTUNITIES_LIMIT,
      offset: task.offset
    };
    const queryGate = await readSamQueryExecutionGate(supabase, {
      endpoint: 'opportunities',
      params: queryParams
    });
    if (!queryGate.allowed) {
      result.fingerprintSkips += 1;
      if (task.mode === 'partition' && task.partitionKey) {
        const deferredUntil = queryGate.nextRetryAt || queryGate.cooldownUntil;
        await updateSamOpportunityPartitionState(supabase, task.partitionKey, {
          next_retry_at: deferredUntil,
          last_error: queryGate.reason || null,
          last_scanned_at: new Date().toISOString()
        });
      }
      continue;
    }
    result.samRequestsAttempted += 1;

    const quota = await claimDailyQuota(supabase, {
      stateKey: 'artemis_sam_quota_state',
      limitKey: 'artemis_sam_daily_quota_limit',
      reserveKey: 'artemis_sam_daily_quota_reserve',
      requested: 1,
      defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
      defaultReserve: DEFAULT_SAM_DAILY_RESERVE
    });
    result.samQuota = quota as unknown as Record<string, unknown>;

    if (quota.granted < 1) {
      result.samQuotaBlocked = true;
      result.stopReason = 'sam_quota_blocked';
      break;
    }

    result.samRequestsGranted += 1;

    const response = await fetchSamOpportunities({
      solicitationId: task.solicitationId,
      apiKey: input.apiKey,
      apiUrl: input.apiUrl,
      lookbackDays: input.lookbackDays,
      sessionToken: input.sessionToken,
      dateWindow: task.dateWindow,
      keyword: task.keyword,
      organizationName: task.organizationName,
      offset: task.offset
    });
    if (response.paging.truncated) {
      result.truncatedResponses += 1;
    }

    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: CHECKPOINT_OPPORTUNITIES,
      sourceType: 'procurement',
      url: response.url,
      title: task.solicitationId
        ? `SAM opportunities lookup (${task.solicitationId})`
        : `SAM opportunities partition lookup (${task.programScope || 'all'}:${task.keyword || 'none'})`,
      summary: task.solicitationId
        ? `SAM response status ${response.status}; extracted ${response.notices.length} notices for solicitation ${task.solicitationId} offset ${task.offset}.`
        : `SAM response status ${response.status}; extracted ${response.notices.length} notices for ${task.programScope || 'all'}:${task.keyword || 'none'} range ${formatSamDate(task.dateWindow.postedFrom)}-${formatSamDate(task.dateWindow.postedToUtc)} offset ${task.offset}.`,
      announcedTime: new Date().toISOString(),
      httpStatus: response.status,
      contentType: 'application/json',
      raw: {
        samSessionToken: input.sessionToken || null,
        solicitationId: task.solicitationId,
        partitionKey: task.partitionKey,
        programScope: task.programScope,
        keyword: task.keyword,
        organizationName: task.organizationName,
        offset: task.offset,
        queryFingerprint: queryGate.fingerprint,
        dateWindow: response.dateWindow,
        ok: response.ok,
        noticeCount: response.notices.length,
        paging: response.paging,
        quota: quota || null,
        body: response.body
      },
      error: response.ok ? null : `http_${response.status}`
    });
    result.sourceDocumentsInserted += 1;

    let upsertResult: SamOpportunityNoticeUpsertResult | null = null;
    if (response.ok && response.notices.length > 0) {
      const noticesWithDoc = response.notices.map((notice) => ({
        ...notice,
        source_document_id: sourceDocId,
        metadata: {
          ...safeRecord(notice.metadata),
          sourceStream: 'sam_api_delta'
        },
        updated_at: new Date().toISOString()
      }));
      upsertResult = await upsertOpportunityNotices(supabase, noticesWithDoc);
      result.noticesFetched += upsertResult.fetched;
      result.noticesUpserted += upsertResult.inserted;
      result.noticesExisting += upsertResult.duplicates;
      result.projectionRowsUpserted += upsertResult.inserted;
      result.projectionRowsExisting += upsertResult.duplicates;
      const versionUpsert = await upsertOpportunityNoticeVersions(supabase, {
        notices: noticesWithDoc,
        sourceStream: 'sam_api_delta',
        sourceDocumentId: sourceDocId
      });
      result.versionRowsFetched += versionUpsert.fetched;
      result.versionRowsUpserted += versionUpsert.inserted;
      result.versionRowsExisting += versionUpsert.duplicates;
      if (task.solicitationId) {
        await attachNoticeToActions(supabase, task.solicitationId, noticesWithDoc[0]?.notice_id || null);
      }
    }
    const duplicateOnly = Boolean(upsertResult && upsertResult.inserted < 1);
    await recordSamQueryExecutionOutcome(supabase, {
      endpoint: 'opportunities',
      gate: queryGate,
      status: response.status,
      rowCount: response.notices.length,
      duplicateOnly,
      policy: input.queryPolicy,
      error: response.ok ? null : stringifyError(response.body)
    });

    const stopReason = classifySamStopReason(response.status, response.body);
    if (stopReason) {
      result.stopReason = stopReason;
      if (task.mode === 'partition' && task.partitionKey) {
        await updateSamOpportunityPartitionState(supabase, task.partitionKey, {
          next_retry_at: computeSamRetryBackoffIso(input.queryPolicy.retryBackoffBaseMinutes, 1),
          last_http_status: response.status,
          last_row_count: response.notices.length,
          last_error: stopReason,
          last_scanned_at: new Date().toISOString()
        });
      }
      break;
    }
    if (!response.ok) {
      result.stopReason = `sam_http_error_${response.status}`;
      if (task.mode === 'partition' && task.partitionKey) {
        await updateSamOpportunityPartitionState(supabase, task.partitionKey, {
          next_retry_at: computeSamRetryBackoffIso(input.queryPolicy.retryBackoffBaseMinutes, 1),
          last_http_status: response.status,
          last_row_count: response.notices.length,
          last_error: result.stopReason,
          last_scanned_at: new Date().toISOString()
        });
      }
      break;
    }
    if (task.mode === 'solicitation' && response.notices.length === 0 && input.stopOnEmptyOrError) {
      result.stopReason = 'sam_no_new_data';
      break;
    }
    if (task.mode === 'solicitation' && duplicateOnly && input.stopOnEmptyOrError) {
      result.stopReason = 'sam_no_new_data';
      break;
    }

    const pageLimit = Math.max(1, response.paging.limit || SAM_OPPORTUNITIES_LIMIT);
    const continueSameRange = response.paging.truncated && response.notices.length > 0 && result.samRequestsGranted < input.maxRequests;
    if (continueSameRange) {
      requestQueue.unshift({
        ...task,
        offset: task.offset + pageLimit
      });
    }

    if (task.mode === 'partition' && task.partitionKey) {
      await updateSamOpportunityPartitionState(supabase, task.partitionKey, {
        current_offset: continueSameRange ? task.offset + pageLimit : 0,
        next_retry_at: null,
        last_http_status: response.status,
        last_row_count: response.notices.length,
        last_error: null,
        last_scanned_at: new Date().toISOString()
      });
    }
  }

  return result;
}

function toIsoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildSamOpportunityPartitionSeeds(input: {
  lookbackDays: number;
  partitionDays: number;
  targetScopes: readonly ProgramScope[];
}): SamOpportunityPartitionSeed[] {
  const lookbackDays = Math.max(1, Math.min(SAM_OPPORTUNITIES_MAX_WINDOW_DAYS, Math.trunc(input.lookbackDays)));
  const partitionDays = Math.max(7, Math.min(90, Math.trunc(input.partitionDays)));
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const earliestAllowed = new Date(todayUtc.getTime() - lookbackDays * MILLISECONDS_PER_DAY);
  const seeds: SamOpportunityPartitionSeed[] = [];
  for (const scope of normalizeProgramScopeOrder(input.targetScopes)) {
    if (scope === 'other') continue;
    const scopedKeywords = SAM_OPPORTUNITIES_PARTITION_KEYWORDS[scope as 'artemis' | 'blue-origin' | 'spacex'] || [];
    // Artemis recall: run NASA-scoped and unscoped partitions so non-NASA notices can still surface.
    const organizationNames = scope === 'artemis'
      ? ['National Aeronautics and Space Administration', null]
      : [null];
    for (const keyword of scopedKeywords) {
      for (const organizationName of organizationNames) {
        for (let offsetDays = 0; offsetDays < lookbackDays; offsetDays += partitionDays) {
          const postedTo = new Date(todayUtc.getTime() - offsetDays * MILLISECONDS_PER_DAY);
          let postedFrom = new Date(postedTo.getTime() - partitionDays * MILLISECONDS_PER_DAY);
          if (postedFrom < earliestAllowed) postedFrom = new Date(earliestAllowed);
          if (postedFrom.getTime() >= postedTo.getTime()) {
            postedFrom = new Date(postedTo.getTime() - MILLISECONDS_PER_DAY);
          }
          const postedFromStr = toIsoDateOnly(postedFrom);
          const postedToStr = toIsoDateOnly(postedTo);
          const seedBase = {
            endpoint: 'opportunities',
            programScope: scope,
            keyword,
            organizationName,
            postedFrom: postedFromStr,
            postedTo: postedToStr
          };
          const partitionHash = deterministicHash(stableJsonStringify(seedBase));
          seeds.push({
            partitionKey: `opportunities:${partitionHash}`,
            endpoint: 'opportunities',
            programScope: scope,
            keyword,
            organizationName,
            postedFrom: postedFromStr,
            postedTo: postedToStr,
            status: 'active',
            currentOffset: 0,
            metadata: {
              model: 'rolling_window_keyword_partition',
              scope,
              keyword,
              organizationName,
              postedFrom: postedFromStr,
              postedTo: postedToStr
            }
          });
        }
      }
    }
  }
  return seeds;
}

async function seedSamOpportunityPartitions(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    lookbackDays: number;
    partitionDays: number;
    targetScopes: readonly ProgramScope[];
  }
) {
  const seeds = buildSamOpportunityPartitionSeeds(input);
  if (!seeds.length) return;
  for (const chunk of chunkArray(seeds, 200)) {
    const rows = chunk.map((seed) => ({
      partition_key: seed.partitionKey,
      endpoint: seed.endpoint,
      program_scope: seed.programScope,
      keyword: seed.keyword,
      organization_name: seed.organizationName,
      posted_from: seed.postedFrom,
      posted_to: seed.postedTo,
      status: seed.status,
      current_offset: seed.currentOffset,
      metadata: seed.metadata
    }));
    const { error } = await supabase.from('sam_query_partitions').upsert(rows, {
      onConflict: 'partition_key',
      ignoreDuplicates: true
    });
    if (error && error.code !== '42P01') throw error;
  }

  const activeSeedKeys = new Set(seeds.map((seed) => seed.partitionKey));
  const { data: existing, error: existingError } = await supabase
    .from('sam_query_partitions')
    .select('partition_key')
    .eq('endpoint', 'opportunities')
    .eq('status', 'active');
  if (existingError && existingError.code !== '42P01') throw existingError;
  if (!existing || existing.length < 1) return;

  const staleKeys = (existing as Array<Record<string, unknown>>)
    .map((row) => stringOrNull(row.partition_key))
    .filter((partitionKey): partitionKey is string => Boolean(partitionKey && !activeSeedKeys.has(partitionKey)));
  if (staleKeys.length < 1) return;

  for (const chunk of chunkArray(staleKeys, 200)) {
    const { error: retireError } = await supabase
      .from('sam_query_partitions')
      .update({
        status: 'retired',
        next_retry_at: null,
        last_error: 'partition_seed_retired',
        updated_at: new Date().toISOString()
      })
      .in('partition_key', chunk);
    if (retireError && retireError.code !== '42P01') throw retireError;
  }
}

async function fetchSamOpportunityPartitionsForRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  limit: number
): Promise<SamOpportunityPartitionRow[]> {
  const fetchLimit = Math.max(1, Math.min(500, Math.trunc(limit) * 2));
  const dueIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('sam_query_partitions')
    .select(
      'partition_key,endpoint,program_scope,keyword,organization_name,posted_from,posted_to,current_offset,status,next_retry_at,last_scanned_at,metadata'
    )
    .eq('endpoint', 'opportunities')
    .eq('status', 'active')
    .or(`next_retry_at.is.null,next_retry_at.lte.${dueIso}`)
    .order('last_scanned_at', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: true })
    .limit(fetchLimit);
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  const rows = (data || []) as SamOpportunityPartitionRow[];
  return rows.slice(0, Math.max(1, Math.trunc(limit)));
}

async function updateSamOpportunityPartitionState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  partitionKey: string,
  patch: {
    current_offset?: number;
    next_retry_at?: string | null;
    last_http_status?: number;
    last_row_count?: number;
    last_error?: string | null;
    last_scanned_at?: string | null;
  }
) {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (typeof patch.current_offset === 'number') payload.current_offset = Math.max(0, Math.trunc(patch.current_offset));
  if (Object.prototype.hasOwnProperty.call(patch, 'next_retry_at')) payload.next_retry_at = patch.next_retry_at || null;
  if (typeof patch.last_http_status === 'number') payload.last_http_status = Math.trunc(patch.last_http_status);
  if (typeof patch.last_row_count === 'number') payload.last_row_count = Math.max(0, Math.trunc(patch.last_row_count));
  if (Object.prototype.hasOwnProperty.call(patch, 'last_error')) payload.last_error = patch.last_error || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'last_scanned_at')) payload.last_scanned_at = patch.last_scanned_at || null;
  const { error } = await supabase.from('sam_query_partitions').update(payload).eq('partition_key', partitionKey);
  if (error && error.code !== '42P01') throw error;
}

async function buildOpportunitySolicitationQueue(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  options: {
    prioritizedSolicitationIds: string[];
    maxCandidates: number;
    allowFallbackLookup: boolean;
    targetScopes?: readonly ProgramScope[];
  }
) {
  const maxCandidates = Math.max(0, Math.trunc(options.maxCandidates));
  if (maxCandidates < 1) {
    return {
      ids: [] as string[],
      usedTargeted: false,
      usedFallback: false,
      fallbackScopeDistribution: createSamScopeDistribution()
    };
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  let usedTargeted = false;
  let usedFallback = false;
  const fallbackScopeDistribution = createSamScopeDistribution();
  const normalizedTargetScopes = normalizeProgramScopeOrder(options.targetScopes || TARGET_SAM_PROGRAM_SCOPES);

  for (const value of options.prioritizedSolicitationIds) {
    const solicitationId = stringOrNull(value);
    if (!solicitationId) continue;
    if (seen.has(solicitationId)) continue;
    seen.add(solicitationId);
    ids.push(solicitationId);
    usedTargeted = true;
    if (ids.length >= maxCandidates) {
      return { ids, usedTargeted, usedFallback, fallbackScopeDistribution };
    }
  }

  if (options.allowFallbackLookup && ids.length < maxCandidates) {
    const fallbackLimit = Math.max(1, maxCandidates * 3);
    const fallbackIds = await fetchSolicitationIdsForLookup(supabase, fallbackLimit, normalizedTargetScopes);
    for (const fallback of fallbackIds) {
      const solicitationId = fallback.solicitationId;
      if (seen.has(solicitationId)) continue;
      seen.add(solicitationId);
      ids.push(solicitationId);
      usedFallback = true;
      fallbackScopeDistribution[fallback.programScope] += 1;
      if (ids.length >= maxCandidates) break;
    }
  }

  const candidateIds = ids.slice(0, maxCandidates);
  const idsWithoutExistingNotices = await filterSolicitationIdsWithoutNoticeRows(supabase, candidateIds);
  return {
    ids: idsWithoutExistingNotices,
    usedTargeted,
    usedFallback,
    fallbackScopeDistribution
  };
}

async function filterSolicitationIdsWithoutNoticeRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  solicitationIds: string[]
) {
  const normalizedSolicitationIds = Array.from(new Set(solicitationIds.filter((value) => Boolean(value))));
  if (!normalizedSolicitationIds.length) return [];

  const existing = new Set<string>();
  for (const chunk of chunkArray(normalizedSolicitationIds, 250)) {
    const { data, error } = await supabase
      .from('artemis_opportunity_notices')
      .select('solicitation_id')
      .in('solicitation_id', chunk);

    if (error) throw error;
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const solicitationId = stringOrNull(row.solicitation_id);
      if (solicitationId) existing.add(solicitationId);
    }
  }

  return normalizedSolicitationIds.filter((solicitationId) => !existing.has(solicitationId));
}

async function backfillSolicitationsFromSamContractAwards(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    apiKey: string;
    apiUrl: string;
    maxRequests: number;
    stopOnEmptyOrError: boolean;
    sessionToken: string | null;
    targetScopes?: readonly ProgramScope[];
    excludedContractIds?: Array<string> | Set<string>;
    queryPolicy: SamQueryPolicy;
    includeDeletedStatus: boolean;
    includeSections: string[];
    extract: {
      enabled: boolean;
      format: SamExtractFormat;
      pollLimit: number;
    };
  }
): Promise<SamContractAwardsBackfillResult> {
  const result: SamContractAwardsBackfillResult = {
    contractsEvaluated: 0,
    awardRowsFetched: 0,
    contractsBackfilled: 0,
    actionsBackfilled: 0,
    awardRowsUpserted: 0,
    awardRowsExisting: 0,
    ambiguousContracts: 0,
    targetedSolicitationIds: [],
    samRequestsAttempted: 0,
    samRequestsGranted: 0,
    sourceDocumentsInserted: 0,
    truncatedResponses: 0,
    samQuota: null,
    samQuotaBlocked: false,
    samRunCapReached: false,
    stopReason: null,
    candidateScopeDistribution: createSamScopeDistribution(),
    fingerprintSkips: 0,
    extractEnabled: input.extract.enabled,
    extractFormat: input.extract.format,
    extractPollLimit: input.extract.pollLimit,
    extractJobsRequested: 0,
    extractJobsSkipped: 0,
    extractJobsPolled: 0,
    extractJobsReady: 0,
    extractJobsApplied: 0,
    extractJobsFailed: 0,
    extractRowsFetched: 0,
    extractRowsUpserted: 0,
    extractRowsExisting: 0
  };

  const existingBackfill = await backfillSolicitationsFromExistingSamAwardRows(supabase, {
    targetScopes: input.targetScopes || TARGET_SAM_PROGRAM_SCOPES,
    excludedContractIds: input.excludedContractIds
  });
  result.contractsEvaluated += existingBackfill.contractsEvaluated;
  result.awardRowsFetched += existingBackfill.awardRowsReferenced;
  result.awardRowsExisting += existingBackfill.awardRowsReferenced;
  result.contractsBackfilled += existingBackfill.contractsBackfilled;
  result.actionsBackfilled += existingBackfill.actionsBackfilled;
  result.ambiguousContracts += existingBackfill.ambiguousContracts;

  const targetedIds = new Set<string>(existingBackfill.targetedSolicitationIds);
  const requestExcludedContractIds = new Set<string>(existingBackfill.backfilledContractIds);
  const applyExtractProcessingResult = (processing: SamAwardsExtractProcessingResult) => {
    result.extractJobsRequested += processing.jobsRequested;
    result.extractJobsSkipped += processing.jobsSkipped;
    result.extractJobsPolled += processing.jobsPolled;
    result.extractJobsReady += processing.jobsReady;
    result.extractJobsApplied += processing.jobsApplied;
    result.extractJobsFailed += processing.jobsFailed;
    result.extractRowsFetched += processing.rowsFetched;
    result.extractRowsUpserted += processing.rowsUpserted;
    result.extractRowsExisting += processing.rowsExisting;
    result.awardRowsFetched += processing.rowsFetched;
    result.awardRowsUpserted += processing.rowsUpserted;
    result.awardRowsExisting += processing.rowsExisting;
    result.contractsBackfilled += processing.contractsBackfilled;
    result.actionsBackfilled += processing.actionsBackfilled;
    result.ambiguousContracts += processing.ambiguousContracts;
    result.samRequestsAttempted += processing.samRequestsAttempted;
    result.samRequestsGranted += processing.samRequestsGranted;
    result.sourceDocumentsInserted += processing.sourceDocumentsInserted;
    if (processing.samQuota) result.samQuota = processing.samQuota;
    if (processing.samQuotaBlocked) result.samQuotaBlocked = true;
    if (processing.samRunCapReached) result.samRunCapReached = true;
    if (processing.stopReason) result.stopReason = processing.stopReason;
    for (const solicitationId of processing.targetedSolicitationIds) {
      targetedIds.add(solicitationId);
    }
  };

  if (input.extract.enabled && input.extract.pollLimit > 0 && input.maxRequests > 0) {
    const processing = await processSamAwardExtractJobs(supabase, {
      apiKey: input.apiKey,
      apiUrl: input.apiUrl,
      maxRequests: Math.max(0, input.maxRequests - result.samRequestsGranted),
      sessionToken: input.sessionToken,
      pollLimit: input.extract.pollLimit
    });
    applyExtractProcessingResult(processing);
  }

  if (input.excludedContractIds) {
    for (const contractId of input.excludedContractIds) {
      const normalizedContractId = stringOrNull(contractId);
      if (normalizedContractId) requestExcludedContractIds.add(normalizedContractId);
    }
  }
  let progressedWithExistingData =
    existingBackfill.actionsBackfilled > 0 || result.extractRowsUpserted > 0 || result.actionsBackfilled > 0;

  if (result.samQuotaBlocked || result.stopReason === 'sam_quota_blocked') {
    result.targetedSolicitationIds = [...targetedIds];
    return result;
  }

  if (input.maxRequests < 1 || result.samRequestsGranted >= input.maxRequests) {
    result.samRunCapReached = true;
    result.targetedSolicitationIds = [...targetedIds];
    return result;
  }

  const candidates = await fetchContractAwardsLookupCandidates(
    supabase,
    Math.max(1, input.maxRequests * SAM_CONTRACT_AWARDS_CANDIDATE_MULTIPLIER),
    input.targetScopes,
    requestExcludedContractIds
  );
  result.contractsEvaluated += candidates.length;
  if (candidates.length < 1) {
    result.candidateScopeDistribution = mergeSamScopeDistribution(
      result.candidateScopeDistribution,
      tallyProgramScope([])
    );
    if (input.stopOnEmptyOrError) {
      result.stopReason = 'sam_no_candidates';
    }
    result.targetedSolicitationIds = [...targetedIds];
    return result;
  }
  result.candidateScopeDistribution = mergeSamScopeDistribution(
    result.candidateScopeDistribution,
    tallyProgramScope(candidates)
  );
  const contractAwardRowsByContract = await fetchExistingSamAwardRowsByContractIds(
    supabase,
    candidates.map((candidate) => candidate.contractId)
  );

  for (const candidate of candidates) {
    if (result.samRequestsGranted >= input.maxRequests) {
      result.samRunCapReached = true;
      break;
    }

    const cachedRows = contractAwardRowsByContract.get(candidate.contractId) || [];
    if (cachedRows.length > 0) {
      result.awardRowsFetched += cachedRows.length;
      result.awardRowsExisting += cachedRows.length;

      const resolution = resolveSolicitationIdFromContractAwards(cachedRows, candidate);
      if (resolution.ambiguous) {
        result.ambiguousContracts += 1;
        continue;
      }
      if (!resolution.solicitationId) {
        if (input.stopOnEmptyOrError) {
          result.stopReason = 'sam_no_new_data';
          break;
        }
        continue;
      }

      const updatedActions = await backfillSolicitationIdForContractActions(
        supabase,
        candidate.contractId,
        resolution.solicitationId
      );
      if (updatedActions < 1) continue;

      result.contractsBackfilled += 1;
      result.actionsBackfilled += updatedActions;
      targetedIds.add(resolution.solicitationId);
      progressedWithExistingData = true;
      continue;
    }

    let candidateOffset = 0;
    let continuePagingCandidate = true;
    while (continuePagingCandidate) {
      if (result.samRequestsGranted >= input.maxRequests) {
        result.samRunCapReached = true;
        break;
      }

      const queryParams: Record<string, unknown> = {
        piid: candidate.piid,
        referencedIdvPiid: candidate.referencedIdvPiid || null,
        includeDeletedStatus: input.includeDeletedStatus ? 'yes' : 'no',
        includeSections: uniqueNonEmptyStrings(input.includeSections).map((value) => value.toLowerCase()).sort(),
        limit: SAM_CONTRACT_AWARDS_LIMIT,
        offset: candidateOffset
      };
      const queryGate = await readSamQueryExecutionGate(supabase, {
        endpoint: 'contract-awards',
        params: queryParams
      });
      if (!queryGate.allowed) {
        result.fingerprintSkips += 1;
        // Skip repeated dead queries without burning quota. Move to next candidate.
        continuePagingCandidate = false;
        continue;
      }

      result.samRequestsAttempted += 1;

      const quota = await claimDailyQuota(supabase, {
        stateKey: 'artemis_sam_quota_state',
        limitKey: 'artemis_sam_daily_quota_limit',
        reserveKey: 'artemis_sam_daily_quota_reserve',
        requested: 1,
        defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
        defaultReserve: DEFAULT_SAM_DAILY_RESERVE
      });
      result.samQuota = quota as unknown as Record<string, unknown>;

      if (quota.granted < 1) {
        result.samQuotaBlocked = true;
        result.stopReason = 'sam_quota_blocked';
        break;
      }

      result.samRequestsGranted += 1;

      const response = await fetchSamContractAwards({
        candidate,
        apiKey: input.apiKey,
        apiUrl: input.apiUrl,
        sessionToken: input.sessionToken,
        offset: candidateOffset,
        includeDeletedStatus: input.includeDeletedStatus,
        includeSections: input.includeSections
      });
      if (response.paging.truncated) {
        result.truncatedResponses += 1;
      }

      const sourceDocId = await insertSourceDocument(supabase, {
        sourceKey: CHECKPOINT_SAM_CONTRACT_AWARDS,
        sourceType: 'procurement',
        url: response.url,
        title: `SAM contract awards lookup (${candidate.contractKey})`,
        summary: `SAM contract awards status ${response.status}; extracted ${response.awards.length} rows for PIID ${candidate.piid} offset ${candidateOffset}.`,
        announcedTime: new Date().toISOString(),
        httpStatus: response.status,
        contentType: 'application/json',
        raw: {
          samSessionToken: input.sessionToken || null,
          contractId: candidate.contractId,
          contractKey: candidate.contractKey,
          programScope: candidate.programScope,
          missionKey: candidate.missionKey,
          piid: candidate.piid,
          referencedIdvPiid: candidate.referencedIdvPiid,
          includeDeletedStatus: input.includeDeletedStatus,
          includeSections: input.includeSections,
          offset: candidateOffset,
          queryFingerprint: queryGate.fingerprint,
          ok: response.ok,
          method: response.method,
          rowCount: response.awards.length,
          quota: quota || null,
          paging: response.paging,
          body: response.body
        },
        error: response.ok ? null : `http_${response.status}`
      });
      result.sourceDocumentsInserted += 1;

      let duplicateOnly = false;
      if (response.ok && response.awards.length > 0) {
        const upsertResult = await upsertSamContractAwardRows(supabase, {
          candidate,
          response,
          sourceDocumentId: sourceDocId
        });
        result.awardRowsFetched += upsertResult.fetched;
        result.awardRowsUpserted += upsertResult.inserted;
        result.awardRowsExisting += upsertResult.duplicates;
        duplicateOnly = upsertResult.inserted === 0;
      } else {
        result.awardRowsFetched += response.awards.length;
      }

      await recordSamQueryExecutionOutcome(supabase, {
        endpoint: 'contract-awards',
        gate: queryGate,
        status: response.status,
        rowCount: response.awards.length,
        duplicateOnly,
        policy: input.queryPolicy,
        error: response.ok ? null : stringifyError(response.body)
      });

      const stopReason = classifySamStopReason(response.status, response.body);
      if (stopReason) {
        result.stopReason = stopReason;
        break;
      }
      if (!response.ok) {
        result.stopReason = `sam_http_error_${response.status}`;
        break;
      }
      if (response.awards.length === 0 && input.stopOnEmptyOrError) {
        result.stopReason = 'sam_no_new_data';
        break;
      }

      const resolution = resolveSolicitationIdFromContractAwards(response.awards, candidate);
      const isDuplicateOnly = duplicateOnly && input.stopOnEmptyOrError;

      if (isDuplicateOnly && resolution.ambiguous) {
        result.stopReason = 'sam_no_new_data';
        break;
      }
      if (resolution.ambiguous) {
        result.ambiguousContracts += 1;
      } else if (resolution.solicitationId) {
        const updatedActions = await backfillSolicitationIdForContractActions(
          supabase,
          candidate.contractId,
          resolution.solicitationId
        );
        if (isDuplicateOnly && updatedActions < 1) {
          result.stopReason = 'sam_no_new_data';
          break;
        }
        if (updatedActions > 0) {
          result.contractsBackfilled += 1;
          result.actionsBackfilled += updatedActions;
          targetedIds.add(resolution.solicitationId);
          progressedWithExistingData = true;
        }
      } else if (isDuplicateOnly) {
        result.stopReason = 'sam_no_new_data';
        break;
      }

      const pageLimit = Math.max(1, response.paging.limit || SAM_CONTRACT_AWARDS_LIMIT);
      const canPageMore = response.paging.truncated && response.awards.length > 0;
      let extractHandledPaging = false;
      if (canPageMore && input.extract.enabled && candidateOffset < 1) {
        const extractRequest = await requestSamAwardExtractJob(supabase, {
          candidate,
          apiKey: input.apiKey,
          apiUrl: input.apiUrl,
          maxRequests: Math.max(0, input.maxRequests - result.samRequestsGranted),
          sessionToken: input.sessionToken,
          format: input.extract.format,
          includeDeletedStatus: input.includeDeletedStatus,
          includeSections: input.includeSections
        });
        applyExtractProcessingResult(extractRequest);
        if (extractRequest.rowsUpserted > 0 || extractRequest.actionsBackfilled > 0) {
          progressedWithExistingData = true;
        }
        if (extractRequest.stopReason || extractRequest.samQuotaBlocked) {
          break;
        }
        if (extractRequest.jobsRequested > 0 || extractRequest.jobsSkipped > 0) {
          // Async extract replaces offset paging for this candidate.
          extractHandledPaging = true;
        }
      }

      if (extractHandledPaging) {
        continuePagingCandidate = false;
      } else if (canPageMore && result.samRequestsGranted < input.maxRequests) {
        candidateOffset += pageLimit;
        continuePagingCandidate = true;
      } else {
        continuePagingCandidate = false;
      }
    }

    if (result.stopReason || result.samQuotaBlocked) {
      break;
    }
  }

  if (
    input.stopOnEmptyOrError &&
    !progressedWithExistingData &&
    result.awardRowsUpserted === 0 &&
    result.contractsBackfilled === 0 &&
    result.actionsBackfilled === 0
  ) {
    result.stopReason = result.stopReason || 'sam_no_new_data';
  }

  result.targetedSolicitationIds = [...targetedIds];
  return result;
}

function createEmptySamAwardsExtractProcessingResult(): SamAwardsExtractProcessingResult {
  return {
    jobsRequested: 0,
    jobsSkipped: 0,
    jobsPolled: 0,
    jobsReady: 0,
    jobsApplied: 0,
    jobsFailed: 0,
    rowsFetched: 0,
    rowsUpserted: 0,
    rowsExisting: 0,
    contractsBackfilled: 0,
    actionsBackfilled: 0,
    ambiguousContracts: 0,
    targetedSolicitationIds: [],
    samRequestsAttempted: 0,
    samRequestsGranted: 0,
    sourceDocumentsInserted: 0,
    samQuota: null,
    samQuotaBlocked: false,
    samRunCapReached: false,
    stopReason: null
  };
}

function normalizeSamExtractJobStatus(value: unknown, fallback: SamExtractJobStatus = 'pending'): SamExtractJobStatus {
  const normalized = normalizeText(typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
  if (normalized === 'requested') return 'requested';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'processing') return 'processing';
  if (normalized === 'ready') return 'ready';
  if (normalized === 'applied') return 'applied';
  if (normalized === 'failed') return 'failed';
  if (normalized.includes('appl')) return 'applied';
  if (normalized.includes('ready') || normalized.includes('complete') || normalized.includes('available')) return 'ready';
  if (normalized.includes('queue') || normalized.includes('pend')) return 'pending';
  if (normalized.includes('process') || normalized.includes('running')) return 'processing';
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed';
  return fallback;
}

function collectSamExtractPayloadRecords(payload: unknown): Array<Record<string, unknown>> {
  const root = safeRecord(payload);
  const nested = [
    root,
    safeRecord(root.response),
    safeRecord(root.data),
    safeRecord(root.result),
    safeRecord(root.results),
    safeRecord(root.job),
    safeRecord(root.extract),
    safeRecord(root.metadata),
    safeRecord(safeRecord(root.data).job),
    safeRecord(safeRecord(root.result).job),
    safeRecord(safeRecord(root.results).job)
  ];
  return nested.filter((entry) => Object.keys(entry).length > 0);
}

function readFirstSamExtractString(payload: unknown, keys: string[]): string | null {
  const records = collectSamExtractPayloadRecords(payload);
  for (const record of records) {
    for (const key of keys) {
      const direct = stringOrNull(record[key]);
      if (direct) return direct;
    }
  }
  return null;
}

function extractSamExtractToken(payload: unknown): string | null {
  return readFirstSamExtractString(payload, [
    'token',
    'requestToken',
    'request_token',
    'requestId',
    'request_id',
    'jobId',
    'job_id',
    'extractRequestId',
    'extract_request_id'
  ]);
}

function extractSamExtractStatusUrl(payload: unknown): string | null {
  const url = readFirstSamExtractString(payload, [
    'statusUrl',
    'status_url',
    'jobStatusUrl',
    'job_status_url',
    'pollUrl',
    'poll_url'
  ]);
  if (url && /^https?:\/\//i.test(url)) return url;
  return null;
}

function extractSamExtractDownloadUrl(payload: unknown): string | null {
  const url = readFirstSamExtractString(payload, [
    'downloadUrl',
    'download_url',
    'fileUrl',
    'file_url',
    'downloadURI',
    'download_uri'
  ]);
  if (url && /^https?:\/\//i.test(url)) return url;
  return null;
}

function extractSamExtractStatus(payload: unknown): SamExtractJobStatus | null {
  const status = readFirstSamExtractString(payload, ['status', 'requestStatus', 'request_status', 'jobStatus', 'job_status']);
  return status ? normalizeSamExtractJobStatus(status, 'pending') : null;
}

function buildSamAwardExtractJobKey(input: {
  candidate: ContractAwardsLookupCandidate;
  format: SamExtractFormat;
  includeDeletedStatus: boolean;
  includeSections: string[];
}) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = deterministicHash(
    stableJsonStringify({
      day,
      contractId: input.candidate.contractId,
      piid: input.candidate.piid,
      referencedIdvPiid: input.candidate.referencedIdvPiid || null,
      format: input.format,
      includeDeletedStatus: input.includeDeletedStatus,
      includeSections: [...input.includeSections].sort()
    })
  );
  return `sam-awards-extract:${hash}`;
}

async function claimSamQuotaForSingleRequest(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ granted: boolean; quota: Record<string, unknown> | null }> {
  const quota = await claimDailyQuota(supabase, {
    stateKey: 'artemis_sam_quota_state',
    limitKey: 'artemis_sam_daily_quota_limit',
    reserveKey: 'artemis_sam_daily_quota_reserve',
    requested: 1,
    defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
    defaultReserve: DEFAULT_SAM_DAILY_RESERVE
  });
  return {
    granted: quota.granted > 0,
    quota: quota as unknown as Record<string, unknown>
  };
}

async function fetchSamAwardExtractJobsForProcessing(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  pollLimit: number
): Promise<SamAwardExtractJobRow[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(pollLimit)));
  const { data, error } = await supabase
    .from('sam_awards_extract_jobs')
    .select(
      'id,job_key,contract_id,contract_key,mission_key,program_scope,piid,referenced_idv_piid,extract_format,request_url,status,token,job_status_url,download_url,response_status,row_count,source_document_id,last_error,payload,updated_at'
    )
    .in('status', ['requested', 'pending', 'processing', 'ready'])
    .order('updated_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    job_key: String(row.job_key),
    contract_id: String(row.contract_id),
    contract_key: String(row.contract_key),
    mission_key: stringOrNull(row.mission_key),
    program_scope: stringOrNull(row.program_scope),
    piid: String(row.piid || ''),
    referenced_idv_piid: stringOrNull(row.referenced_idv_piid),
    extract_format: parseSamExtractFormat(stringOrNull(row.extract_format)),
    request_url: String(row.request_url || ''),
    status: normalizeSamExtractJobStatus(stringOrNull(row.status), 'pending'),
    token: stringOrNull(row.token),
    job_status_url: stringOrNull(row.job_status_url),
    download_url: stringOrNull(row.download_url),
    response_status: numberOrNull(row.response_status),
    row_count: numberOrNull(row.row_count),
    source_document_id: stringOrNull(row.source_document_id),
    last_error: stringOrNull(row.last_error),
    payload: safeRecord(row.payload),
    updated_at: stringOrNull(row.updated_at)
  }));
}

async function upsertSamAwardExtractJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  row: Record<string, unknown>
) {
  const { error } = await supabase.from('sam_awards_extract_jobs').upsert(row, { onConflict: 'job_key' });
  if (error && error.code !== '42P01') throw error;
}

async function patchSamAwardExtractJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
  patch: Record<string, unknown>
) {
  const { error } = await supabase
    .from('sam_awards_extract_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error && error.code !== '42P01') throw error;
}

function buildCandidateFromSamExtractJob(job: SamAwardExtractJobRow): ContractAwardsLookupCandidate | null {
  const normalizedPiid = stringOrNull(job.piid);
  const contractId = stringOrNull(job.contract_id);
  if (!normalizedPiid || !contractId) return null;
  const normalizedScope = normalizeProgramScope(job.program_scope) || 'other';
  return {
    contractId,
    contractKey: stringOrNull(job.contract_key) || contractId,
    piid: normalizedPiid,
    referencedIdvPiid: stringOrNull(job.referenced_idv_piid),
    missionKey: missionKeyOrProgram(job.mission_key),
    awardeeName: null,
    description: null,
    programScope: normalizedScope,
    scopePriority: scopePriority(normalizedScope),
    missingActionCount: 0
  };
}

function deriveSamExtractPollUrl(input: {
  job: SamAwardExtractJobRow;
  apiUrl: string;
  apiKey: string;
}): string | null {
  const statusUrl = stringOrNull(input.job.job_status_url);
  if (statusUrl && /^https?:\/\//i.test(statusUrl)) return statusUrl;
  const token = stringOrNull(input.job.token);
  if (!token) return null;
  const url = new URL(input.apiUrl);
  url.searchParams.set('api_key', input.apiKey);
  url.searchParams.set('token', token);
  return url.toString();
}

function deriveSamExtractRows(payload: unknown, format: SamExtractFormat): SamContractAwardRow[] {
  if (format !== 'json') return [];
  const root = safeRecord(payload);
  const candidates: unknown[] = [payload, root.response, root.body, root.raw];
  for (const candidate of candidates) {
    const rows = extractContractAwardRows(candidate);
    if (rows.length > 0) return rows;
  }
  return [];
}

async function applySamAwardExtractRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    candidate: ContractAwardsLookupCandidate;
    rows: SamContractAwardRow[];
    sourceDocumentId: string | null;
    status: number;
    url: string;
    payload: unknown;
  }
) {
  const targetedIds = new Set<string>();
  if (!input.rows.length) {
    return {
      rowsFetched: 0,
      rowsUpserted: 0,
      rowsExisting: 0,
      contractsBackfilled: 0,
      actionsBackfilled: 0,
      ambiguousContracts: 0,
      targetedSolicitationIds: [] as string[]
    };
  }

  const response: SamContractAwardsResponse = {
    ok: true,
    status: input.status,
    url: sanitizeSamRequestUrl(input.url),
    method: 'GET',
    awards: input.rows,
    paging: {
      totalRecords: input.rows.length,
      limit: input.rows.length,
      offset: 0,
      truncated: false
    },
    body: input.payload
  };

  const upsertResult = await upsertSamContractAwardRows(supabase, {
    candidate: input.candidate,
    response,
    sourceDocumentId: input.sourceDocumentId
  });

  let contractsBackfilled = 0;
  let actionsBackfilled = 0;
  let ambiguousContracts = 0;
  const resolution = resolveSolicitationIdFromContractAwards(input.rows, input.candidate);
  if (resolution.ambiguous) {
    ambiguousContracts += 1;
  } else if (resolution.solicitationId) {
    const updatedActions = await backfillSolicitationIdForContractActions(
      supabase,
      input.candidate.contractId,
      resolution.solicitationId
    );
    if (updatedActions > 0) {
      contractsBackfilled += 1;
      actionsBackfilled += updatedActions;
      targetedIds.add(resolution.solicitationId);
    }
  }

  return {
    rowsFetched: upsertResult.fetched,
    rowsUpserted: upsertResult.inserted,
    rowsExisting: upsertResult.duplicates,
    contractsBackfilled,
    actionsBackfilled,
    ambiguousContracts,
    targetedSolicitationIds: [...targetedIds]
  };
}

async function requestSamAwardExtractJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    candidate: ContractAwardsLookupCandidate;
    apiKey: string;
    apiUrl: string;
    maxRequests: number;
    sessionToken: string | null;
    format: SamExtractFormat;
    includeDeletedStatus: boolean;
    includeSections: string[];
  }
): Promise<SamAwardsExtractProcessingResult> {
  const result = createEmptySamAwardsExtractProcessingResult();
  if (input.maxRequests < 1) {
    result.samRunCapReached = true;
    return result;
  }

  const jobKey = buildSamAwardExtractJobKey({
    candidate: input.candidate,
    format: input.format,
    includeDeletedStatus: input.includeDeletedStatus,
    includeSections: input.includeSections
  });

  const { data: existingJob, error: existingError } = await supabase
    .from('sam_awards_extract_jobs')
    .select('id,status')
    .eq('job_key', jobKey)
    .maybeSingle();
  if (existingError && existingError.code !== '42P01') throw existingError;
  if (existingJob) {
    result.jobsSkipped = 1;
    const existingStatus = normalizeSamExtractJobStatus((existingJob as Record<string, unknown>).status, 'pending');
    if (existingStatus === 'ready') result.jobsReady = 1;
    if (existingStatus === 'failed') result.jobsFailed = 1;
    return result;
  }

  result.samRequestsAttempted += 1;
  const quotaClaim = await claimSamQuotaForSingleRequest(supabase);
  result.samQuota = quotaClaim.quota;
  if (!quotaClaim.granted) {
    result.samQuotaBlocked = true;
    result.stopReason = 'sam_quota_blocked';
    return result;
  }
  result.samRequestsGranted += 1;

  const url = new URL(input.apiUrl);
  url.searchParams.set('api_key', input.apiKey);
  url.searchParams.set('piid', input.candidate.piid);
  if (input.candidate.referencedIdvPiid) {
    url.searchParams.set('referencedIdvPiid', input.candidate.referencedIdvPiid);
  }
  if (input.includeDeletedStatus) {
    url.searchParams.set('deletedStatus', 'yes');
  }
  if (Array.isArray(input.includeSections) && input.includeSections.length > 0) {
    url.searchParams.set('includeSections', input.includeSections.join(','));
  }
  url.searchParams.set('format', input.format);

  let responseStatus = 598;
  let responseOk = false;
  let body: unknown = null;
  try {
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json,*/*' }
    });
    responseStatus = response.status;
    responseOk = response.ok;
    body = await parseApiResponsePayload(response);
  } catch (error) {
    body = {
      error: 'sam_http_timeout',
      message: stringifyError(error)
    };
  }
  const stopReason = classifySamStopReason(responseStatus, body);
  if (stopReason) result.stopReason = stopReason;

  const rows = deriveSamExtractRows(body, input.format);
  const statusFromPayload = extractSamExtractStatus(body);
  const token = extractSamExtractToken(body);
  const pollUrl = extractSamExtractStatusUrl(body);
  const downloadUrl = extractSamExtractDownloadUrl(body);
  let status: SamExtractJobStatus = responseOk ? statusFromPayload || (rows.length > 0 || downloadUrl ? 'ready' : 'pending') : 'failed';
  if (status === 'requested') status = 'pending';
  if (status === 'applied') status = 'ready';

  const sourceDocId = await insertSourceDocument(supabase, {
    sourceKey: CHECKPOINT_SAM_CONTRACT_AWARDS,
    sourceType: 'procurement',
    url: sanitizeSamRequestUrl(url.toString()),
    title: `SAM contract awards extract request (${input.candidate.contractKey})`,
    summary: `SAM contract awards extract request status ${responseStatus}; extracted ${rows.length} rows for PIID ${input.candidate.piid}.`,
    announcedTime: new Date().toISOString(),
    httpStatus: responseStatus,
    contentType: 'application/json',
    raw: {
      samSessionToken: input.sessionToken || null,
      contractId: input.candidate.contractId,
      contractKey: input.candidate.contractKey,
      piid: input.candidate.piid,
      referencedIdvPiid: input.candidate.referencedIdvPiid,
      format: input.format,
      includeDeletedStatus: input.includeDeletedStatus,
      includeSections: input.includeSections,
      token,
      pollUrl,
      downloadUrl,
      rowCount: rows.length,
      body
    },
    error: responseOk ? null : `http_${responseStatus}`
  });
  result.sourceDocumentsInserted += 1;

  await upsertSamAwardExtractJob(supabase, {
    job_key: jobKey,
    contract_id: input.candidate.contractId,
    contract_key: input.candidate.contractKey,
    mission_key: input.candidate.missionKey,
    program_scope: input.candidate.programScope,
    piid: input.candidate.piid,
    referenced_idv_piid: input.candidate.referencedIdvPiid,
    extract_format: input.format,
    request_url: sanitizeSamRequestUrl(url.toString()),
    status,
    token,
    job_status_url: pollUrl,
    download_url: downloadUrl,
    response_status: responseStatus,
    row_count: rows.length,
    source_document_id: sourceDocId,
    last_error: responseOk ? null : `http_${responseStatus}`,
    payload: {
      sourceModel: 'sam-contract-awards-extract-request',
      response: body
    },
    updated_at: new Date().toISOString()
  });

  result.jobsRequested = 1;
  if (status === 'ready') result.jobsReady = 1;
  if (status === 'failed') result.jobsFailed = 1;

  if (rows.length > 0) {
    const applied = await applySamAwardExtractRows(supabase, {
      candidate: input.candidate,
      rows,
      sourceDocumentId: sourceDocId,
      status: responseStatus,
      url: sanitizeSamRequestUrl(url.toString()),
      payload: body
    });
    result.rowsFetched += applied.rowsFetched;
    result.rowsUpserted += applied.rowsUpserted;
    result.rowsExisting += applied.rowsExisting;
    result.contractsBackfilled += applied.contractsBackfilled;
    result.actionsBackfilled += applied.actionsBackfilled;
    result.ambiguousContracts += applied.ambiguousContracts;
    result.targetedSolicitationIds.push(...applied.targetedSolicitationIds);
    result.jobsApplied += 1;

    const { data: appliedJob, error: appliedJobError } = await supabase
      .from('sam_awards_extract_jobs')
      .select('id')
      .eq('job_key', jobKey)
      .maybeSingle();
    if (appliedJobError && appliedJobError.code !== '42P01') throw appliedJobError;
    if (appliedJob && (appliedJob as Record<string, unknown>).id) {
      await patchSamAwardExtractJob(supabase, String((appliedJob as Record<string, unknown>).id), {
        status: 'applied',
        row_count: applied.rowsFetched,
        last_error: null
      });
    }
  }

  return result;
}

async function processSamAwardExtractJobs(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    apiKey: string;
    apiUrl: string;
    maxRequests: number;
    sessionToken: string | null;
    pollLimit: number;
  }
): Promise<SamAwardsExtractProcessingResult> {
  const result = createEmptySamAwardsExtractProcessingResult();
  if (input.pollLimit < 1) return result;

  const jobs = await fetchSamAwardExtractJobsForProcessing(supabase, input.pollLimit);
  if (!jobs.length) return result;

  for (const job of jobs) {
    let currentStatus = normalizeSamExtractJobStatus(job.status, 'pending');
    let payload: unknown = job.payload || {};
    let responseStatus = numberOrNull(job.response_status) || 200;
    let sourceDocumentId = stringOrNull(job.source_document_id);
    let downloadUrl = stringOrNull(job.download_url);
    let token = stringOrNull(job.token);
    let jobStatusUrl = stringOrNull(job.job_status_url);
    let failureError = stringOrNull(job.last_error);
    let shouldStopAfterPatch = false;

    if (job.extract_format !== 'json') {
      currentStatus = 'failed';
      failureError = `unsupported_extract_format:${job.extract_format}`;
    }

    if (currentStatus === 'requested' || currentStatus === 'pending' || currentStatus === 'processing') {
      if (result.samRequestsGranted >= input.maxRequests) {
        result.samRunCapReached = true;
        break;
      }

      const pollUrl = deriveSamExtractPollUrl({ job: { ...job, token, job_status_url: jobStatusUrl }, apiUrl: input.apiUrl, apiKey: input.apiKey });
      if (pollUrl) {
        result.samRequestsAttempted += 1;
        const quotaClaim = await claimSamQuotaForSingleRequest(supabase);
        result.samQuota = quotaClaim.quota;
        if (!quotaClaim.granted) {
          result.samQuotaBlocked = true;
          result.stopReason = 'sam_quota_blocked';
          break;
        }
        result.samRequestsGranted += 1;

        let pollStatus = 598;
        let pollOk = false;
        let pollBody: unknown = null;
        try {
          const pollResponse = await fetchWithTimeout(pollUrl, {
            headers: { Accept: 'application/json,*/*' }
          });
          pollStatus = pollResponse.status;
          pollOk = pollResponse.ok;
          pollBody = await parseApiResponsePayload(pollResponse);
        } catch (error) {
          pollBody = {
            error: 'sam_http_timeout',
            message: stringifyError(error)
          };
        }
        const pollStopReason = classifySamStopReason(pollStatus, pollBody);
        if (pollStopReason) {
          result.stopReason = pollStopReason;
          currentStatus = 'failed';
          failureError = pollStopReason;
          responseStatus = pollStatus;
          payload = pollBody;
          shouldStopAfterPatch = true;
        }
        if (!shouldStopAfterPatch) {
          payload = pollBody;
          responseStatus = pollStatus;
          token = extractSamExtractToken(pollBody) || token;
          jobStatusUrl = extractSamExtractStatusUrl(pollBody) || jobStatusUrl;
          downloadUrl = extractSamExtractDownloadUrl(pollBody) || downloadUrl;
          const payloadStatus = extractSamExtractStatus(pollBody);
          currentStatus = pollOk
            ? payloadStatus || (deriveSamExtractRows(pollBody, job.extract_format).length > 0 || downloadUrl ? 'ready' : 'processing')
            : 'failed';
          if (currentStatus === 'requested') currentStatus = 'pending';
          if (currentStatus === 'applied') currentStatus = 'ready';
          result.jobsPolled += 1;

          const pollDocId = await insertSourceDocument(supabase, {
            sourceKey: CHECKPOINT_SAM_CONTRACT_AWARDS,
            sourceType: 'procurement',
            url: sanitizeSamRequestUrl(pollUrl),
            title: `SAM contract awards extract poll (${job.contract_key})`,
            summary: `SAM contract awards extract poll status ${pollStatus}; inferred state ${currentStatus}.`,
            announcedTime: new Date().toISOString(),
            httpStatus: pollStatus,
            contentType: 'application/json',
            raw: {
              samSessionToken: input.sessionToken || null,
              contractId: job.contract_id,
              contractKey: job.contract_key,
              token,
              statusUrl: jobStatusUrl,
              downloadUrl,
              status: currentStatus,
              body: pollBody
            },
            error: pollOk ? null : `http_${pollStatus}`
          });
          result.sourceDocumentsInserted += 1;
          sourceDocumentId = pollDocId;
        }
      } else {
        currentStatus = 'failed';
        failureError = 'missing_poll_url_or_token';
      }
    }

    let rows = deriveSamExtractRows(payload, job.extract_format);
    if (!shouldStopAfterPatch && currentStatus === 'ready' && rows.length < 1 && downloadUrl && job.extract_format === 'json') {
      if (result.samRequestsGranted >= input.maxRequests) {
        result.samRunCapReached = true;
        break;
      }
      result.samRequestsAttempted += 1;
      const quotaClaim = await claimSamQuotaForSingleRequest(supabase);
      result.samQuota = quotaClaim.quota;
      if (!quotaClaim.granted) {
        result.samQuotaBlocked = true;
        result.stopReason = 'sam_quota_blocked';
        break;
      }
      result.samRequestsGranted += 1;

      let downloadStatus = 598;
      let downloadOk = false;
      let downloadPayload: unknown = null;
      try {
        const downloadResponse = await fetchWithTimeout(downloadUrl, {
          headers: { Accept: 'application/json,*/*' }
        });
        downloadStatus = downloadResponse.status;
        downloadOk = downloadResponse.ok;
        downloadPayload = await parseApiResponsePayload(downloadResponse);
      } catch (error) {
        downloadPayload = {
          error: 'sam_http_timeout',
          message: stringifyError(error)
        };
      }
      const downloadStopReason = classifySamStopReason(downloadStatus, downloadPayload);
      if (downloadStopReason) {
        result.stopReason = downloadStopReason;
        currentStatus = 'failed';
        failureError = downloadStopReason;
        responseStatus = downloadStatus;
        payload = downloadPayload;
        shouldStopAfterPatch = true;
      }
      if (!shouldStopAfterPatch) {
        payload = downloadPayload;
        responseStatus = downloadStatus;
        rows = deriveSamExtractRows(downloadPayload, job.extract_format);

        const downloadDocId = await insertSourceDocument(supabase, {
          sourceKey: CHECKPOINT_SAM_CONTRACT_AWARDS,
          sourceType: 'procurement',
          url: sanitizeSamRequestUrl(downloadUrl),
          title: `SAM contract awards extract download (${job.contract_key})`,
          summary: `SAM contract awards extract download status ${downloadStatus}; extracted ${rows.length} rows.`,
          announcedTime: new Date().toISOString(),
          httpStatus: downloadStatus,
          contentType: 'application/json',
          raw: {
            samSessionToken: input.sessionToken || null,
            contractId: job.contract_id,
            contractKey: job.contract_key,
            rowCount: rows.length,
            body: downloadPayload
          },
          error: downloadOk ? null : `http_${downloadStatus}`
        });
        result.sourceDocumentsInserted += 1;
        sourceDocumentId = downloadDocId;
      }
    }

    if (currentStatus === 'ready') result.jobsReady += 1;
    if (currentStatus === 'failed') result.jobsFailed += 1;

    const candidate = buildCandidateFromSamExtractJob(job);
    if (currentStatus === 'ready' && !candidate) {
      currentStatus = 'failed';
      failureError = failureError || 'extract_job_candidate_not_resolvable';
      result.jobsFailed += 1;
    }
    if (currentStatus === 'ready' && candidate) {
      const applied = await applySamAwardExtractRows(supabase, {
        candidate,
        rows,
        sourceDocumentId,
        status: responseStatus,
        url: stringOrNull(job.request_url) || input.apiUrl,
        payload
      });
      result.rowsFetched += applied.rowsFetched;
      result.rowsUpserted += applied.rowsUpserted;
      result.rowsExisting += applied.rowsExisting;
      result.contractsBackfilled += applied.contractsBackfilled;
      result.actionsBackfilled += applied.actionsBackfilled;
      result.ambiguousContracts += applied.ambiguousContracts;
      result.targetedSolicitationIds.push(...applied.targetedSolicitationIds);
      currentStatus = 'applied';
      result.jobsApplied += 1;
    }

    await patchSamAwardExtractJob(supabase, job.id, {
      status: currentStatus,
      token,
      job_status_url: jobStatusUrl,
      download_url: downloadUrl,
      response_status: responseStatus,
      row_count: rows.length > 0 ? rows.length : numberOrNull(job.row_count),
      source_document_id: sourceDocumentId,
      last_error: currentStatus === 'failed' ? failureError || `http_${responseStatus}` : null,
      payload: {
        sourceModel: 'sam-contract-awards-extract-processing',
        response: payload
      }
    });
    if (shouldStopAfterPatch) break;
  }

  result.targetedSolicitationIds = uniqueNonEmptyStrings(result.targetedSolicitationIds);
  return result;
}

async function backfillSolicitationsFromExistingSamAwardRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    targetScopes: readonly ProgramScope[];
    excludedContractIds?: Array<string> | Set<string>;
  }
): Promise<ExistingSamAwardSolicitationBackfillResult> {
  const result: ExistingSamAwardSolicitationBackfillResult = {
    contractsEvaluated: 0,
    awardRowsReferenced: 0,
    contractsBackfilled: 0,
    actionsBackfilled: 0,
    ambiguousContracts: 0,
    targetedSolicitationIds: [],
    backfilledContractIds: []
  };

  const normalizedTargetScopes = normalizeProgramScopeOrder(input.targetScopes);
  const targetScopeSet = new Set(normalizedTargetScopes);

  const excluded = new Set<string>();
  if (input.excludedContractIds) {
    for (const contractId of input.excludedContractIds) {
      const normalizedContractId = stringOrNull(contractId);
      if (normalizedContractId) excluded.add(normalizedContractId);
    }
  }

  const { data: actionRows, error: actionsError } = await supabase
    .from('artemis_contract_actions')
    .select('contract_id,updated_at')
    .is('solicitation_id', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(SAM_EXISTING_AWARD_BACKFILL_ACTION_SCAN_LIMIT);
  if (actionsError) throw actionsError;

  const orderedContractIds: string[] = [];
  const missingCountByContract = new Map<string, number>();
  for (const row of (actionRows || []) as Array<Record<string, unknown>>) {
    const contractId = stringOrNull(row.contract_id);
    if (!contractId || excluded.has(contractId)) continue;
    if (!missingCountByContract.has(contractId)) {
      orderedContractIds.push(contractId);
      missingCountByContract.set(contractId, 0);
    }
    missingCountByContract.set(contractId, Number(missingCountByContract.get(contractId) || 0) + 1);
  }

  if (!orderedContractIds.length) return result;

  const contractRows = await fetchContractsByIds(supabase, orderedContractIds);
  const contractsById = new Map(
    ((contractRows || []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );

  const candidates: ContractAwardsLookupCandidate[] = [];
  for (const contractId of orderedContractIds) {
    const row = contractsById.get(contractId);
    if (!row) continue;

    const missionKey = missionKeyOrProgram(row.mission_key);
    const awardeeName = stringOrNull(row.awardee_name);
    const description = stringOrNull(row.description);
    const contractKey = stringOrNull(row.contract_key);
    const programScope = inferContractProgramScope({
      missionKey,
      awardeeName,
      description,
      metadata: safeRecord(row.metadata),
      contractKey
    });
    if (!targetScopeSet.has(programScope)) continue;

    const lookupIds = normalizeSamLookupIdentifiers(stringOrNull(row.piid), stringOrNull(row.referenced_idv_piid));
    candidates.push({
      contractId,
      contractKey: contractKey || contractId,
      piid: lookupIds.piid || '',
      referencedIdvPiid: lookupIds.referencedIdvPiid,
      missionKey,
      awardeeName,
      description,
      programScope,
      scopePriority: scopePriority(programScope),
      missingActionCount: Number(missingCountByContract.get(contractId) || 0)
    });
  }

  if (!candidates.length) return result;

  const rowsByContract = await fetchExistingSamAwardRowsByContractIds(
    supabase,
    candidates.map((candidate) => candidate.contractId)
  );

  const targetedIds = new Set<string>();
  for (const candidate of candidates) {
    const cachedRows = rowsByContract.get(candidate.contractId) || [];
    if (cachedRows.length < 1) continue;

    result.contractsEvaluated += 1;
    result.awardRowsReferenced += cachedRows.length;

    const resolution = resolveSolicitationIdFromContractAwards(cachedRows, candidate);
    if (resolution.ambiguous) {
      result.ambiguousContracts += 1;
      continue;
    }
    if (!resolution.solicitationId) continue;

    const updatedActions = await backfillSolicitationIdForContractActions(
      supabase,
      candidate.contractId,
      resolution.solicitationId
    );
    if (updatedActions < 1) continue;

    result.contractsBackfilled += 1;
    result.actionsBackfilled += updatedActions;
    targetedIds.add(resolution.solicitationId);
    result.backfilledContractIds.push(candidate.contractId);
  }

  result.targetedSolicitationIds = [...targetedIds];
  return result;
}

async function fetchExistingSamAwardRowsByContractIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contractIds: string[]
) {
  const normalizedContractIds = Array.from(new Set(contractIds.filter((contractId) => Boolean(contractId))));
  if (!normalizedContractIds.length) return new Map<string, SamContractAwardRow[]>();

  const rowsByContract = new Map<string, SamContractAwardRow[]>();
  for (const chunk of chunkArray(normalizedContractIds, CONTRACT_LOOKUP_FETCH_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_sam_contract_award_rows')
      .select('contract_id,solicitation_id,piid,referenced_idv_piid,metadata')
      .in('contract_id', chunk);

    if (error) throw error;
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const contractId = stringOrNull(row.contract_id);
      if (!contractId) continue;
      const award: SamContractAwardRow = {
        solicitationId: stringOrNull(row.solicitation_id),
        piid: stringOrNull(row.piid),
        referencedIdvPiid: stringOrNull(row.referenced_idv_piid),
        metadata: safeRecord(row.metadata)
      };
      const existing = rowsByContract.get(contractId) || [];
      existing.push(award);
      rowsByContract.set(contractId, existing);
    }
  }

  return rowsByContract;
}

async function fetchContractAwardsLookupCandidates(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  limit: number,
  targetScopes: readonly ProgramScope[] = TARGET_SAM_PROGRAM_SCOPES,
  excludedContractIds?: Array<string> | Set<string>
) {
  if (limit < 1) return [] as ContractAwardsLookupCandidate[];

  const excluded = new Set<string>();
  if (excludedContractIds) {
    for (const contractId of excludedContractIds) {
      const normalizedContractId = stringOrNull(contractId);
      if (normalizedContractId) excluded.add(normalizedContractId);
    }
  }

  const { data: actionRows, error: actionsError } = await supabase
    .from('artemis_contract_actions')
    .select('contract_id,updated_at')
    .is('solicitation_id', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (actionsError) throw actionsError;

  const orderedContractIds: string[] = [];
  const missingCountByContract = new Map<string, number>();
  for (const row of (actionRows || []) as Array<Record<string, unknown>>) {
    const contractId = stringOrNull(row.contract_id);
    if (!contractId) continue;
    if (!missingCountByContract.has(contractId)) {
      orderedContractIds.push(contractId);
      missingCountByContract.set(contractId, 0);
    }
    missingCountByContract.set(contractId, Number(missingCountByContract.get(contractId) || 0) + 1);
  }

  const normalizedCandidateIds = orderedContractIds.filter((contractId) => !excluded.has(contractId));
  if (!normalizedCandidateIds.length) return [] as ContractAwardsLookupCandidate[];
  const normalizedTargetScopes = normalizeProgramScopeOrder(targetScopes);
  const targetSet = new Set(normalizedTargetScopes);

  const contractIds = normalizedCandidateIds.slice(0, limit);
  const contractRows = await fetchContractsByIds(supabase, contractIds);

  const contractsById = new Map(
    ((contractRows || []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );

  const candidates: ContractAwardsLookupCandidate[] = [];
  for (const contractId of contractIds) {
    const row = contractsById.get(contractId);
    if (!row) continue;

    const piid = stringOrNull(row.piid);
    const contractKey = stringOrNull(row.contract_key);
    if (!piid || !contractKey) continue;
    const lookupIds = normalizeSamLookupIdentifiers(piid, stringOrNull(row.referenced_idv_piid));
    if (!lookupIds.piid) continue;
    const contractType = contractTypeOrUnknown(row.contract_type);
    const metadata = safeRecord(row.metadata);

    if (!isLikelySamContractLookupCandidate({ piid: lookupIds.piid, contractType, metadata })) {
      continue;
    }

    const missionKey = missionKeyOrProgram(row.mission_key);
    const awardeeName = stringOrNull(row.awardee_name);
    const description = stringOrNull(row.description);
    const programScope = inferContractProgramScope({
      missionKey,
      awardeeName,
      description,
      metadata,
      contractKey
    });

    if (!targetSet.has(programScope)) continue;

    candidates.push({
      contractId,
      contractKey,
      piid: lookupIds.piid,
      referencedIdvPiid: lookupIds.referencedIdvPiid,
      missionKey,
      awardeeName,
      description,
      programScope,
      scopePriority: scopePriority(programScope),
      missingActionCount: Number(missingCountByContract.get(contractId) || 0)
    });
  }

  for (const candidate of candidates) {
    excluded.add(candidate.contractId);
  }

  const sortedCandidates = candidates.sort((a, b) => {
    if (a.scopePriority !== b.scopePriority) return a.scopePriority - b.scopePriority;
    if (a.missingActionCount !== b.missingActionCount) return b.missingActionCount - a.missingActionCount;
    return a.contractKey.localeCompare(b.contractKey);
  });

  return interleaveScopeOrderedCandidates(sortedCandidates, normalizedTargetScopes);
}

function resolveSolicitationIdFromContractAwards(awards: SamContractAwardRow[], candidate: ContractAwardsLookupCandidate) {
  const candidatePiid = normalizeText(candidate.piid);
  const candidateRef = normalizeText(candidate.referencedIdvPiid);

  const exactPiidMatches = awards.filter((row) => normalizeText(row.piid) === candidatePiid);
  const exactRefMatches =
    candidateRef.length > 0
      ? awards.filter((row) => normalizeText(row.referencedIdvPiid) === candidateRef)
      : [];

  const scopedRows = exactPiidMatches.length ? exactPiidMatches : exactRefMatches.length ? exactRefMatches : awards;
  const solicitationIds = uniqueNonEmptyStrings(scopedRows.map((row) => row.solicitationId));

  if (solicitationIds.length === 1) {
    return { solicitationId: solicitationIds[0], ambiguous: false };
  }

  return { solicitationId: null, ambiguous: solicitationIds.length > 1 };
}

async function backfillSolicitationIdForContractActions(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contractId: string,
  solicitationId: string
) {
  const { data, error } = await supabase
    .from('artemis_contract_actions')
    .update({
      solicitation_id: solicitationId,
      updated_at: new Date().toISOString()
    })
    .eq('contract_id', contractId)
    .is('solicitation_id', null)
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

async function upsertSamContractAwardRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    candidate: ContractAwardsLookupCandidate;
    response: SamContractAwardsResponse;
    sourceDocumentId: string | null;
  }
): Promise<SamContractAwardRowUpsertResult> {
  if (!input.response.awards.length) {
    return {
      fetched: 0,
      inserted: 0,
      duplicates: 0
    };
  }

  const nowIso = new Date().toISOString();
  const rows = input.response.awards.map((award) => {
    const rawRow = safeRecord(award.metadata);
    const rowHash = deterministicHash(stableJsonStringify(rawRow));
    const rowKey = buildSamAwardRowKey({
      candidate: input.candidate,
      award,
      rowHash
    });

    return {
      row_key: rowKey,
      contract_id: input.candidate.contractId,
      contract_key: input.candidate.contractKey,
      mission_key: input.candidate.missionKey,
      program_scope: input.candidate.programScope,
      solicitation_id: award.solicitationId,
      piid: award.piid,
      referenced_idv_piid: award.referencedIdvPiid,
      response_status: input.response.status,
      source_document_id: input.sourceDocumentId,
      metadata: {
        row: rawRow,
        rowHash,
        extraction: {
          solicitationId: award.solicitationId,
          piid: award.piid,
          referencedIdvPiid: award.referencedIdvPiid
        },
        candidate: {
          contractId: input.candidate.contractId,
          contractKey: input.candidate.contractKey,
          missionKey: input.candidate.missionKey,
          programScope: input.candidate.programScope,
          awardeeName: input.candidate.awardeeName,
          description: input.candidate.description
        },
        request: {
          method: input.response.method,
          url: input.response.url
        },
        response: {
          status: input.response.status,
          paging: input.response.paging
        },
        sourceModel: 'sam-contract-awards-row-capture'
      },
      updated_at: nowIso
    };
  });

  const rowKeys = rows.map((row) => row.row_key);
  const existingRowKeys = await fetchExistingSamAwardRowKeys(supabase, rowKeys);
  const uniqueIncomingRows: Array<Record<string, unknown>> = [];
  const incomingSeen = new Set<string>();
  for (const row of rows) {
    if (incomingSeen.has(row.row_key)) continue;
    incomingSeen.add(row.row_key);
    if (existingRowKeys.has(row.row_key)) continue;
    uniqueIncomingRows.push(row);
  }

  const duplicates = rows.length - uniqueIncomingRows.length;
  if (!uniqueIncomingRows.length) {
    return {
      fetched: rows.length,
      inserted: 0,
      duplicates
    };
  }

  let total = 0;
  for (const chunk of chunkArray(uniqueIncomingRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('artemis_sam_contract_award_rows').upsert(chunk, { onConflict: 'row_key' });
    if (error) throw error;
    total += chunk.length;
  }

  return {
    fetched: rows.length,
    inserted: total,
    duplicates
  };
}

async function fetchExistingSamAwardRowKeys(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rowKeys: string[]
) {
  const normalizedRowKeys = Array.from(new Set(rowKeys.filter((rowKey) => Boolean(rowKey))));
  if (!normalizedRowKeys.length) return new Set<string>();

  const existing = new Set<string>();
  for (const chunk of chunkArray(normalizedRowKeys, SAM_AWARD_ROW_KEY_FETCH_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_sam_contract_award_rows')
      .select('row_key')
      .in('row_key', chunk);
    if (error) throw error;
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const rowKey = stringOrNull(row.row_key);
      if (rowKey) existing.add(rowKey);
    }
  }
  return existing;
}

async function fetchContractsByIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contractIds: string[]
) {
  const normalizedContractIds = Array.from(new Set(contractIds.filter((contractId) => Boolean(contractId))));
  if (!normalizedContractIds.length) return [] as Array<Record<string, unknown>>;

  const rows: Array<Record<string, unknown>> = [];
  for (const chunk of chunkArray(normalizedContractIds, CONTRACT_LOOKUP_FETCH_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artemis_contracts')
      .select('id,contract_key,piid,referenced_idv_piid,mission_key,awardee_name,description,contract_type,metadata')
      .in('id', chunk);
    if (error) throw error;
    rows.push(...((data || []) as Array<Record<string, unknown>>));
  }

  return rows;
}

function buildSamAwardRowKey(input: {
  candidate: ContractAwardsLookupCandidate;
  award: SamContractAwardRow;
  rowHash: string;
}) {
  return [
    input.candidate.contractId,
    input.award.solicitationId || 'na',
    input.award.piid || 'na',
    input.award.referencedIdvPiid || 'na',
    input.rowHash
  ].join('|');
}

function parseSamEntityAliasSeeds(value: unknown): SamEntityAliasSeed[] {
  const parsed = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    if (value && typeof value === 'object') {
      const row = safeRecord(value);
      if (Array.isArray(row.aliases)) return row.aliases;
      if (Array.isArray(row.values)) return row.values;
    }
    return null;
  })();
  if (!Array.isArray(parsed)) return DEFAULT_SAM_ENTITY_ALIAS_SEEDS;
  const seen = new Set<string>();
  const rows: SamEntityAliasSeed[] = [];
  for (const entry of parsed) {
    const row = safeRecord(entry);
    const legalBusinessName = stringOrNull(row.legalBusinessName) || stringOrNull(row.legal_business_name);
    const scope = normalizeProgramScope(stringOrNull(row.scope));
    if (!legalBusinessName) continue;
    if (scope !== 'blue-origin' && scope !== 'spacex') continue;
    const key = `${scope}|${legalBusinessName.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ scope, legalBusinessName });
  }
  return rows.length > 0 ? rows : DEFAULT_SAM_ENTITY_ALIAS_SEEDS;
}

function extractSamEntityRows(payload: unknown): Array<Record<string, unknown>> {
  const root = safeRecord(payload);
  const candidates: unknown[] = [
    root.data,
    root.results,
    root.rows,
    root.entities,
    root.entityData,
    safeRecord(root.data).entities,
    safeRecord(root.data).results,
    safeRecord(root.results).entities,
    safeRecord(root.results).rows
  ];
  const found = candidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(found)) return [];
  return found.map((row) => safeRecord(row));
}

function buildSamEntityRegistryUpserts(
  rows: Array<Record<string, unknown>>,
  alias: SamEntityAliasSeed
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const rawRow of rows) {
    const row = safeRecord(rawRow);
    const registration = safeRecord(row.entityRegistration);
    const parent = safeRecord(row.ultimateParent);
    const legalBusinessName =
      stringOrNull(readMetaString(row, 'legalBusinessName')) ||
      stringOrNull(readMetaString(registration, 'legalBusinessName')) ||
      stringOrNull(readMetaString(row, 'entityName')) ||
      alias.legalBusinessName;
    const uei =
      stringOrNull(readMetaString(row, 'ueiSAM')) ||
      stringOrNull(readMetaString(row, 'uei')) ||
      stringOrNull(readMetaString(registration, 'ueiSAM')) ||
      stringOrNull(readMetaString(registration, 'uei')) ||
      null;
    const cage =
      stringOrNull(readMetaString(row, 'cageCode')) ||
      stringOrNull(readMetaString(row, 'cage')) ||
      stringOrNull(readMetaString(registration, 'cageCode')) ||
      null;
    const parentUei =
      stringOrNull(readMetaString(parent, 'ueiSAM')) ||
      stringOrNull(readMetaString(parent, 'uei')) ||
      null;
    const parentLegalBusinessName =
      stringOrNull(readMetaString(parent, 'legalBusinessName')) ||
      stringOrNull(readMetaString(parent, 'entityName')) ||
      null;
    if (!legalBusinessName && !uei && !cage) continue;
    const entityKey =
      (uei && `uei:${uei.toUpperCase()}`) ||
      (cage && `cage:${cage.toUpperCase()}`) ||
      `name:${deterministicHash(`${alias.scope}|${String(legalBusinessName || '').toLowerCase()}`)}`;
    const isActiveSource =
      normalizeText(readMetaString(row, 'entityStatus')) ||
      normalizeText(readMetaString(registration, 'entityStatus')) ||
      normalizeText(readMetaString(row, 'registrationStatus'));
    const isActive = !isActiveSource || isActiveSource.includes('active');
    byKey.set(entityKey, {
      entity_key: entityKey,
      legal_business_name: legalBusinessName,
      uei,
      cage,
      parent_uei: parentUei,
      parent_legal_business_name: parentLegalBusinessName,
      is_active: isActive,
      metadata: {
        sourceModel: 'sam-entity-management-alias',
        scope: alias.scope,
        alias: alias.legalBusinessName,
        raw: row
      },
      updated_at: new Date().toISOString()
    });
  }
  return [...byKey.values()];
}

async function upsertSamEntityRegistryRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('sam_entity_registry').upsert(chunk, { onConflict: 'entity_key' });
    if (error) {
      if (error.code === '42P01') return total;
      throw error;
    }
    total += chunk.length;
  }
  return total;
}

async function syncSamEntityRegistry(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    apiKey: string;
    sessionToken: string | null;
  }
): Promise<SamEntitySyncResult> {
  const result: SamEntitySyncResult = {
    enabled: true,
    skipped: false,
    skippedReason: null,
    aliasesEvaluated: 0,
    aliasesSucceeded: 0,
    aliasesErrored: 0,
    requestsAttempted: 0,
    requestsGranted: 0,
    entitiesExtracted: 0,
    entitiesUpserted: 0,
    sourceDocumentsInserted: 0,
    lastStatus: null,
    samQuota: null,
    quotaBlocked: false,
    stopReason: null,
    errors: []
  };

  if (!input.apiKey) {
    result.skipped = true;
    result.skippedReason = 'missing_sam_api_key';
    return result;
  }
  const apiUrl = await readStringSetting(supabase, SETTING_SAM_ENTITY_API_URL, DEFAULT_SAM_ENTITY_API_URL);
  const normalizedApiUrl = stringOrNull(apiUrl);
  if (!normalizedApiUrl || !/^https?:\/\//i.test(normalizedApiUrl)) {
    result.skipped = true;
    result.skippedReason = 'missing_sam_entity_api_url';
    return result;
  }
  const aliasConfig = await readSystemSetting(supabase, SETTING_SAM_ENTITY_ALIAS_JSON);
  const aliases = parseSamEntityAliasSeeds(aliasConfig);
  result.aliasesEvaluated = aliases.length;

  for (const alias of aliases) {
    result.requestsAttempted += 1;
    const quotaClaim = await claimSamQuotaForSingleRequest(supabase);
    result.samQuota = quotaClaim.quota;
    if (!quotaClaim.granted) {
      result.quotaBlocked = true;
      result.stopReason = 'sam_quota_blocked';
      break;
    }
    result.requestsGranted += 1;
    const requestUrl = new URL(normalizedApiUrl);
    requestUrl.searchParams.set('api_key', input.apiKey);
    requestUrl.searchParams.set('legalBusinessName', alias.legalBusinessName);
    requestUrl.searchParams.set('page', '1');

    let response: Response;
    let body: unknown = null;
    try {
      response = await fetchWithTimeout(requestUrl.toString(), {
        headers: {
          Accept: 'application/json,*/*'
        }
      });
      body = await parseApiResponsePayload(response);
    } catch (error) {
      result.aliasesErrored += 1;
      result.errors.push(stringifyError(error));
      continue;
    }
    result.lastStatus = response.status;
    const entityRows = extractSamEntityRows(body);
    const registryRows = buildSamEntityRegistryUpserts(entityRows, alias);
    result.entitiesExtracted += registryRows.length;
    const upserted = await upsertSamEntityRegistryRows(supabase, registryRows);
    result.entitiesUpserted += upserted;
    if (response.ok) {
      result.aliasesSucceeded += 1;
    } else {
      result.aliasesErrored += 1;
      result.errors.push(`alias:${alias.legalBusinessName}:http_${response.status}`);
    }

    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: CHECKPOINT_SAM_ENTITIES,
      sourceType: 'procurement',
      url: sanitizeSamRequestUrl(requestUrl.toString()),
      title: `SAM entity alias lookup (${alias.scope}:${alias.legalBusinessName})`,
      summary: `SAM entity lookup status ${response.status}; extracted ${registryRows.length} entity rows.`,
      announcedTime: new Date().toISOString(),
      httpStatus: response.status,
      contentType: 'application/json',
      raw: {
        samSessionToken: input.sessionToken || null,
        scope: alias.scope,
        alias: alias.legalBusinessName,
        rowCount: registryRows.length,
        body
      },
      error: response.ok ? null : `http_${response.status}`
    });
    if (sourceDocId) result.sourceDocumentsInserted += 1;
  }

  return result;
}

async function fetchSamContractAwards(input: {
  candidate: ContractAwardsLookupCandidate;
  apiKey: string;
  apiUrl: string;
  sessionToken?: string | null;
  offset?: number;
  includeDeletedStatus?: boolean;
  includeSections?: string[];
}): Promise<SamContractAwardsResponse> {
  const requestedLimit = SAM_CONTRACT_AWARDS_LIMIT;
  const requestedOffset = Math.max(0, Math.trunc(input.offset || 0));
  const url = new URL(input.apiUrl);
  url.searchParams.set('api_key', input.apiKey);
  url.searchParams.set('piid', input.candidate.piid);
  if (input.candidate.referencedIdvPiid) {
    url.searchParams.set('referencedIdvPiid', input.candidate.referencedIdvPiid);
  }
  if (input.includeDeletedStatus) {
    url.searchParams.set('deletedStatus', 'yes');
  }
  if (Array.isArray(input.includeSections) && input.includeSections.length > 0) {
    url.searchParams.set('includeSections', input.includeSections.join(','));
  }
  url.searchParams.set('limit', String(requestedLimit));
  url.searchParams.set('offset', String(requestedOffset));

  const method: 'GET' = 'GET';
  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json,*/*'
      }
    });
  } catch (error) {
    if (!isAbortLikeError(error)) throw error;
    return {
      ok: false,
      status: 598,
      url: sanitizeSamRequestUrl(url.toString()),
      method,
      awards: [],
      paging: {
        totalRecords: null,
        limit: requestedLimit,
        offset: requestedOffset,
        truncated: false
      },
      body: {
        error: 'sam_http_timeout',
        message: `SAM contract awards request timed out after ${SAM_HTTP_TIMEOUT_MS}ms`
      }
    };
  }
  const body = await parseApiResponsePayload(response);

  return {
    ok: response.ok,
    status: response.status,
    url: sanitizeSamRequestUrl(url.toString()),
    method,
    awards: extractContractAwardRows(body),
    paging: extractSamPaging(body, { requestedLimit, requestedOffset }),
    body
  };
}

async function fetchSamOpportunities(input: {
  solicitationId: string | null;
  apiKey: string;
  apiUrl: string;
  lookbackDays: number;
  sessionToken?: string | null;
  offset?: number;
  keyword?: string | null;
  organizationName?: string | null;
  dateWindow?: {
    requestedLookbackDays: number;
    appliedLookbackDays: number;
    postedFrom: Date;
    postedToUtc: Date;
    clampReason: string | null;
  };
}): Promise<SamOpportunityResponse> {
  const dateWindow =
    input.dateWindow || buildSamOpportunityDateWindow(input.lookbackDays);
  const requestedLimit = SAM_OPPORTUNITIES_LIMIT;
  const requestedOffset = Math.max(0, Math.trunc(input.offset || 0));

  const url = new URL(input.apiUrl);
  url.searchParams.set('api_key', input.apiKey);
  if (input.solicitationId) {
    url.searchParams.set('solnum', input.solicitationId);
  }
  if (input.keyword) {
    url.searchParams.set('q', input.keyword);
  }
  if (input.organizationName) {
    url.searchParams.set('organizationName', input.organizationName);
  }
  url.searchParams.set('postedFrom', formatSamDate(dateWindow.postedFrom));
  url.searchParams.set('postedTo', formatSamDate(dateWindow.postedToUtc));
  url.searchParams.set('limit', String(requestedLimit));
  url.searchParams.set('offset', String(requestedOffset));

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json,*/*'
      }
    });
  } catch (error) {
    if (!isAbortLikeError(error)) throw error;
    return {
      ok: false,
      status: 598,
      url: sanitizeSamRequestUrl(url.toString()),
      dateWindow: {
        requestedLookbackDays: dateWindow.requestedLookbackDays,
        appliedLookbackDays: dateWindow.appliedLookbackDays,
        postedFrom: formatSamDate(dateWindow.postedFrom),
        postedTo: formatSamDate(dateWindow.postedToUtc),
        clampReason: dateWindow.clampReason || null
      },
      notices: [],
      paging: {
        totalRecords: null,
        limit: requestedLimit,
        offset: requestedOffset,
        truncated: false
      },
      body: {
        error: 'sam_http_timeout',
        message: `SAM opportunities request timed out after ${SAM_HTTP_TIMEOUT_MS}ms`
      }
    };
  }

  const body = await parseApiResponsePayload(response);

  return {
    ok: response.ok,
    status: response.status,
    url: sanitizeSamRequestUrl(url.toString()),
    dateWindow: {
      requestedLookbackDays: dateWindow.requestedLookbackDays,
      appliedLookbackDays: dateWindow.appliedLookbackDays,
      postedFrom: formatSamDate(dateWindow.postedFrom),
      postedTo: formatSamDate(dateWindow.postedToUtc),
      clampReason: dateWindow.clampReason || null
    },
    notices: extractOpportunityNotices(body, input.solicitationId || ''),
    paging: extractSamPaging(body, { requestedLimit, requestedOffset }),
    body
  };
}

async function parseApiResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { parseError: true, raw: text.slice(0, 2000) };
  }
}

function extractSamPaging(payload: unknown, defaults: { requestedLimit: number; requestedOffset: number }): SamPagingMeta {
  const root = safeRecord(payload);
  const totalRecords =
    numberOrNull(root.totalRecords) ?? numberOrNull(root.totalrecords) ?? numberOrNull(root.total_records) ?? null;
  const limit = numberOrNull(root.limit) ?? numberOrNull(root.pageSize) ?? defaults.requestedLimit;
  const offset = numberOrNull(root.offset) ?? defaults.requestedOffset;
  const truncated =
    totalRecords !== null &&
    limit !== null &&
    offset !== null &&
    totalRecords > 0 &&
    offset + limit < totalRecords;

  return {
    totalRecords,
    limit,
    offset,
    truncated
  };
}

function extractContractAwardRows(payload: unknown): SamContractAwardRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const candidates = [
    root.data,
    root.results,
    root.rows,
    root.awards,
    root.awardSummary,
    root.contractAwards,
    root.contract_awards,
    root.records
  ];
  const rows = candidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const data = safeRecord(row);
    const coreData = safeRecord(data.coreData);
    const oldContractId = safeRecord(data.oldContractId);
    const solicitation = safeRecord(data.solicitation);
    const contractId = safeRecord(data.contractId);
    const award = safeRecord(data.award);
    return {
      solicitationId:
        stringOrNull(readMetaString(data, 'solicitationId')) ||
        stringOrNull(readMetaString(data, 'solicitationID')) ||
        stringOrNull(readMetaString(data, 'solicitation_id')) ||
        stringOrNull(readMetaString(data, 'solicitationNumber')) ||
        stringOrNull(readMetaString(data, 'solicitation_number')) ||
        stringOrNull(readMetaString(coreData, 'solicitationId')) ||
        stringOrNull(readMetaString(coreData, 'solicitationID')) ||
        stringOrNull(readMetaString(coreData, 'solicitation_id')) ||
        stringOrNull(readMetaString(coreData, 'solicitationNumber')) ||
        stringOrNull(readMetaString(oldContractId, 'solicitationId')) ||
        stringOrNull(readMetaString(oldContractId, 'solicitationID')) ||
        stringOrNull(readMetaString(oldContractId, 'solicitation_id')) ||
        stringOrNull(readMetaString(contractId, 'solicitationId')) ||
        stringOrNull(readMetaString(contractId, 'solicitationID')) ||
        stringOrNull(readMetaString(solicitation, 'id')) ||
        stringOrNull(readMetaString(solicitation, 'number')) ||
        stringOrNull(readMetaString(award, 'solicitationId')) ||
        null,
      piid:
        stringOrNull(readMetaString(data, 'piid')) ||
        stringOrNull(readMetaString(data, 'PIID')) ||
        stringOrNull(readMetaString(data, 'awardId')) ||
        stringOrNull(readMetaString(data, 'award_id')) ||
        stringOrNull(readMetaString(contractId, 'piid')) ||
        stringOrNull(readMetaString(contractId, 'PIID')) ||
        stringOrNull(readMetaString(award, 'piid')) ||
        stringOrNull(readMetaString(award, 'awardId')) ||
        null,
      referencedIdvPiid:
        stringOrNull(readMetaString(data, 'referencedIdvPiid')) ||
        stringOrNull(readMetaString(data, 'referencedIDVPIID')) ||
        stringOrNull(readMetaString(data, 'referenced_idv_piid')) ||
        stringOrNull(readMetaString(contractId, 'referencedIdvPiid')) ||
        stringOrNull(readMetaString(contractId, 'referencedIDVPIID')) ||
        stringOrNull(readMetaString(contractId, 'referenced_idv_piid')) ||
        stringOrNull(readMetaString(award, 'referencedIdvPiid')) ||
        stringOrNull(readMetaString(award, 'referenced_idv_piid')) ||
        null,
      metadata: data
    };
  });
}

function readStringFromRecord(
  record: Record<string, unknown>,
  keys: Array<string>
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function readSamErrorMetadata(payload: unknown, keys: Array<string>) {
  const root = safeRecord(payload);
  return (
    readStringFromRecord(root, keys) ||
    readStringFromRecord(safeRecord(root.error), keys) ||
    readStringFromRecord(safeRecord(root.errors), keys) ||
    null
  );
}

function classifySamStopReason(status: number, payload?: unknown) {
  const errorCode = readSamErrorMetadata(payload, ['code', 'errorCode', 'error_code']);
  const errorMessage = (readSamErrorMetadata(payload, ['message', 'errorMessage', 'description']) || '').toLowerCase();
  const normalizedCode = (errorCode || '').toLowerCase();
  const isThrottled =
    normalizedCode.includes('throttl') ||
    normalizedCode.includes('over_rate') ||
    errorMessage.includes('throttl') ||
    errorMessage.includes('over_rate') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests');

  if (status === 429 || (status === 403 && isThrottled)) return 'sam_quota_throttled';
  if (status === 401 || status === 403) return `sam_auth_error_${status}`;
  if (status === 404) return 'sam_http_404_not_found';
  return null;
}

function sanitizeSamRequestUrl(value: string) {
  try {
    const url = new URL(value);
    url.searchParams.delete('api_key');
    url.searchParams.delete('apiKey');
    url.searchParams.delete('apikey');
    return url.toString();
  } catch {
    return value;
  }
}

function buildSamQueryFingerprint(input: { endpoint: 'contract-awards' | 'opportunities'; params: Record<string, unknown> }) {
  const normalizedParams = sortForStableJson(input.params) as Record<string, unknown>;
  const hash = deterministicHash(
    stableJsonStringify({
      endpoint: input.endpoint,
      params: normalizedParams
    })
  );
  return {
    endpoint: input.endpoint,
    normalizedParams,
    fingerprint: `${input.endpoint}:${hash}`
  };
}

async function readSamQueryExecutionGate(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    endpoint: 'contract-awards' | 'opportunities';
    params: Record<string, unknown>;
  }
): Promise<SamQueryExecutionGate> {
  const fingerprint = buildSamQueryFingerprint(input);
  const { data, error } = await supabase
    .from('sam_query_fingerprints')
    .select('cooldown_until,next_retry_at,consecutive_failures')
    .eq('fingerprint', fingerprint.fingerprint)
    .maybeSingle();
  if (error && error.code !== '42P01') throw error;
  const row = safeRecord(data);
  const nowMs = Date.now();
  const cooldownUntil = stringOrNull(row.cooldown_until);
  const nextRetryAt = stringOrNull(row.next_retry_at);
  const cooldownMs = cooldownUntil ? Date.parse(cooldownUntil) : Number.NaN;
  const retryMs = nextRetryAt ? Date.parse(nextRetryAt) : Number.NaN;
  const existingFailures = Math.max(0, Math.trunc(numberOrNull(row.consecutive_failures) || 0));
  if (Number.isFinite(cooldownMs) && cooldownMs > nowMs) {
    return {
      allowed: false,
      reason: 'sam_query_cooldown',
      cooldownUntil,
      nextRetryAt,
      existingFailures,
      fingerprint: fingerprint.fingerprint,
      normalizedParams: fingerprint.normalizedParams
    };
  }
  if (Number.isFinite(retryMs) && retryMs > nowMs) {
    return {
      allowed: false,
      reason: 'sam_query_retry_backoff',
      cooldownUntil,
      nextRetryAt,
      existingFailures,
      fingerprint: fingerprint.fingerprint,
      normalizedParams: fingerprint.normalizedParams
    };
  }
  return {
    allowed: true,
    reason: null,
    cooldownUntil,
    nextRetryAt,
    existingFailures,
    fingerprint: fingerprint.fingerprint,
    normalizedParams: fingerprint.normalizedParams
  };
}

function computeSamRetryBackoffIso(baseMinutes: number, consecutiveFailures: number) {
  const exponent = Math.max(0, Math.min(MAX_SAM_QUERY_RETRY_EXPONENT, Math.trunc(consecutiveFailures) - 1));
  const delayMinutes = Math.max(1, Math.trunc(baseMinutes)) * 2 ** exponent;
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function isSamRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

async function recordSamQueryExecutionOutcome(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    endpoint: 'contract-awards' | 'opportunities';
    gate: SamQueryExecutionGate;
    status: number;
    rowCount: number;
    duplicateOnly: boolean;
    policy: SamQueryPolicy;
    error: string | null;
  }
) {
  const status = Math.trunc(input.status);
  const rowCount = Math.max(0, Math.trunc(input.rowCount));
  const nowIso = new Date().toISOString();
  let consecutiveFailures = 0;
  let nextRetryAt: string | null = null;
  let cooldownUntil: string | null = null;

  if (isSamRetryableStatus(status)) {
    consecutiveFailures = Math.max(1, input.gate.existingFailures + 1);
    nextRetryAt = computeSamRetryBackoffIso(input.policy.retryBackoffBaseMinutes, consecutiveFailures);
  } else if (status >= 200 && status < 300) {
    consecutiveFailures = 0;
    nextRetryAt = null;
    if (rowCount < 1) {
      cooldownUntil = new Date(
        Date.now() + Math.max(1, Math.trunc(input.policy.emptyCooldownDays)) * MILLISECONDS_PER_DAY
      ).toISOString();
    } else if (input.duplicateOnly) {
      cooldownUntil = new Date(
        Date.now() + Math.max(1, Math.trunc(input.policy.duplicateCooldownHours)) * 60 * 60 * 1000
      ).toISOString();
    } else {
      cooldownUntil = null;
    }
  } else {
    consecutiveFailures = input.gate.existingFailures;
    nextRetryAt = null;
    cooldownUntil = null;
  }

  const payload = {
    endpoint: input.endpoint,
    fingerprint: input.gate.fingerprint,
    query_params: input.gate.normalizedParams,
    last_status: status,
    last_row_count: rowCount,
    last_error: input.error,
    consecutive_failures: consecutiveFailures,
    next_retry_at: nextRetryAt,
    cooldown_until: cooldownUntil,
    updated_at: nowIso
  };
  const { error } = await supabase.from('sam_query_fingerprints').upsert(payload, { onConflict: 'fingerprint' });
  if (error && error.code !== '42P01') throw error;
}

function isAbortLikeError(error: unknown) {
  const message = stringifyError(error).toLowerCase();
  return message.includes('abort') || message.includes('timed out') || message.includes('timeout');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = SAM_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpportunityNotices(payload: unknown, solicitationId: string): OpportunityNoticeRow[] {
  const rows = extractRows(payload);
  const nowIso = new Date().toISOString();

  return rows
    .map((row) => {
      const data = safeRecord(row);
      const noticeId =
        stringOrNull(readMetaString(data, 'noticeId')) ||
        stringOrNull(readMetaString(data, 'notice_id')) ||
        stringOrNull(readMetaString(data, 'id')) ||
        stringOrNull(readMetaString(data, 'uiLink')) ||
        null;
      if (!noticeId) return null;

      const title = stringOrNull(readMetaString(data, 'title')) || stringOrNull(readMetaString(data, 'solicitationTitle'));
      const postedDate =
        dateOnlyOrNull(readMetaString(data, 'postedDate')) ||
        dateOnlyOrNull(readMetaString(data, 'publishDate')) ||
        dateOnlyOrNull(readMetaString(data, 'archiveDate'));

      const responseDeadline =
        stringOrNull(readMetaString(data, 'responseDeadLine')) ||
        stringOrNull(readMetaString(data, 'response_deadline')) ||
        null;

      const awardAmount =
        numberOrNull(readMetaString(data, 'awardAmount')) || numberOrNull(safeRecord(data.award).amount) || null;

      const attachmentCount = Array.isArray(data.attachments)
        ? data.attachments.length
        : numberOrNull(readMetaString(data, 'attachmentCount'));

      return {
        notice_id: noticeId,
        solicitation_id:
          stringOrNull(readMetaString(data, 'solicitationNumber')) ||
          stringOrNull(readMetaString(data, 'solicitationId')) ||
          stringOrNull(readMetaString(data, 'solicitationID')) ||
          solicitationId,
        ptype: stringOrNull(readMetaString(data, 'ptype')) || stringOrNull(readMetaString(data, 'type')),
        title,
        posted_date: postedDate,
        response_deadline: responseDeadline,
        latest_active_version: true,
        awardee_name:
          stringOrNull(readMetaString(data, 'awardeeName')) || stringOrNull(safeRecord(data.award).awardee) || null,
        award_amount: awardAmount,
        notice_url:
          stringOrNull(readMetaString(data, 'uiLink')) ||
          stringOrNull(readMetaString(data, 'noticeUrl')) ||
          stringOrNull(readMetaString(data, 'link')) ||
          null,
        attachment_count: attachmentCount,
        source_document_id: null,
        metadata: data,
        updated_at: nowIso
      } satisfies OpportunityNoticeRow;
    })
    .filter((row): row is OpportunityNoticeRow => Boolean(row));
}

function extractRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;

  const candidates = [
    root.data,
    root.results,
    root.rows,
    root.opportunitiesData,
    root.opportunities,
    root.notice,
    root.notices
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

async function upsertOpportunityNotices(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  notices: OpportunityNoticeRow[]
): Promise<SamOpportunityNoticeUpsertResult> {
  return upsertOpportunityNoticeProjection(supabase, notices);
}

function normalizeSamOpportunitiesDataServicesRecord(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...input };
  const aliases: Record<string, string> = {
    noticeid: 'noticeId',
    solicitationid: 'solicitationId',
    solicitationnumber: 'solicitationNumber',
    ptype: 'ptype',
    type: 'type',
    title: 'title',
    posteddate: 'postedDate',
    publishdate: 'publishDate',
    archivedate: 'archiveDate',
    responsedeadline: 'responseDeadLine',
    responsedeadlinedate: 'responseDeadLine',
    responsedeadlineutc: 'responseDeadLine',
    uilink: 'uiLink',
    noticeurl: 'noticeUrl',
    link: 'link',
    awardamount: 'awardAmount',
    awardeename: 'awardeeName',
    attachmentcount: 'attachmentCount'
  };
  for (const [rawKey, value] of Object.entries(input)) {
    const normalizedKey = rawKey.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const alias = aliases[normalizedKey];
    if (!alias) continue;
    if (!Object.prototype.hasOwnProperty.call(normalized, alias) || normalized[alias] === null || normalized[alias] === '') {
      normalized[alias] = value;
    }
  }
  return normalized;
}

function parseCsvRows(text: string): Array<Record<string, unknown>> {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim().length > 0)) {
        lines.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) {
    lines.push(row);
  }

  if (lines.length < 2) return [];
  const headers = lines[0].map((value) => value.trim());
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = lines[i];
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j += 1) {
      const header = headers[j];
      if (!header) continue;
      record[header] = (values[j] || '').trim();
    }
    rows.push(normalizeSamOpportunitiesDataServicesRecord(record));
  }
  return rows;
}

function parseSamOpportunitiesDataServicesPayload(input: {
  bodyText: string;
  contentType: string | null;
}): {
  payload: unknown;
  notices: OpportunityNoticeRow[];
  format: 'json' | 'csv' | 'unknown';
} {
  const bodyText = input.bodyText || '';
  const contentType = (input.contentType || '').toLowerCase();
  const looksJson = contentType.includes('json') || /^[\s]*[\[{]/.test(bodyText);

  if (looksJson) {
    try {
      const payload = JSON.parse(bodyText);
      const notices = extractOpportunityNotices(payload, '');
      if (notices.length > 0) {
        return {
          payload,
          notices,
          format: 'json'
        };
      }
    } catch {
      // Fall through to CSV parser.
    }
  }

  const csvRows = parseCsvRows(bodyText);
  if (csvRows.length > 0) {
    const payload = { data: csvRows, source: 'sam_data_services_csv' };
    return {
      payload,
      notices: extractOpportunityNotices(payload, ''),
      format: 'csv'
    };
  }

  if (looksJson) {
    try {
      const payload = JSON.parse(bodyText);
      return { payload, notices: [], format: 'unknown' };
    } catch {
      // no-op
    }
  }
  return {
    payload: {
      parseError: true,
      contentType: contentType || null,
      preview: bodyText.slice(0, 2000)
    },
    notices: [],
    format: 'unknown'
  };
}

function extractSamOpportunitiesDataServicesManifestEntries(payload: unknown): SamOpportunitiesDataServicesManifestEntry[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const embedded = safeRecord(root._embedded);
  const rows = Array.isArray(embedded.customS3ObjectSummaryList) ? embedded.customS3ObjectSummaryList : [];
  if (rows.length < 1) return [];

  const entries: SamOpportunitiesDataServicesManifestEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = safeRecord(row);
    const links = safeRecord(record._links);
    const self = safeRecord(links.self);
    const href = stringOrNull(self.href);
    const bucketName = stringOrNull(record.bucketName);
    const key = stringOrNull(record.key);
    const fallbackHref = bucketName && key ? encodeURI(`https://s3.amazonaws.com/${bucketName}/${key}`) : null;
    const resolvedHref = href ? encodeURI(href) : fallbackHref;
    if (!resolvedHref || resolvedHref.endsWith('/')) continue;

    const displayKey = stringOrNull(record.displayKey);
    const normalizedFormat = normalizeText(stringOrNull(record.fileFormat));
    const displayKeyExt = normalizeText(displayKey || '').split('.').pop() || '';
    const supportedFormat =
      normalizedFormat === 'csv' ||
      normalizedFormat === 'json' ||
      displayKeyExt === 'csv' ||
      displayKeyExt === 'json';
    if (!supportedFormat) continue;
    if (seen.has(resolvedHref)) continue;
    seen.add(resolvedHref);
    entries.push({
      displayKey: displayKey || null,
      href: resolvedHref,
      fileFormat: stringOrNull(record.fileFormat),
      dateModified: stringOrNull(record.dateModified),
      bucketName: bucketName || null,
      key: key || null
    });
  }
  return entries;
}

function buildSamOpportunitiesManifestHash(entries: SamOpportunitiesDataServicesManifestEntry[]) {
  if (!entries.length) return '';
  const fingerprintRows = entries.map((entry) => ({
    href: entry.href || null,
    displayKey: entry.displayKey || null,
    fileFormat: entry.fileFormat || null,
    dateModified: entry.dateModified || null,
    key: entry.key || null
  }));
  return deterministicHash(stableJsonStringify(fingerprintRows));
}

function readSamOpportunitiesManifestCursors(
  metadata: Record<string, unknown>
): Partial<Record<SamOpportunitiesDataServicesSource, SamOpportunitiesDataServicesManifestCursor>> {
  const result: Partial<Record<SamOpportunitiesDataServicesSource, SamOpportunitiesDataServicesManifestCursor>> = {};
  const rawCursor = safeRecord(metadata.manifestCursor);
  for (const scope of ['active', 'archived'] as SamOpportunitiesDataServicesSource[]) {
    const entry = safeRecord(rawCursor[scope]);
    const manifestHash = stringOrNull(entry.manifestHash);
    const nextIndex = Math.max(0, Math.trunc(numberOrNull(entry.nextIndex) || 0));
    const totalEntries = Math.max(0, Math.trunc(numberOrNull(entry.totalEntries) || 0));
    if (!manifestHash) continue;
    result[scope] = {
      manifestHash,
      nextIndex,
      totalEntries,
      updatedAt: stringOrNull(entry.updatedAt) || new Date().toISOString()
    };
  }
  return result;
}

function parseContentLengthHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

async function upsertSamOpportunitySnapshotIngestRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  row: Record<string, unknown>
) {
  const { error } = await supabase
    .from('sam_opportunity_snapshot_ingest_runs')
    .upsert(row, { onConflict: 'snapshot_key' });
  if (error && !isMissingRelationError(error)) throw error;
}

async function syncSamOpportunitiesDataServicesSnapshots(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    apiKey: string;
    sessionToken: string | null;
    activeUrl: string;
    archivedUrl: string;
    apiKeyParam: string;
    timeoutMs: number;
    maxFilesPerSourcePerRun: number;
    maxFileBytes: number;
  }
): Promise<SamOpportunitiesDataServicesSyncResult> {
  const result: SamOpportunitiesDataServicesSyncResult = {
    enabled: true,
    skipped: false,
    skippedReason: null,
    maxFilesPerSourcePerRun: Math.max(1, Math.trunc(input.maxFilesPerSourcePerRun)),
    maxFileBytes: Math.max(1, Math.trunc(input.maxFileBytes)),
    sourcesEvaluated: 0,
    sourcesSucceeded: 0,
    sourcesErrored: 0,
    noticesFetched: 0,
    versionsFetched: 0,
    versionsUpserted: 0,
    versionsExisting: 0,
    projectionRowsUpserted: 0,
    projectionRowsExisting: 0,
    sourceDocumentsInserted: 0,
    manifestEntriesDiscovered: 0,
    manifestEntriesScanned: 0,
    manifestFilesDownloaded: 0,
    manifestFilesSkippedLarge: 0,
    manifestFilesDeferred: 0,
    errors: []
  };

  const sourceUrls: Array<{ scope: SamOpportunitiesDataServicesSource; url: string }> = [
    { scope: 'active', url: stringOrNull(input.activeUrl) || '' },
    { scope: 'archived', url: stringOrNull(input.archivedUrl) || '' }
  ];
  const configuredSources = sourceUrls.filter((source) => /^https?:\/\//i.test(source.url));
  if (configuredSources.length < 1) {
    result.skipped = true;
    result.skippedReason = 'missing_data_services_urls';
    const existingCheckpointMetadata = await safeCheckpointMetadata(supabase, CHECKPOINT_OPPORTUNITIES_DATA_SERVICES);
    await updateCheckpoint(supabase, CHECKPOINT_OPPORTUNITIES_DATA_SERVICES, {
      sourceType: 'procurement',
      status: 'complete',
      recordsIngested: 0,
      endedAt: new Date().toISOString(),
      lastError: null,
      metadata: {
        ...existingCheckpointMetadata,
        enabled: true,
        skipped: true,
        skippedReason: result.skippedReason
      }
    });
    return result;
  }

  const existingCheckpointMetadata = await safeCheckpointMetadata(supabase, CHECKPOINT_OPPORTUNITIES_DATA_SERVICES);
  const existingManifestCursors = readSamOpportunitiesManifestCursors(existingCheckpointMetadata);
  const manifestCursorUpdates: Partial<Record<SamOpportunitiesDataServicesSource, SamOpportunitiesDataServicesManifestCursor>> = {
    ...existingManifestCursors
  };

  for (const source of configuredSources) {
    result.sourcesEvaluated += 1;
    let requestUrl: URL;
    try {
      requestUrl = new URL(source.url);
    } catch {
      result.sourcesErrored += 1;
      result.errors.push(`invalid_url:${source.scope}`);
      continue;
    }
    const apiKeyParam = stringOrNull(input.apiKeyParam) || DEFAULT_SAM_OPPORTUNITIES_DATA_SERVICES_API_KEY_PARAM;
    if (input.apiKey && apiKeyParam && !requestUrl.searchParams.has(apiKeyParam)) {
      requestUrl.searchParams.set(apiKeyParam, input.apiKey);
    }

    let status = 598;
    let ok = false;
    let contentType: string | null = null;
    let bodyText = '';
    try {
      const response = await fetchWithTimeout(
        requestUrl.toString(),
        {
          headers: {
            Accept: 'application/json,text/csv,*/*'
          }
        },
        input.timeoutMs
      );
      status = response.status;
      ok = response.ok;
      contentType = response.headers.get('content-type');
      bodyText = await response.text();
    } catch (error) {
      result.sourcesErrored += 1;
      result.errors.push(`fetch_error:${source.scope}:${stringifyError(error)}`);
      continue;
    }

    const parsed = parseSamOpportunitiesDataServicesPayload({
      bodyText,
      contentType
    });
    const contentHash = deterministicHash(bodyText);
    const nowIso = new Date().toISOString();
    const sourceStream = source.scope === 'active' ? 'sam_data_services_active' : 'sam_data_services_archived';
    const ingestNoticeBatch = async (notices: OpportunityNoticeRow[], sourceDocumentId: string) => {
      if (notices.length < 1) return;
      const noticesWithDoc = notices.map((notice) => ({
        ...notice,
        source_document_id: sourceDocumentId,
        metadata: {
          ...safeRecord(notice.metadata),
          sourceStream
        },
        updated_at: new Date().toISOString()
      }));
      const versionUpsert = await upsertOpportunityNoticeVersions(supabase, {
        notices: noticesWithDoc,
        sourceStream,
        sourceDocumentId: sourceDocumentId
      });
      const projectionUpsert = await upsertOpportunityNoticeProjection(supabase, noticesWithDoc);
      result.noticesFetched += noticesWithDoc.length;
      result.versionsFetched += versionUpsert.fetched;
      result.versionsUpserted += versionUpsert.inserted;
      result.versionsExisting += versionUpsert.duplicates;
      result.projectionRowsUpserted += projectionUpsert.inserted;
      result.projectionRowsExisting += projectionUpsert.duplicates;
    };

    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: CHECKPOINT_OPPORTUNITIES_DATA_SERVICES,
      sourceType: 'procurement',
      url: sanitizeSamRequestUrl(requestUrl.toString()),
      title: `SAM opportunities data services (${source.scope})`,
      summary: `SAM opportunities data services ${source.scope} status ${status}; extracted ${parsed.notices.length} notices (${parsed.format}).`,
      announcedTime: nowIso,
      httpStatus: status,
      contentType: contentType || (parsed.format === 'csv' ? 'text/csv' : 'application/json'),
      raw: {
        samSessionToken: input.sessionToken || null,
        scope: source.scope,
        format: parsed.format,
        noticeCount: parsed.notices.length,
        contentHash,
        bodyPreview: bodyText.slice(0, 2000)
      },
      error: ok ? null : `http_${status}`
    });
    result.sourceDocumentsInserted += 1;

    await upsertSamOpportunitySnapshotIngestRun(supabase, {
      snapshot_key: `sam_opportunity_snapshot:${source.scope}:${contentHash}`,
      snapshot_scope: source.scope,
      request_url: sanitizeSamRequestUrl(requestUrl.toString()),
      response_status: status,
      content_hash: contentHash,
      notice_count: parsed.notices.length,
      source_document_id: sourceDocId,
      metadata: {
        format: parsed.format,
        contentType: contentType || null
      },
      updated_at: nowIso
    });

    if (!ok) {
      result.sourcesErrored += 1;
      result.errors.push(`http_${status}:${source.scope}`);
      continue;
    }
    let sourceIngested = false;
    let sourceDeferred = false;
    if (parsed.notices.length > 0) {
      await ingestNoticeBatch(parsed.notices, sourceDocId);
      sourceIngested = true;
      delete manifestCursorUpdates[source.scope];
    } else {
      const manifestEntries = extractSamOpportunitiesDataServicesManifestEntries(parsed.payload);
      result.manifestEntriesDiscovered += manifestEntries.length;
      if (manifestEntries.length < 1) {
        delete manifestCursorUpdates[source.scope];
        result.errors.push(`no_notice_rows:${source.scope}`);
      } else {
        const manifestHash = buildSamOpportunitiesManifestHash(manifestEntries);
        const priorCursor = manifestCursorUpdates[source.scope];
        const hasMatchingCursor = Boolean(priorCursor && priorCursor.manifestHash === manifestHash);
        const startIndex = hasMatchingCursor
          ? Math.max(0, Math.min(manifestEntries.length - 1, Math.trunc(priorCursor?.nextIndex || 0)))
          : 0;
        const downloadBudget = Math.max(1, Math.trunc(input.maxFilesPerSourcePerRun));
        let scannedEntries = 0;
        let downloadedEntries = 0;

        while (scannedEntries < manifestEntries.length && downloadedEntries < downloadBudget) {
          const entryIndex = (startIndex + scannedEntries) % manifestEntries.length;
          const entry = manifestEntries[entryIndex];
          scannedEntries += 1;
          result.manifestEntriesScanned += 1;
          if (!entry?.href) continue;

          let contentLength: number | null = null;
          try {
            const headResponse = await fetchWithTimeout(
              entry.href,
              {
                method: 'HEAD',
                headers: {
                  Accept: '*/*'
                }
              },
              Math.min(input.timeoutMs, 60_000)
            );
            if (headResponse.ok) {
              contentLength = parseContentLengthHeader(headResponse.headers.get('content-length'));
            }
          } catch {
            // Best-effort preflight; continue with GET.
          }

          if (typeof contentLength === 'number' && contentLength > result.maxFileBytes) {
            result.manifestFilesSkippedLarge += 1;
            result.errors.push(
              `manifest_skip_large:${source.scope}:${entry.displayKey || 'unknown'}:${contentLength}`
            );
            continue;
          }

          downloadedEntries += 1;
          result.manifestFilesDownloaded += 1;
          let entryStatus = 598;
          let entryOk = false;
          let entryContentType: string | null = null;
          let entryBodyText = '';
          try {
            const entryResponse = await fetchWithTimeout(
              entry.href,
              {
                headers: {
                  Accept: 'application/json,text/csv,*/*'
                }
              },
              input.timeoutMs
            );
            entryStatus = entryResponse.status;
            entryOk = entryResponse.ok;
            entryContentType = entryResponse.headers.get('content-type');
            entryBodyText = await entryResponse.text();
          } catch (error) {
            result.errors.push(`manifest_fetch_error:${source.scope}:${entry.displayKey || 'unknown'}:${stringifyError(error)}`);
            continue;
          }

          const entryParsed = parseSamOpportunitiesDataServicesPayload({
            bodyText: entryBodyText,
            contentType: entryContentType
          });
          const entryContentHash = deterministicHash(entryBodyText);
          const entryNowIso = new Date().toISOString();
          const entryDocId = await insertSourceDocument(supabase, {
            sourceKey: CHECKPOINT_OPPORTUNITIES_DATA_SERVICES,
            sourceType: 'procurement',
            url: sanitizeSamRequestUrl(entry.href),
            title: `SAM opportunities data services (${source.scope}:${entry.displayKey || 'file'})`,
            summary: `SAM opportunities data services file ${entry.displayKey || 'unknown'} status ${entryStatus}; extracted ${entryParsed.notices.length} notices (${entryParsed.format}).`,
            announcedTime: entryNowIso,
            httpStatus: entryStatus,
            contentType: entryContentType || (entryParsed.format === 'csv' ? 'text/csv' : 'application/json'),
            raw: {
              samSessionToken: input.sessionToken || null,
              scope: source.scope,
              displayKey: entry.displayKey,
              fileFormat: entry.fileFormat,
              dateModified: entry.dateModified,
              bucketName: entry.bucketName,
              key: entry.key,
              contentLength,
              format: entryParsed.format,
              noticeCount: entryParsed.notices.length,
              contentHash: entryContentHash,
              bodyPreview: entryBodyText.slice(0, 2000)
            },
            error: entryOk ? null : `http_${entryStatus}`
          });
          result.sourceDocumentsInserted += 1;

          await upsertSamOpportunitySnapshotIngestRun(supabase, {
            snapshot_key: `sam_opportunity_snapshot:${source.scope}:${deterministicHash(entry.href)}:${entryContentHash}`,
            snapshot_scope: source.scope,
            request_url: sanitizeSamRequestUrl(entry.href),
            response_status: entryStatus,
            content_hash: entryContentHash,
            notice_count: entryParsed.notices.length,
            source_document_id: entryDocId,
            metadata: {
              displayKey: entry.displayKey,
              fileFormat: entry.fileFormat,
              dateModified: entry.dateModified,
              contentLength,
              format: entryParsed.format,
              contentType: entryContentType || null
            },
            updated_at: entryNowIso
          });

          if (!entryOk) {
            result.errors.push(`manifest_http_${entryStatus}:${source.scope}:${entry.displayKey || 'unknown'}`);
            continue;
          }
          if (entryParsed.notices.length < 1) {
            result.errors.push(`manifest_no_notice_rows:${source.scope}:${entry.displayKey || 'unknown'}`);
            continue;
          }

          await ingestNoticeBatch(entryParsed.notices, entryDocId);
          sourceIngested = true;
        }

        if (manifestEntries.length > scannedEntries) {
          sourceDeferred = true;
          result.manifestFilesDeferred += manifestEntries.length - scannedEntries;
        }
        manifestCursorUpdates[source.scope] = {
          manifestHash,
          nextIndex: manifestEntries.length > 0 ? (startIndex + scannedEntries) % manifestEntries.length : 0,
          totalEntries: manifestEntries.length,
          updatedAt: new Date().toISOString()
        };
      }
    }

    if (sourceIngested || sourceDeferred) {
      result.sourcesSucceeded += 1;
    } else {
      result.sourcesErrored += 1;
    }
  }

  const checkpointStatus = result.sourcesErrored > 0 && result.sourcesSucceeded < 1 ? 'error' : 'complete';
  await updateCheckpoint(supabase, CHECKPOINT_OPPORTUNITIES_DATA_SERVICES, {
    sourceType: 'procurement',
    status: checkpointStatus,
    recordsIngested: result.versionsUpserted,
    endedAt: new Date().toISOString(),
    lastError: result.errors[0] || null,
    metadata: {
      ...existingCheckpointMetadata,
      enabled: result.enabled,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
      maxFilesPerSourcePerRun: result.maxFilesPerSourcePerRun,
      maxFileBytes: result.maxFileBytes,
      sourcesEvaluated: result.sourcesEvaluated,
      sourcesSucceeded: result.sourcesSucceeded,
      sourcesErrored: result.sourcesErrored,
      noticesFetched: result.noticesFetched,
      versionsFetched: result.versionsFetched,
      versionsUpserted: result.versionsUpserted,
      versionsExisting: result.versionsExisting,
      projectionRowsUpserted: result.projectionRowsUpserted,
      projectionRowsExisting: result.projectionRowsExisting,
      sourceDocumentsInserted: result.sourceDocumentsInserted,
      manifestEntriesDiscovered: result.manifestEntriesDiscovered,
      manifestEntriesScanned: result.manifestEntriesScanned,
      manifestFilesDownloaded: result.manifestFilesDownloaded,
      manifestFilesSkippedLarge: result.manifestFilesSkippedLarge,
      manifestFilesDeferred: result.manifestFilesDeferred,
      manifestCursor: manifestCursorUpdates,
      errors: result.errors
    }
  });

  return result;
}

function choosePreferredOpportunityProjection(existing: OpportunityNoticeRow, candidate: OpportunityNoticeRow): OpportunityNoticeRow {
  const existingPosted = Date.parse(existing.posted_date || '');
  const candidatePosted = Date.parse(candidate.posted_date || '');
  const existingPostedMs = Number.isFinite(existingPosted) ? existingPosted : 0;
  const candidatePostedMs = Number.isFinite(candidatePosted) ? candidatePosted : 0;
  if (candidatePostedMs > existingPostedMs) return candidate;
  if (candidatePostedMs < existingPostedMs) return existing;

  const existingUpdated = Date.parse(existing.updated_at || '');
  const candidateUpdated = Date.parse(candidate.updated_at || '');
  const existingUpdatedMs = Number.isFinite(existingUpdated) ? existingUpdated : 0;
  const candidateUpdatedMs = Number.isFinite(candidateUpdated) ? candidateUpdated : 0;
  if (candidateUpdatedMs > existingUpdatedMs) return candidate;

  return existing;
}

async function upsertOpportunityNoticeProjection(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  notices: OpportunityNoticeRow[]
): Promise<SamOpportunityNoticeUpsertResult> {
  if (!notices.length) {
    return {
      fetched: 0,
      inserted: 0,
      duplicates: 0
    };
  }

  const byNoticeId = new Map<string, OpportunityNoticeRow>();
  for (const notice of notices) {
    const existing = byNoticeId.get(notice.notice_id);
    if (!existing) {
      byNoticeId.set(notice.notice_id, notice);
      continue;
    }
    byNoticeId.set(notice.notice_id, choosePreferredOpportunityProjection(existing, notice));
  }
  const normalizedNotices = [...byNoticeId.values()];
  const noticeIds = normalizedNotices.map((notice) => notice.notice_id);
  const existingNoticeIds = await fetchExistingNoticeIds(supabase, noticeIds);
  let inserted = 0;
  for (const notice of normalizedNotices) {
    if (!existingNoticeIds.has(notice.notice_id)) inserted += 1;
  }

  for (const chunk of chunkArray(normalizedNotices, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('artemis_opportunity_notices').upsert(chunk, { onConflict: 'notice_id' });
    if (error) {
      if (error.code === '42P01') {
        return {
          fetched: 0,
          inserted: 0,
          duplicates: 0
        };
      }
      throw error;
    }
  }

  return {
    fetched: normalizedNotices.length,
    inserted,
    duplicates: normalizedNotices.length - inserted
  };
}

function buildOpportunityVersionKey(notice: OpportunityNoticeRow) {
  const contentHash = deterministicHash(stableJsonStringify(safeRecord(notice.metadata)));
  return {
    noticeVersionKey: `${notice.notice_id}|${contentHash}`,
    contentHash
  };
}

async function fetchExistingOpportunityVersionKeys(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  noticeVersionKeys: string[]
) {
  const normalizedKeys = Array.from(new Set(noticeVersionKeys.filter((value) => value.length > 0)));
  if (!normalizedKeys.length) return new Set<string>();

  const existing = new Set<string>();
  for (const chunk of chunkArray(normalizedKeys, 250)) {
    const { data, error } = await supabase
      .from('artemis_opportunity_notice_versions')
      .select('notice_version_key')
      .in('notice_version_key', chunk);
    if (error) {
      if (isMissingRelationError(error)) return new Set<string>();
      throw error;
    }
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const key = stringOrNull(row.notice_version_key);
      if (key) existing.add(key);
    }
  }
  return existing;
}

async function upsertOpportunityNoticeVersions(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    notices: OpportunityNoticeRow[];
    sourceStream: 'sam_data_services_active' | 'sam_data_services_archived' | 'sam_api_delta';
    sourceDocumentId: string | null;
  }
): Promise<SamOpportunityNoticeVersionUpsertResult> {
  if (!input.notices.length) {
    return {
      fetched: 0,
      inserted: 0,
      duplicates: 0
    };
  }

  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const notice of input.notices) {
    const { noticeVersionKey, contentHash } = buildOpportunityVersionKey(notice);
    if (seen.has(noticeVersionKey)) continue;
    seen.add(noticeVersionKey);
    rows.push({
      notice_version_key: noticeVersionKey,
      notice_id: notice.notice_id,
      solicitation_id: notice.solicitation_id,
      ptype: notice.ptype,
      title: notice.title,
      posted_date: notice.posted_date,
      response_deadline: notice.response_deadline,
      latest_active_version: notice.latest_active_version,
      awardee_name: notice.awardee_name,
      award_amount: notice.award_amount,
      notice_url: notice.notice_url,
      attachment_count: notice.attachment_count,
      source_stream: input.sourceStream,
      content_hash: contentHash,
      source_document_id: input.sourceDocumentId,
      metadata: safeRecord(notice.metadata),
      updated_at: notice.updated_at || new Date().toISOString()
    });
  }

  const existing = await fetchExistingOpportunityVersionKeys(
    supabase,
    rows.map((row) => String(row.notice_version_key))
  );
  const insertRows = rows.filter((row) => !existing.has(String(row.notice_version_key)));

  if (!insertRows.length) {
    return {
      fetched: rows.length,
      inserted: 0,
      duplicates: rows.length
    };
  }

  let inserted = 0;
  for (const chunk of chunkArray(insertRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('artemis_opportunity_notice_versions')
      .upsert(chunk, { onConflict: 'notice_version_key' });
    if (error) {
      if (isMissingRelationError(error)) {
        return {
          fetched: 0,
          inserted: 0,
          duplicates: 0
        };
      }
      throw error;
    }
    inserted += chunk.length;
  }

  return {
    fetched: rows.length,
    inserted,
    duplicates: rows.length - inserted
  };
}

async function fetchExistingNoticeIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  noticeIds: string[]
) {
  const normalizedNoticeIds = Array.from(new Set(noticeIds.filter((noticeId) => Boolean(noticeId))));
  if (!normalizedNoticeIds.length) return new Set<string>();

  const existing = new Set<string>();
  for (const chunk of chunkArray(normalizedNoticeIds, 250)) {
    const { data, error } = await supabase
      .from('artemis_opportunity_notices')
      .select('notice_id')
      .in('notice_id', chunk);
    if (error) throw error;
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const noticeId = stringOrNull(row.notice_id);
      if (noticeId) existing.add(noticeId);
    }
  }

  return existing;
}

async function attachNoticeToActions(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  solicitationId: string,
  noticeId: string | null
) {
  if (!noticeId) return;

  const { error } = await supabase
    .from('artemis_contract_actions')
    .update({ sam_notice_id: noticeId, updated_at: new Date().toISOString() })
    .eq('solicitation_id', solicitationId)
    .is('sam_notice_id', null);

  if (error) throw error;
}

async function disableArtemisContractsJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  reason: string,
  context: Record<string, unknown>
) {
  const payload = {
    reason,
    disabledAt: new Date().toISOString(),
    context
  };
  const { error } = await supabase
    .from('system_settings')
    .upsert(
      [
        { key: SETTING_CONTRACTS_JOB_ENABLED, value: false },
        { key: SETTING_CONTRACTS_JOB_DISABLED_REASON, value: payload }
      ],
      { onConflict: 'key' }
    );
  if (error) throw error;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = stringOrNull(value);
    if (!normalized) continue;
    seen.add(normalized);
  }
  return [...seen];
}

function readMetaString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function inferContractType(metadata: Record<string, unknown>, referencedIdvPiid: string | null): ContractType {
  const source = normalizeText(readMetaString(metadata, 'awardType') || readMetaString(metadata, 'award_type'));
  if (source.includes('idv') || source.includes('indefinite')) return 'idv';
  if (referencedIdvPiid) return 'order';
  if (source.includes('contract') || source.includes('award')) return 'definitive';
  return 'unknown';
}

function buildContractKey(piid: string, referencedIdvPiid: string | null) {
  return [piid.trim(), referencedIdvPiid?.trim() || ''].join('|');
}

function deterministicHash(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortForStableJson(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    output[key] = sortForStableJson(input[key]);
  }
  return output;
}

function chunkArray<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
