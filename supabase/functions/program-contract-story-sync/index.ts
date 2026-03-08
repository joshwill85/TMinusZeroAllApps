import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  readNumberSetting,
  startIngestionRun,
  stringifyError
} from '../_shared/artemisIngest.ts';

type ProgramScope = 'artemis' | 'spacex' | 'blue-origin';
type MatchStrategy =
  | 'exact_award_id'
  | 'exact_piid'
  | 'exact_solicitation'
  | 'heuristic_multi_signal';

type ProcurementAwardRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type SamContractAwardRow = {
  row_key: string;
  contract_key: string;
  mission_key: string | null;
  solicitation_id: string | null;
  piid: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ContractRow = {
  id: string;
  contract_key: string;
  piid: string;
  mission_key: string | null;
  awardee_name: string | null;
  description: string | null;
  base_award_date: string | null;
  metadata: Record<string, unknown> | null;
};

type ContractActionRow = {
  contract_id: string;
  action_date: string | null;
  solicitation_id: string | null;
  sam_notice_id: string | null;
};

type SpendingPointRow = {
  contract_id: string;
  fiscal_year: number;
  fiscal_month: number;
};

type OpportunityNoticeRow = {
  notice_id: string;
  solicitation_id: string | null;
  title: string | null;
  posted_date: string | null;
  awardee_name: string | null;
  award_amount: number | null;
  notice_url: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown> | null;
};

type StorySeed = {
  awardId: string | null;
  piid: string | null;
  contractKey: string | null;
  solicitationId: string | null;
  noticeId: string | null;
};

type StoryAggregate = {
  storyKey: string;
  programScope: ProgramScope;
  matchStrategy: MatchStrategy;
  matchConfidence: number;
  primaryUsaspendingAwardId: string | null;
  primaryPiid: string | null;
  primaryContractKey: string | null;
  primarySolicitationId: string | null;
  primaryNoticeId: string | null;
  missionKey: string | null;
  recipient: string | null;
  title: string | null;
  awardedOn: string | null;
  obligatedAmount: number | null;
  actionCount: number;
  noticeCount: number;
  spendingPointCount: number;
  bidderNames: Set<string>;
  latestActionDate: string | null;
  latestNoticeDate: string | null;
  latestSpendingFiscalYear: number | null;
  latestSpendingFiscalMonth: number | null;
  evidence: {
    sources: Set<string>;
    awardIds: Set<string>;
    piids: Set<string>;
    contractKeys: Set<string>;
    solicitationIds: Set<string>;
    noticeIds: Set<string>;
    samRowKeys: Set<string>;
    contractIds: Set<string>;
  };
};

type StoryMatchTier = 'exact' | 'candidate' | 'discovery-only';
type DiscoveryJoinStatus = 'unlinked' | 'candidate' | 'linked' | 'suppressed';
type DiscoverySourceType = 'sam-contract-award' | 'sam-opportunity';

type CanonicalStoryRow = {
  storyKey: string;
  primaryUsaspendingAwardId: string | null;
  primaryPiid: string | null;
  primaryContractKey: string | null;
  primarySolicitationId: string | null;
  primaryNoticeId: string | null;
  recipient: string | null;
  title: string | null;
  awardedOn: string | null;
  latestActionDate: string | null;
  latestNoticeDate: string | null;
  matchEvidence: Record<string, unknown>;
};

type DiscoverySourceRecord = {
  programScope: ProgramScope;
  sourceType: DiscoverySourceType;
  sourceRecordKey: string;
  title: string | null;
  summary: string | null;
  entityName: string | null;
  agencyName: string | null;
  piid: string | null;
  solicitationId: string | null;
  noticeId: string | null;
  usaspendingAwardId: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  amount: number | null;
  sourceDocumentId: string | null;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  relevanceSignals: Array<Record<string, unknown>>;
};

type StoryCandidateRow = {
  candidate_key: string;
  program_scope: ProgramScope;
  source_type: DiscoverySourceType;
  source_record_key: string;
  candidate_story_key: string | null;
  confidence_tier: StoryMatchTier;
  confidence_score: number;
  signals: Array<Record<string, unknown>>;
  status: 'active' | 'promoted' | 'suppressed';
  content_hash: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type StoryDiscoveryRow = {
  discovery_key: string;
  program_scope: ProgramScope;
  source_type: DiscoverySourceType;
  source_record_key: string;
  title: string | null;
  summary: string | null;
  entity_name: string | null;
  agency_name: string | null;
  piid: string | null;
  solicitation_id: string | null;
  notice_id: string | null;
  usaspending_award_id: string | null;
  source_url: string | null;
  published_at: string | null;
  amount: number | null;
  join_status: DiscoveryJoinStatus;
  best_candidate_story_key: string | null;
  relevance_score: number;
  relevance_signals: Array<Record<string, unknown>>;
  source_document_id: string | null;
  content_hash: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type StorySourceLinkRow = {
  story_key: string;
  program_scope: ProgramScope;
  source_type: 'sam-contract-award' | 'sam-opportunity';
  source_record_key: string;
  title: string | null;
  summary: string | null;
  entity_name: string | null;
  agency_name: string | null;
  piid: string | null;
  solicitation_id: string | null;
  notice_id: string | null;
  usaspending_award_id: string | null;
  source_url: string | null;
  published_at: string | null;
  amount: number | null;
  source_document_id: string | null;
  content_hash: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type StorySourceLinkObservedSource = {
  source_type: 'sam-contract-award' | 'sam-opportunity';
  source_record_key: string;
};

type ExistingStorySourceLinkRow = {
  id: string;
  story_key: string;
  source_type: 'sam-contract-award' | 'sam-opportunity';
  source_record_key: string;
  content_hash: string;
};

type ScopeSyncResult = {
  scope: ProgramScope;
  enabled: boolean;
  procurementRows: number;
  samAwardRows: number;
  contractRows: number;
  actionRows: number;
  spendingRows: number;
  noticeRows: number;
  upserted: number;
  candidateRowsUpserted: number;
  discoveryRowsUpserted: number;
  sourceLinkRowsUpserted: number;
  unchangedSkipped: number;
  storiesBuilt: number;
};

const RUN_NAME = 'program_contract_story_sync';
const SETTING_JOB_ENABLED = 'contract_story_sync_job_enabled';
const SETTING_ENRICHMENT_ENABLED = 'contract_story_enrichment_enabled';
const SETTING_BATCH_LIMIT = 'contract_story_sync_batch_limit';
const SETTING_SCOPE_ENABLED: Record<ProgramScope, string> = {
  artemis: 'contract_story_enrichment_artemis_enabled',
  spacex: 'contract_story_enrichment_spacex_enabled',
  'blue-origin': 'contract_story_enrichment_blue_origin_enabled'
};

const DEFAULT_BATCH_LIMIT = 2000;
const MAX_BATCH_LIMIT = 10_000;
const POSTGREST_MAX_ROWS = 1000;
const UPSERT_CHUNK_SIZE = 250;
const STORY_HASH_LOOKUP_CHUNK_SIZE = 200;
const SUPPORTED_SCOPES: ProgramScope[] = ['artemis', 'spacex', 'blue-origin'];

function buildPublicSupabaseUrl(req: Request) {
  const explicitUrl =
    String(Deno.env.get('NEXT_PUBLIC_SUPABASE_URL') || '').trim() ||
    String(Deno.env.get('SUPABASE_PROJECT_URL') || '').trim() ||
    String(Deno.env.get('PUBLIC_SUPABASE_URL') || '').trim();
  if (explicitUrl) return explicitUrl;

  try {
    const host = new URL(req.url).hostname.trim().toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.functions\./);
    if (!match?.[1]) return null;
    return `https://${match[1]}.supabase.co`;
  } catch {
    return null;
  }
}

function createStorySyncSupabaseClient(req: Request) {
  const publicUrl = buildPublicSupabaseUrl(req);
  const serviceRoleKey =
    String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() ||
    String(Deno.env.get('SERVICE_ROLE_KEY') || '').trim();

  if (publicUrl && serviceRoleKey) {
    return createClient(publicUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }

  return createSupabaseAdminClient();
}

serve(async (req) => {
  const supabase = createStorySyncSupabaseClient(req);
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, RUN_NAME);

  try {
    const jobEnabled = await readBooleanSetting(supabase, SETTING_JOB_ENABLED, true);
    if (!jobEnabled) {
      await finishIngestionRun(supabase, runId, true, {
        skipped: true,
        reason: 'job_disabled'
      });
      return jsonResponse({ ok: true, skipped: true, reason: 'job_disabled' });
    }

    const enrichmentEnabled = await readBooleanSetting(
      supabase,
      SETTING_ENRICHMENT_ENABLED,
      false
    );
    if (!enrichmentEnabled) {
      await finishIngestionRun(supabase, runId, true, {
        skipped: true,
        reason: 'enrichment_disabled'
      });
      return jsonResponse({ ok: true, skipped: true, reason: 'enrichment_disabled' });
    }

    const batchLimit = clampInt(
      await readNumberSetting(supabase, SETTING_BATCH_LIMIT, DEFAULT_BATCH_LIMIT),
      DEFAULT_BATCH_LIMIT,
      100,
      MAX_BATCH_LIMIT
    );

    const scopeResults: ScopeSyncResult[] = [];

    for (const scope of SUPPORTED_SCOPES) {
      const enabled = await readBooleanSetting(supabase, SETTING_SCOPE_ENABLED[scope], false);
      if (!enabled) {
        scopeResults.push({
          scope,
          enabled: false,
          procurementRows: 0,
          samAwardRows: 0,
          contractRows: 0,
          actionRows: 0,
          spendingRows: 0,
          noticeRows: 0,
          upserted: 0,
          candidateRowsUpserted: 0,
          discoveryRowsUpserted: 0,
          sourceLinkRowsUpserted: 0,
          unchangedSkipped: 0,
          storiesBuilt: 0
        });
        continue;
      }

      const result = await syncScopeStories(supabase, scope, batchLimit);
      scopeResults.push(result);
    }

    const stats = {
      batchLimit,
      scopeResults,
      totalUpserted: scopeResults.reduce((sum, row) => sum + row.upserted, 0),
      totalCandidateRowsUpserted: scopeResults.reduce((sum, row) => sum + row.candidateRowsUpserted, 0),
      totalDiscoveryRowsUpserted: scopeResults.reduce((sum, row) => sum + row.discoveryRowsUpserted, 0),
      totalSourceLinkRowsUpserted: scopeResults.reduce((sum, row) => sum + row.sourceLinkRowsUpserted, 0),
      totalUnchangedSkipped: scopeResults.reduce(
        (sum, row) => sum + row.unchangedSkipped,
        0
      ),
      totalStories: scopeResults.reduce((sum, row) => sum + row.storiesBuilt, 0),
      elapsedMs: Date.now() - startedAt
    };

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, ...stats });
  } catch (error) {
    const message = stringifyError(error);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse(
      {
        error: 'program_contract_story_sync_failed',
        detail: message
      },
      500
    );
  }
});

async function syncScopeStories(
  supabase: SupabaseClient,
  scope: ProgramScope,
  batchLimit: number
): Promise<ScopeSyncResult> {
  const nowIso = new Date().toISOString();
  const procurementRows = await fetchProcurementRows(supabase, scope, batchLimit);
  const samAwardRows = await fetchSamContractAwardRows(supabase, scope, batchLimit);

  const contractKeySet = new Set<string>();
  const piidSet = new Set<string>();
  const solicitationSet = new Set<string>();

  for (const row of procurementRows) {
    const metadata = asRecord(row.metadata);
    const contractKey = normalizeText(readString(metadata, 'contractKey') || readString(metadata, 'contract_key'));
    const piid = normalizeText(readString(metadata, 'piid'));
    const solicitationId = normalizeText(
      readString(metadata, 'solicitationId') || readString(metadata, 'solicitation_id')
    );
    if (contractKey) contractKeySet.add(contractKey);
    if (piid) piidSet.add(piid);
    if (solicitationId) solicitationSet.add(solicitationId);
  }

  for (const row of samAwardRows) {
    const contractKey = normalizeText(row.contract_key);
    const piid = normalizeText(row.piid);
    const solicitationId = normalizeText(row.solicitation_id);
    if (contractKey) contractKeySet.add(contractKey);
    if (piid) piidSet.add(piid);
    if (solicitationId) solicitationSet.add(solicitationId);
  }

  const contracts = await fetchContracts(supabase, {
    contractKeys: [...contractKeySet.values()],
    piids: [...piidSet.values()],
    limit: batchLimit
  });
  const contractIdSet = new Set<string>(contracts.map((row) => row.id));

  const [actionRows, spendingRows] = await Promise.all([
    fetchContractActions(supabase, [...contractIdSet.values()], batchLimit * 5),
    fetchSpendingRows(supabase, [...contractIdSet.values()], batchLimit * 8)
  ]);

  for (const action of actionRows) {
    const solicitationId = normalizeText(action.solicitation_id);
    if (solicitationId) solicitationSet.add(solicitationId);
  }

  const notices = await fetchOpportunityNotices(
    supabase,
    [...solicitationSet.values()],
    batchLimit * 6
  );

  const storyMap = new Map<string, StoryAggregate>();
  const storyByAwardId = new Map<string, string>();
  const storyByPiid = new Map<string, string>();
  const storyByContractKey = new Map<string, string>();
  const storyBySolicitationId = new Map<string, string>();
  const storyByNoticeId = new Map<string, string>();
  const contractIdToStory = new Map<string, string>();

  for (const row of procurementRows) {
    const metadata = asRecord(row.metadata);
    const seed: StorySeed = {
      awardId: normalizeAwardId(row.usaspending_award_id),
      piid: normalizeText(readString(metadata, 'piid')),
      contractKey: normalizeText(
        readString(metadata, 'contractKey') || readString(metadata, 'contract_key')
      ),
      solicitationId: normalizeText(
        readString(metadata, 'solicitationId') || readString(metadata, 'solicitation_id')
      ),
      noticeId: normalizeText(readString(metadata, 'noticeId') || readString(metadata, 'notice_id'))
    };

    const strategy = chooseMatchStrategy(seed);
    const aggregate = claimStoryAggregate({
      scope,
      seed,
      strategy,
      confidence: strategy === 'exact_award_id' ? 0.92 : strategy === 'exact_piid' ? 0.85 : 0.72,
      storyMap,
      storyByAwardId,
      storyByPiid,
      storyByContractKey,
      storyBySolicitationId,
      storyByNoticeId
    });

    mergeStoryRowDetails(aggregate, {
      missionKey: normalizeText(row.mission_key),
      recipient: normalizeText(row.recipient),
      title: normalizeText(row.award_title),
      awardedOn: normalizeDate(row.awarded_on),
      obligatedAmount: finiteNumberOrNull(row.obligated_amount)
    });
    addEvidenceFromSeed(aggregate, seed);
    aggregate.evidence.sources.add('usaspending_award');
  }

  for (const row of samAwardRows) {
    const metadata = asRecord(row.metadata);
    const seed: StorySeed = {
      awardId: normalizeAwardId(
        readString(metadata, 'usaspendingAwardId') ||
          readString(metadata, 'sourceAwardId') ||
          parseAwardIdFromContractKey(row.contract_key)
      ),
      piid: normalizeText(row.piid),
      contractKey: normalizeText(row.contract_key),
      solicitationId: normalizeText(row.solicitation_id),
      noticeId: normalizeText(readString(metadata, 'noticeId') || readString(metadata, 'notice_id'))
    };

    const strategy = chooseMatchStrategy(seed);
    const aggregate = claimStoryAggregate({
      scope,
      seed,
      strategy,
      confidence: strategy === 'exact_award_id' ? 0.9 : strategy === 'exact_piid' ? 0.83 : 0.7,
      storyMap,
      storyByAwardId,
      storyByPiid,
      storyByContractKey,
      storyBySolicitationId,
      storyByNoticeId
    });

    mergeStoryRowDetails(aggregate, {
      missionKey: normalizeText(row.mission_key),
      recipient: firstString(metadata, [
        'awardeeName',
        'recipientName',
        'awardee_name',
        'recipient'
      ]),
      title: firstString(metadata, [
        'title',
        'solicitationTitle',
        'description',
        'awardTitle',
        'contractTitle'
      ]),
      awardedOn: firstDate(metadata, [
        'awardDate',
        'actionDate',
        'dateSigned',
        'postedDate',
        'updatedDate'
      ]),
      obligatedAmount: firstNumber(metadata, [
        'awardAmount',
        'obligatedAmount',
        'baseAndAllOptionsValue',
        'currentTotalValue'
      ])
    });
    addEvidenceFromSeed(aggregate, seed);
    aggregate.evidence.sources.add('sam_contract_award_row');
    aggregate.evidence.samRowKeys.add(row.row_key);
  }

  for (const row of contracts) {
    const metadata = asRecord(row.metadata);
    const seed: StorySeed = {
      awardId: normalizeAwardId(
        readString(metadata, 'sourceAwardId') || parseAwardIdFromContractKey(row.contract_key)
      ),
      piid: normalizeText(row.piid),
      contractKey: normalizeText(row.contract_key),
      solicitationId: null,
      noticeId: null
    };

    const strategy = chooseMatchStrategy(seed);
    const aggregate = claimStoryAggregate({
      scope,
      seed,
      strategy,
      confidence: strategy === 'exact_award_id' ? 0.93 : strategy === 'exact_piid' ? 0.86 : 0.75,
      storyMap,
      storyByAwardId,
      storyByPiid,
      storyByContractKey,
      storyBySolicitationId,
      storyByNoticeId
    });

    mergeStoryRowDetails(aggregate, {
      missionKey: normalizeText(row.mission_key),
      recipient: normalizeText(row.awardee_name),
      title: normalizeText(row.description),
      awardedOn: normalizeDate(row.base_award_date),
      obligatedAmount: null
    });

    addEvidenceFromSeed(aggregate, seed);
    aggregate.evidence.sources.add('normalized_contract');
    aggregate.evidence.contractIds.add(row.id);
    contractIdToStory.set(row.id, aggregate.storyKey);
  }

  for (const action of actionRows) {
    const storyKey = contractIdToStory.get(action.contract_id);
    if (!storyKey) continue;
    const aggregate = storyMap.get(storyKey);
    if (!aggregate) continue;

    aggregate.actionCount += 1;
    aggregate.latestActionDate = maxIsoDate(
      aggregate.latestActionDate,
      normalizeDate(action.action_date)
    );

    const solicitationId = normalizeText(action.solicitation_id);
    if (solicitationId) {
      if (!aggregate.primarySolicitationId) aggregate.primarySolicitationId = solicitationId;
      storyBySolicitationId.set(solicitationId, aggregate.storyKey);
      aggregate.evidence.solicitationIds.add(solicitationId);
    }

    const noticeId = normalizeText(action.sam_notice_id);
    if (noticeId) {
      if (!aggregate.primaryNoticeId) aggregate.primaryNoticeId = noticeId;
      storyByNoticeId.set(noticeId, aggregate.storyKey);
      aggregate.evidence.noticeIds.add(noticeId);
    }
  }

  for (const row of spendingRows) {
    const storyKey = contractIdToStory.get(row.contract_id);
    if (!storyKey) continue;
    const aggregate = storyMap.get(storyKey);
    if (!aggregate) continue;

    aggregate.spendingPointCount += 1;
    if (
      aggregate.latestSpendingFiscalYear == null ||
      row.fiscal_year > aggregate.latestSpendingFiscalYear ||
      (row.fiscal_year === aggregate.latestSpendingFiscalYear &&
        (aggregate.latestSpendingFiscalMonth == null || row.fiscal_month > aggregate.latestSpendingFiscalMonth))
    ) {
      aggregate.latestSpendingFiscalYear = row.fiscal_year;
      aggregate.latestSpendingFiscalMonth = row.fiscal_month;
    }
  }

  for (const row of notices) {
    const solicitationId = normalizeText(row.solicitation_id);
    const noticeId = normalizeText(row.notice_id);
    const linkedStoryKey =
      (solicitationId ? storyBySolicitationId.get(solicitationId) : null) ||
      (noticeId ? storyByNoticeId.get(noticeId) : null) ||
      null;

    const seed: StorySeed = {
      awardId: null,
      piid: null,
      contractKey: null,
      solicitationId,
      noticeId
    };

    const aggregate = linkedStoryKey
      ? storyMap.get(linkedStoryKey) ||
        claimStoryAggregate({
          scope,
          seed,
          strategy: chooseMatchStrategy(seed),
          confidence: 0.68,
          storyMap,
          storyByAwardId,
          storyByPiid,
          storyByContractKey,
          storyBySolicitationId,
          storyByNoticeId
        })
      : claimStoryAggregate({
          scope,
          seed,
          strategy: chooseMatchStrategy(seed),
          confidence: 0.68,
          storyMap,
          storyByAwardId,
          storyByPiid,
          storyByContractKey,
          storyBySolicitationId,
          storyByNoticeId
        });

    aggregate.noticeCount += 1;
    aggregate.latestNoticeDate = maxIsoDate(
      aggregate.latestNoticeDate,
      normalizeDate(row.posted_date)
    );
    if (!aggregate.title && row.title) aggregate.title = normalizeText(row.title);
    const bidder = normalizeText(row.awardee_name);
    if (bidder) aggregate.bidderNames.add(bidder);

    addEvidenceFromSeed(aggregate, seed);
    aggregate.evidence.sources.add('sam_opportunity_notice');
  }

  const upsertRows = [...storyMap.values()].map((story) => {
    const hasFullStory =
      story.actionCount > 0 || story.noticeCount > 0 || story.spendingPointCount > 0;
    const signalCount =
      Number(Boolean(story.primaryUsaspendingAwardId)) +
      Number(Boolean(story.primaryPiid)) +
      Number(Boolean(story.primaryContractKey)) +
      Number(Boolean(story.primarySolicitationId)) +
      Number(Boolean(story.primaryNoticeId));
    const confidenceBoost = Math.min(0.18, Math.max(0, signalCount - 1) * 0.05);
    const confidence = clampNumber(
      story.matchConfidence + confidenceBoost + (hasFullStory ? 0.08 : 0),
      0,
      0.99
    );

    const matchEvidence = {
      sources: sortNormalizedStrings([...story.evidence.sources.values()]),
      awardIds: sortNormalizedStrings([...story.evidence.awardIds.values()]),
      piids: sortNormalizedStrings([...story.evidence.piids.values()]),
      contractKeys: sortNormalizedStrings([...story.evidence.contractKeys.values()]),
      solicitationIds: sortNormalizedStrings([
        ...story.evidence.solicitationIds.values()
      ]),
      noticeIds: sortNormalizedStrings([...story.evidence.noticeIds.values()]),
      samRowKeys: sortNormalizedStrings([...story.evidence.samRowKeys.values()]),
      contractIds: sortNormalizedStrings([...story.evidence.contractIds.values()])
    };
    const bidderNames = sortNormalizedStrings([...story.bidderNames.values()]);
    const hashInput = {
      story_key: story.storyKey,
      program_scope: story.programScope,
      match_strategy: story.matchStrategy,
      match_confidence: confidence,
      has_full_story: hasFullStory,
      primary_usaspending_award_id: story.primaryUsaspendingAwardId,
      primary_piid: story.primaryPiid,
      primary_contract_key: story.primaryContractKey,
      primary_solicitation_id: story.primarySolicitationId,
      primary_notice_id: story.primaryNoticeId,
      mission_key: story.missionKey,
      recipient: story.recipient,
      title: story.title,
      awarded_on: story.awardedOn,
      obligated_amount: story.obligatedAmount,
      action_count: story.actionCount,
      notice_count: story.noticeCount,
      spending_point_count: story.spendingPointCount,
      bidder_count: bidderNames.length,
      latest_action_date: story.latestActionDate,
      latest_notice_date: story.latestNoticeDate,
      latest_spending_fiscal_year: story.latestSpendingFiscalYear,
      latest_spending_fiscal_month: story.latestSpendingFiscalMonth,
      match_evidence: matchEvidence,
      metadata: {
        bidderNames,
        generatedBy: RUN_NAME
      }
    };
    const contentHash = deterministicHash(stableJsonStringify(hashInput));

    return {
      ...hashInput,
      content_hash: contentHash,
      match_evidence: matchEvidence,
      metadata: {
        bidderNames,
        generatedBy: RUN_NAME,
        generatedAt: nowIso
      },
      updated_at: nowIso
    };
  });

  const existingHashes = await fetchExistingStoryContentHashes(
    supabase,
    upsertRows.map((row) => row.story_key)
  );
  const changedRows = upsertRows.filter(
    (row) => existingHashes.get(row.story_key) !== row.content_hash
  );
  const unchangedSkipped = upsertRows.length - changedRows.length;

  let upserted = 0;
  for (const chunk of chunkArray(changedRows, UPSERT_CHUNK_SIZE)) {
    if (chunk.length < 1) continue;
    const { error } = await supabase
      .from('program_contract_story_links')
      .upsert(chunk, { onConflict: 'story_key' });
    if (error) {
      throw new Error(`program_contract_story_links upsert failed (${scope}): ${stringifyError(error)}`);
    }
    upserted += chunk.length;
  }

  const canonicalRows = upsertRows.map(mapCanonicalStoryRow);
  const discoveryNoticeRows = await fetchScopeDiscoveryOpportunityNotices(
    supabase,
    scope,
    Math.max(batchLimit * 6, 2_000)
  );
  const discoveryOutput = buildScopeDiscoveryOutput({
    scope,
    nowIso,
    samAwardRows,
    opportunityNotices: discoveryNoticeRows,
    canonicalRows
  });
  const [candidateRowsUpserted, discoveryRowsUpserted] = await Promise.all([
    upsertStoryCandidateRows(supabase, discoveryOutput.candidateRows),
    upsertStoryDiscoveryRows(supabase, discoveryOutput.discoveryRows)
  ]);
  const sourceLinkRowsUpserted = await upsertStorySourceLinkRows(
    supabase,
    scope,
    discoveryOutput.sourceLinkRows,
    discoveryOutput.observedSourceLinkSources
  );

  return {
    scope,
    enabled: true,
    procurementRows: procurementRows.length,
    samAwardRows: samAwardRows.length,
    contractRows: contracts.length,
    actionRows: actionRows.length,
    spendingRows: spendingRows.length,
    noticeRows: notices.length,
    upserted,
    candidateRowsUpserted,
    discoveryRowsUpserted,
    sourceLinkRowsUpserted,
    unchangedSkipped,
    storiesBuilt: storyMap.size
  };
}

async function fetchExistingStoryContentHashes(
  supabase: SupabaseClient,
  storyKeys: string[]
) {
  const normalizedKeys = uniqueNonEmptyStrings(storyKeys);
  const hashes = new Map<string, string>();
  if (normalizedKeys.length < 1) return hashes;

  for (const chunk of chunkArray(normalizedKeys, STORY_HASH_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('program_contract_story_links')
      .select('story_key,content_hash')
      .in('story_key', chunk);
    if (error) {
      throw new Error(
        `program_contract_story_links content hash lookup failed: ${stringifyError(error)}`
      );
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const storyKey = normalizeText(
        typeof row.story_key === 'string' ? row.story_key : null
      );
      if (!storyKey) continue;
      const contentHash = normalizeText(
        typeof row.content_hash === 'string' ? row.content_hash : null
      );
      hashes.set(storyKey, contentHash || '');
    }
  }

  return hashes;
}

function mapCanonicalStoryRow(row: Record<string, unknown>): CanonicalStoryRow {
  return {
    storyKey: normalizeText(readString(row, 'story_key')) || '',
    primaryUsaspendingAwardId: normalizeAwardId(readString(row, 'primary_usaspending_award_id')),
    primaryPiid: normalizeText(readString(row, 'primary_piid')),
    primaryContractKey: normalizeText(readString(row, 'primary_contract_key')),
    primarySolicitationId: normalizeText(readString(row, 'primary_solicitation_id')),
    primaryNoticeId: normalizeText(readString(row, 'primary_notice_id')),
    recipient: normalizeText(readString(row, 'recipient')),
    title: normalizeText(readString(row, 'title')),
    awardedOn: normalizeDate(readString(row, 'awarded_on')),
    latestActionDate: normalizeDate(readString(row, 'latest_action_date')),
    latestNoticeDate: normalizeDate(readString(row, 'latest_notice_date')),
    matchEvidence: asRecord(row.match_evidence)
  };
}

async function fetchScopeDiscoveryOpportunityNotices(
  supabase: SupabaseClient,
  scope: ProgramScope,
  limit: number
) {
  const rows: OpportunityNoticeRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const pageSize = Math.min(POSTGREST_MAX_ROWS, limit - rows.length);
    const { data, error } = await supabase
      .from('artemis_opportunity_notices')
      .select('notice_id,solicitation_id,title,posted_date,awardee_name,award_amount,notice_url,source_document_id,metadata')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`opportunity discovery query failed: ${stringifyError(error)}`);

    const pageRows = (data || []) as OpportunityNoticeRow[];
    for (const row of pageRows) {
      if (!isOpportunityNoticeRelevantToScope(scope, row).matched) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }

    if (pageRows.length < pageSize) break;
    offset += pageRows.length;
  }

  return rows.slice(0, limit);
}

function buildScopeDiscoveryOutput(input: {
  scope: ProgramScope;
  nowIso: string;
  samAwardRows: SamContractAwardRow[];
  opportunityNotices: OpportunityNoticeRow[];
  canonicalRows: CanonicalStoryRow[];
}) {
  const canonicalIndex = buildCanonicalStoryIndex(input.canonicalRows);
  const candidateRows: StoryCandidateRow[] = [];
  const discoveryRows: StoryDiscoveryRow[] = [];
  const sourceLinkRows: StorySourceLinkRow[] = [];

  const sources = dedupeByKey(
    [
      ...input.samAwardRows.map((row) => buildSamAwardDiscoverySource(input.scope, row)),
      ...input.opportunityNotices.map((row) => buildOpportunityDiscoverySource(input.scope, row))
    ].filter((row): row is DiscoverySourceRecord => Boolean(row)),
    (row) => `${row.sourceType}|${row.sourceRecordKey}`
  );

  for (const source of sources) {
    const match = matchDiscoverySourceToCanonicalRows(source, canonicalIndex);
    candidateRows.push(buildStoryCandidateRow(input.scope, source, match, input.nowIso));
    discoveryRows.push(buildStoryDiscoveryRow(input.scope, source, match, input.nowIso));
    const sourceLinkRow = buildStorySourceLinkRow(
      input.scope,
      source,
      match,
      input.nowIso
    );
    if (sourceLinkRow) {
      sourceLinkRows.push(sourceLinkRow);
    }
  }

  return {
    candidateRows: dedupeByKey(candidateRows, (row) => row.candidate_key),
    discoveryRows: dedupeByKey(discoveryRows, (row) => row.discovery_key),
    sourceLinkRows: dedupeByKey(
      sourceLinkRows,
      (row) => `${row.story_key}|${row.source_type}|${row.source_record_key}`
    ),
    observedSourceLinkSources: dedupeByKey(
      sources.map((source) => ({
        source_type: source.sourceType,
        source_record_key: source.sourceRecordKey
      })),
      (row) => `${row.source_type}|${row.source_record_key}`
    )
  };
}

function buildCanonicalStoryIndex(rows: CanonicalStoryRow[]) {
  const byStoryKey = new Map<string, CanonicalStoryRow>();
  const byAwardId = new Map<string, string>();
  const byPiid = new Map<string, string>();
  const byContractKey = new Map<string, string>();
  const bySolicitationId = new Map<string, string>();
  const byNoticeId = new Map<string, string>();
  const byRecipient = new Map<string, CanonicalStoryRow[]>();

  const addIdentifier = (map: Map<string, string>, value: string | null, storyKey: string) => {
    const normalizedValue = normalizeIdentifierKey(value);
    if (!normalizedValue) return;
    map.set(normalizedValue, storyKey);
  };

  for (const row of rows) {
    if (!row.storyKey) continue;
    byStoryKey.set(row.storyKey, row);
    addIdentifier(byAwardId, row.primaryUsaspendingAwardId, row.storyKey);
    addIdentifier(byPiid, row.primaryPiid, row.storyKey);
    addIdentifier(byContractKey, row.primaryContractKey, row.storyKey);
    addIdentifier(bySolicitationId, row.primarySolicitationId, row.storyKey);
    addIdentifier(byNoticeId, row.primaryNoticeId, row.storyKey);

    for (const awardId of readStringArray(row.matchEvidence.awardIds).map(normalizeAwardId)) {
      addIdentifier(byAwardId, awardId, row.storyKey);
    }
    for (const piid of readStringArray(row.matchEvidence.piids).map(normalizeText)) {
      addIdentifier(byPiid, piid, row.storyKey);
    }
    for (const contractKey of readStringArray(row.matchEvidence.contractKeys).map(normalizeText)) {
      addIdentifier(byContractKey, contractKey, row.storyKey);
    }
    for (const solicitationId of readStringArray(row.matchEvidence.solicitationIds).map(normalizeText)) {
      addIdentifier(bySolicitationId, solicitationId, row.storyKey);
    }
    for (const noticeId of readStringArray(row.matchEvidence.noticeIds).map(normalizeText)) {
      addIdentifier(byNoticeId, noticeId, row.storyKey);
    }

    const recipient = normalizeMatchKey(row.recipient);
    if (recipient) {
      const existing = byRecipient.get(recipient) || [];
      existing.push(row);
      byRecipient.set(recipient, existing);
    }
  }

  return {
    byStoryKey,
    byAwardId,
    byPiid,
    byContractKey,
    bySolicitationId,
    byNoticeId,
    byRecipient
  };
}

function buildSamAwardDiscoverySource(scope: ProgramScope, row: SamContractAwardRow): DiscoverySourceRecord | null {
  const metadataLayers = unpackSamAwardDiscoveryMetadata(row.metadata);
  const sourceRecordKey = buildStableSamAwardSourceRecordKey(scope, row, metadataLayers);
  if (!sourceRecordKey) return null;
  const solicitationId =
    normalizeText(row.solicitation_id) ||
    firstStringFromRecords(
      [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
      ['solicitationId', 'solicitationID', 'solicitation_id', 'solicitationNumber']
    );
  const piid =
    normalizeText(row.piid) ||
    firstStringFromRecords(
      [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
      ['piid']
    );
  const referencedIdvPiid =
    firstStringFromRecords(
      [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
      ['referencedIdvPiid', 'referenced_idv_piid']
    ) || null;
  const mergedMetadata = buildSamAwardDiscoveryMatchMetadata(row, metadataLayers, {
    solicitationId,
    piid,
    referencedIdvPiid
  });

  return {
    programScope: scope,
    sourceType: 'sam-contract-award',
    sourceRecordKey,
    title:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.candidate, metadataLayers.extraction],
        ['title', 'solicitationTitle', 'awardTitle', 'contractTitle', 'description']
      ) || null,
    summary:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.candidate, metadataLayers.extraction],
        ['description', 'awardDescription', 'summary', 'solicitationDescription']
      ) || null,
    entityName:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.candidate, metadataLayers.extraction],
        ['awardeeName', 'recipientName', 'awardee_name', 'recipient']
      ) || null,
    agencyName:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.candidate, metadataLayers.extraction],
        ['departmentName', 'fullParentPathName', 'organizationName', 'agencyName', 'agency']
      ) || null,
    piid,
    solicitationId,
    noticeId:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
        ['noticeId', 'notice_id']
      ) || null,
    usaspendingAwardId: normalizeAwardId(
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
        ['usaspendingAwardId', 'sourceAwardId', 'awardId', 'contractId']
      ) ||
        parseAwardIdFromContractKey(row.contract_key)
    ),
    sourceUrl:
      firstStringFromRecords(
        [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
        ['uiLink', 'awardUrl', 'sourceUrl']
      ) || null,
    publishedAt:
      firstDateFromRecords(
        [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
        ['awardDate', 'actionDate', 'dateSigned', 'postedDate', 'updatedDate']
      ) ||
      normalizeDate(row.updated_at),
    amount:
      firstNumberFromRecords(
        [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
        ['awardAmount', 'obligatedAmount', 'baseAndAllOptionsValue', 'currentTotalValue']
      ) || null,
    sourceDocumentId: normalizeText(row.source_document_id),
    metadata: mergedMetadata,
    relevanceScore: 0.92,
    relevanceSignals: [buildSignal('program_scope', scope, 0.92)]
  };
}

function buildOpportunityDiscoverySource(scope: ProgramScope, row: OpportunityNoticeRow): DiscoverySourceRecord | null {
  const relevance = isOpportunityNoticeRelevantToScope(scope, row);
  if (!relevance.matched) return null;

  const metadata = asRecord(row.metadata);
  const sourceRecordKey = normalizeText(row.notice_id);
  if (!sourceRecordKey) return null;

  return {
    programScope: scope,
    sourceType: 'sam-opportunity',
    sourceRecordKey,
    title: normalizeText(row.title),
    summary: firstString(metadata, ['description', 'summary', 'synopsis', 'solicitationDescription']),
    entityName: normalizeText(row.awardee_name) || firstString(metadata, ['awardeeName', 'recipientName']),
    agencyName: firstString(metadata, ['organizationName', 'departmentName', 'fullParentPathName', 'agencyName', 'office']),
    piid: normalizeText(readString(metadata, 'piid')),
    solicitationId: normalizeText(row.solicitation_id),
    noticeId: normalizeText(row.notice_id),
    usaspendingAwardId: normalizeAwardId(readString(metadata, 'usaspendingAwardId') || readString(metadata, 'sourceAwardId')),
    sourceUrl: normalizeText(row.notice_url) || firstString(metadata, ['uiLink', 'noticeUrl', 'sourceUrl']),
    publishedAt: normalizeDate(row.posted_date),
    amount: finiteNumberOrNull(row.award_amount),
    sourceDocumentId: normalizeText(row.source_document_id),
    metadata,
    relevanceScore: relevance.score,
    relevanceSignals: relevance.signals
  };
}

function unpackSamAwardDiscoveryMetadata(metadataValue: Record<string, unknown> | null | undefined) {
  const wrapper = asRecord(metadataValue);
  return {
    wrapper,
    rawPayload: asRecord(wrapper.row),
    extraction: asRecord(wrapper.extraction),
    candidate: asRecord(wrapper.candidate)
  };
}

function buildStableSamAwardSourceRecordKey(
  scope: ProgramScope,
  row: SamContractAwardRow,
  metadataLayers: ReturnType<typeof unpackSamAwardDiscoveryMetadata>
) {
  const awardIdentity = normalizeIdentifierKey(
    firstStringFromRecords(
      [metadataLayers.rawPayload, metadataLayers.extraction, metadataLayers.candidate],
      ['usaspendingAwardId', 'sourceAwardId', 'awardId', 'contractId']
    ) || parseAwardIdFromContractKey(row.contract_key)
  );
  const contractKey = normalizeIdentifierKey(
    normalizeText(row.contract_key) ||
      firstStringFromRecords(
        [metadataLayers.candidate, metadataLayers.extraction, metadataLayers.rawPayload],
        ['contractKey', 'contract_key']
      )
  );
  const solicitationId = normalizeIdentifierKey(
    normalizeText(row.solicitation_id) ||
      firstStringFromRecords(
        [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
        ['solicitationId', 'solicitationID', 'solicitation_id', 'solicitationNumber']
      )
  );
  const piid = normalizeIdentifierKey(
    normalizeText(row.piid) ||
      firstStringFromRecords(
        [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
        ['piid']
      )
  );
  const referencedIdvPiid = normalizeIdentifierKey(
    firstStringFromRecords(
      [metadataLayers.extraction, metadataLayers.rawPayload, metadataLayers.candidate],
      ['referencedIdvPiid', 'referenced_idv_piid']
    )
  );

  return [
    'sam-award',
    scope,
    awardIdentity || 'na',
    contractKey || 'na',
    solicitationId || 'na',
    piid || 'na',
    referencedIdvPiid || 'na'
  ].join('|');
}

function buildSamAwardDiscoveryMatchMetadata(
  row: SamContractAwardRow,
  metadataLayers: ReturnType<typeof unpackSamAwardDiscoveryMetadata>,
  identifiers: {
    solicitationId: string | null;
    piid: string | null;
    referencedIdvPiid: string | null;
  }
) {
  return {
    ...metadataLayers.wrapper,
    ...metadataLayers.rawPayload,
    ...metadataLayers.extraction,
    ...metadataLayers.candidate,
    contractKey: normalizeText(row.contract_key),
    solicitationId: identifiers.solicitationId,
    piid: identifiers.piid,
    referencedIdvPiid: identifiers.referencedIdvPiid
  };
}

function firstStringFromRecords(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    const value = firstString(record, keys);
    if (value) return value;
  }
  return null;
}

function firstNumberFromRecords(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    const value = firstNumber(record, keys);
    if (value != null) return value;
  }
  return null;
}

function firstDateFromRecords(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    const value = firstDate(record, keys);
    if (value) return value;
  }
  return null;
}

function matchDiscoverySourceToCanonicalRows(
  source: DiscoverySourceRecord,
  canonicalIndex: ReturnType<typeof buildCanonicalStoryIndex>
) {
  const exactMatches: Array<{ map: Map<string, string>; value: string | null; signal: string }> = [
    { map: canonicalIndex.byAwardId, value: source.usaspendingAwardId, signal: 'award_id' },
    { map: canonicalIndex.byPiid, value: source.piid, signal: 'piid' },
    { map: canonicalIndex.byContractKey, value: normalizeText(readString(source.metadata, 'contractKey') || readString(source.metadata, 'contract_key')), signal: 'contract_key' },
    { map: canonicalIndex.bySolicitationId, value: source.solicitationId, signal: 'solicitation_id' },
    { map: canonicalIndex.byNoticeId, value: source.noticeId, signal: 'notice_id' }
  ];

  for (const match of exactMatches) {
    const normalizedValue = normalizeIdentifierKey(match.value);
    if (!normalizedValue) continue;
    const storyKey = match.map.get(normalizedValue);
    if (!storyKey) continue;
    return {
      tier: 'exact' as const,
      storyKey,
      score: 0.99,
      signals: [buildSignal(match.signal, normalizedValue, 0.99)]
    };
  }

  const recipientKey = normalizeMatchKey(source.entityName);
  if (!recipientKey) {
    return {
      tier: 'discovery-only' as const,
      storyKey: null,
      score: source.relevanceScore,
      signals: source.relevanceSignals
    };
  }

  const candidateStories = canonicalIndex.byRecipient.get(recipientKey) || [];
  let bestCandidate: { storyKey: string; score: number; signals: Array<Record<string, unknown>> } | null = null;

  for (const story of candidateStories) {
    let score = 0.45;
    const signals = [buildSignal('recipient', recipientKey, 0.45)];
    const overlap = countTokenOverlap(source.title, story.title);
    if (overlap >= 2) {
      const overlapScore = Math.min(0.25, 0.1 + overlap * 0.05);
      score += overlapScore;
      signals.push(buildSignal('title_overlap', String(overlap), overlapScore));
    }
    const dateDelta = computeDateDeltaDays(
      source.publishedAt,
      story.awardedOn || story.latestActionDate || story.latestNoticeDate
    );
    if (dateDelta !== null && dateDelta <= 365) {
      score += 0.15;
      signals.push(buildSignal('date_proximity_days', String(dateDelta), 0.15));
    }
    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = {
        storyKey: story.storyKey,
        score,
        signals
      };
    }
  }

  if (bestCandidate && bestCandidate.score >= 0.55) {
    return {
      tier: 'candidate' as const,
      storyKey: bestCandidate.storyKey,
      score: clampNumber(bestCandidate.score, 0, 0.95),
      signals: bestCandidate.signals
    };
  }

  return {
    tier: 'discovery-only' as const,
    storyKey: null,
    score: source.relevanceScore,
    signals: source.relevanceSignals
  };
}

function buildStoryCandidateRow(
  scope: ProgramScope,
  source: DiscoverySourceRecord,
  match: { tier: StoryMatchTier; storyKey: string | null; score: number; signals: Array<Record<string, unknown>> },
  nowIso: string
): StoryCandidateRow {
  const candidateKey = `${scope}|${source.sourceType}|${source.sourceRecordKey}|${match.storyKey || 'none'}|${match.tier}`;
  const status: StoryCandidateRow['status'] = match.tier === 'exact' ? 'promoted' : 'active';
  const contentMetadata = {
    generatedBy: RUN_NAME
  };
  const payload = {
    candidate_key: candidateKey,
    program_scope: scope,
    source_type: source.sourceType,
    source_record_key: source.sourceRecordKey,
    candidate_story_key: match.storyKey,
    confidence_tier: match.tier,
    confidence_score: clampNumber(match.score, 0, 0.99),
    signals: dedupeSignals([...source.relevanceSignals, ...match.signals]),
    status,
    metadata: contentMetadata
  };
  const storedMetadata = {
    ...contentMetadata,
    generatedAt: nowIso
  };

  return {
    ...payload,
    metadata: storedMetadata,
    content_hash: deterministicHash(stableJsonStringify(payload)),
    updated_at: nowIso
  };
}

function buildStoryDiscoveryRow(
  scope: ProgramScope,
  source: DiscoverySourceRecord,
  match: { tier: StoryMatchTier; storyKey: string | null; score: number; signals: Array<Record<string, unknown>> },
  nowIso: string
): StoryDiscoveryRow {
  const joinStatus: DiscoveryJoinStatus =
    match.tier === 'exact' ? 'linked' : match.tier === 'candidate' ? 'candidate' : 'unlinked';
  const discoveryKey = `${scope}|${source.sourceType}|${source.sourceRecordKey}`;
  const contentMetadata = {
    generatedBy: RUN_NAME,
    confidenceTier: match.tier
  };
  const payload = {
    discovery_key: discoveryKey,
    program_scope: scope,
    source_type: source.sourceType,
    source_record_key: source.sourceRecordKey,
    title: source.title,
    summary: source.summary,
    entity_name: source.entityName,
    agency_name: source.agencyName,
    piid: source.piid,
    solicitation_id: source.solicitationId,
    notice_id: source.noticeId,
    usaspending_award_id: source.usaspendingAwardId,
    source_url: source.sourceUrl,
    published_at: source.publishedAt,
    amount: source.amount,
    join_status: joinStatus,
    best_candidate_story_key: match.storyKey,
    relevance_score: clampNumber(Math.max(source.relevanceScore, match.score), 0, 0.99),
    relevance_signals: dedupeSignals([...source.relevanceSignals, ...match.signals]),
    source_document_id: source.sourceDocumentId,
    metadata: contentMetadata
  };
  const storedMetadata = {
    ...contentMetadata,
    generatedAt: nowIso
  };

  return {
    ...payload,
    metadata: storedMetadata,
    content_hash: deterministicHash(stableJsonStringify(payload)),
    updated_at: nowIso
  };
}

function buildStorySourceLinkRow(
  scope: ProgramScope,
  source: DiscoverySourceRecord,
  match: { tier: StoryMatchTier; storyKey: string | null; score: number; signals: Array<Record<string, unknown>> },
  nowIso: string
): StorySourceLinkRow | null {
  if (match.tier !== 'exact' || !match.storyKey) return null;

  const payload = {
    story_key: match.storyKey,
    program_scope: scope,
    source_type: source.sourceType,
    source_record_key: source.sourceRecordKey,
    title: source.title,
    summary: source.summary,
    entity_name: source.entityName,
    agency_name: source.agencyName,
    piid: source.piid,
    solicitation_id: source.solicitationId,
    notice_id: source.noticeId,
    usaspending_award_id: source.usaspendingAwardId,
    source_url: source.sourceUrl,
    published_at: source.publishedAt,
    amount: source.amount,
    source_document_id: source.sourceDocumentId,
    metadata: {
      generatedBy: RUN_NAME,
      relevanceSignals: dedupeSignals(source.relevanceSignals),
      matchSignals: dedupeSignals(match.signals)
    }
  };

  return {
    ...payload,
    content_hash: deterministicHash(stableJsonStringify(payload)),
    metadata: {
      ...payload.metadata,
      generatedAt: nowIso
    },
    updated_at: nowIso
  };
}

async function upsertStoryCandidateRows(supabase: SupabaseClient, rows: StoryCandidateRow[]) {
  if (rows.length < 1) return 0;
  const existingHashes = await fetchExistingCandidateContentHashes(
    supabase,
    rows.map((row) => row.candidate_key)
  );
  const changedRows = rows.filter(
    (row) => existingHashes.get(row.candidate_key) !== row.content_hash
  );
  if (changedRows.length < 1) return 0;

  let upserted = 0;
  for (const chunk of chunkArray(changedRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('program_contract_story_candidates')
      .upsert(chunk, { onConflict: 'candidate_key' });
    if (error) {
      if (error.code === '42P01') return upserted;
      throw new Error(`program_contract_story_candidates upsert failed: ${stringifyError(error)}`);
    }
    upserted += chunk.length;
  }
  return upserted;
}

async function upsertStoryDiscoveryRows(supabase: SupabaseClient, rows: StoryDiscoveryRow[]) {
  if (rows.length < 1) return 0;
  const existingHashes = await fetchExistingDiscoveryContentHashes(
    supabase,
    rows.map((row) => row.discovery_key)
  );
  const changedRows = rows.filter(
    (row) => existingHashes.get(row.discovery_key) !== row.content_hash
  );
  if (changedRows.length < 1) return 0;

  let upserted = 0;
  for (const chunk of chunkArray(changedRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('program_contract_story_discoveries')
      .upsert(chunk, { onConflict: 'discovery_key' });
    if (error) {
      if (error.code === '42P01') return upserted;
      throw new Error(`program_contract_story_discoveries upsert failed: ${stringifyError(error)}`);
    }
    upserted += chunk.length;
  }
  return upserted;
}

async function upsertStorySourceLinkRows(
  supabase: SupabaseClient,
  scope: ProgramScope,
  rows: StorySourceLinkRow[],
  observedSources: StorySourceLinkObservedSource[]
) {
  if (observedSources.length < 1) return 0;

  const existingRows = await fetchExistingStorySourceLinkRows(
    supabase,
    scope,
    observedSources
  );
  const existingHashes = new Map<string, string>();
  for (const row of existingRows) {
    existingHashes.set(
      `${row.story_key}|${row.source_type}|${row.source_record_key}`,
      row.content_hash
    );
  }

  const desiredKeys = new Set(
    rows.map((row) => `${row.story_key}|${row.source_type}|${row.source_record_key}`)
  );
  const staleIds = existingRows
    .filter(
      (row) =>
        !desiredKeys.has(`${row.story_key}|${row.source_type}|${row.source_record_key}`)
    )
    .map((row) => row.id);

  for (const chunk of chunkArray(uniqueNonEmptyStrings(staleIds), UPSERT_CHUNK_SIZE)) {
    if (chunk.length < 1) continue;
    const { error } = await supabase
      .from('program_contract_story_source_links')
      .delete()
      .in('id', chunk);
    if (error) {
      if (error.code === '42P01') return 0;
      throw new Error(`program_contract_story_source_links delete failed: ${stringifyError(error)}`);
    }
  }

  const changedRows = rows.filter((row) => {
    const contentKey = `${row.story_key}|${row.source_type}|${row.source_record_key}`;
    return existingHashes.get(contentKey) !== row.content_hash;
  });
  if (changedRows.length < 1) return 0;

  let upserted = 0;
  for (const chunk of chunkArray(changedRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('program_contract_story_source_links')
      .upsert(chunk, { onConflict: 'story_key,source_type,source_record_key' });
    if (error) {
      if (error.code === '42P01') return upserted;
      throw new Error(`program_contract_story_source_links upsert failed: ${stringifyError(error)}`);
    }
    upserted += chunk.length;
  }
  return upserted;
}

async function fetchExistingCandidateContentHashes(
  supabase: SupabaseClient,
  candidateKeys: string[]
) {
  const normalizedKeys = uniqueNonEmptyStrings(candidateKeys);
  const hashes = new Map<string, string>();
  if (normalizedKeys.length < 1) return hashes;

  for (const chunk of chunkArray(normalizedKeys, STORY_HASH_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('program_contract_story_candidates')
      .select('candidate_key,content_hash')
      .in('candidate_key', chunk);
    if (error) {
      if (error.code === '42P01') return hashes;
      throw new Error(
        `program_contract_story_candidates content hash lookup failed: ${stringifyError(error)}`
      );
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const candidateKey = normalizeText(readString(row, 'candidate_key'));
      if (!candidateKey) continue;
      const contentHash = normalizeText(readString(row, 'content_hash'));
      hashes.set(candidateKey, contentHash || '');
    }
  }

  return hashes;
}

async function fetchExistingDiscoveryContentHashes(
  supabase: SupabaseClient,
  discoveryKeys: string[]
) {
  const normalizedKeys = uniqueNonEmptyStrings(discoveryKeys);
  const hashes = new Map<string, string>();
  if (normalizedKeys.length < 1) return hashes;

  for (const chunk of chunkArray(normalizedKeys, STORY_HASH_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('program_contract_story_discoveries')
      .select('discovery_key,content_hash')
      .in('discovery_key', chunk);
    if (error) {
      if (error.code === '42P01') return hashes;
      throw new Error(
        `program_contract_story_discoveries content hash lookup failed: ${stringifyError(error)}`
      );
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const discoveryKey = normalizeText(readString(row, 'discovery_key'));
      if (!discoveryKey) continue;
      const contentHash = normalizeText(readString(row, 'content_hash'));
      hashes.set(discoveryKey, contentHash || '');
    }
  }

  return hashes;
}

async function fetchExistingStorySourceLinkRows(
  supabase: SupabaseClient,
  scope: ProgramScope,
  observedSources: StorySourceLinkObservedSource[]
) {
  const rows: ExistingStorySourceLinkRow[] = [];
  const sourceTypes: Array<'sam-contract-award' | 'sam-opportunity'> = [
    'sam-contract-award',
    'sam-opportunity'
  ];

  for (const sourceType of sourceTypes) {
    const recordKeys = uniqueNonEmptyStrings(
      observedSources
        .filter((source) => source.source_type === sourceType)
        .map((source) => source.source_record_key)
    );
    if (recordKeys.length < 1) continue;

    for (const chunk of chunkArray(recordKeys, STORY_HASH_LOOKUP_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('program_contract_story_source_links')
        .select('id,story_key,source_type,source_record_key,content_hash')
        .eq('program_scope', scope)
        .eq('source_type', sourceType)
        .in('source_record_key', chunk);
      if (error) {
        if (error.code === '42P01') return [] as ExistingStorySourceLinkRow[];
        throw new Error(
          `program_contract_story_source_links lookup failed: ${stringifyError(error)}`
        );
      }

      for (const row of (data || []) as Array<Record<string, unknown>>) {
        const id = normalizeText(readString(row, 'id'));
        const storyKey = normalizeText(readString(row, 'story_key'));
        const sourceRecordKey = normalizeText(readString(row, 'source_record_key'));
        const contentHash = normalizeText(readString(row, 'content_hash')) || '';
        if (!id || !storyKey || !sourceRecordKey) continue;

        rows.push({
          id,
          story_key: storyKey,
          source_type: sourceType,
          source_record_key: sourceRecordKey,
          content_hash: contentHash
        });
      }
    }
  }

  return rows;
}

function isOpportunityNoticeRelevantToScope(scope: ProgramScope, row: OpportunityNoticeRow) {
  const metadata = asRecord(row.metadata);
  if (matchesScopeFromMetadata(scope, metadata)) {
    return {
      matched: true,
      score: 0.95,
      signals: [buildSignal('program_scope', scope, 0.95)]
    };
  }

  const haystack = normalizeMatchText([
    row.title,
    row.awardee_name,
    row.notice_url,
    readString(metadata, 'organizationName'),
    readString(metadata, 'departmentName'),
    readString(metadata, 'fullParentPathName'),
    readString(metadata, 'agencyName'),
    readString(metadata, 'description'),
    readString(metadata, 'summary'),
    readString(metadata, 'synopsis')
  ].filter(Boolean).join(' '));
  if (!haystack) {
    return {
      matched: false,
      score: 0,
      signals: []
    };
  }

  const signals: Array<Record<string, unknown>> = [];
  let score = 0;
  if (scope === 'artemis') {
    if (includesAnyNormalized(haystack, ['national aeronautics and space administration', 'nasa'])) {
      score += 0.4;
      signals.push(buildSignal('agency', 'nasa', 0.4));
    }
    if (
      includesAnyNormalized(haystack, [
        'artemis',
        'moon to mars',
        'human landing system',
        'hls',
        'gateway',
        'orion',
        'sls',
        'space launch system',
        'exploration ground systems',
        'xeva',
        'lunar'
      ])
    ) {
      score += 0.35;
      signals.push(buildSignal('keyword_family', 'artemis', 0.35));
    }
  } else if (scope === 'spacex') {
    if (includesAnyNormalized(haystack, ['spacex', 'space exploration technologies'])) {
      score += 0.6;
      signals.push(buildSignal('entity', 'spacex', 0.6));
    }
    if (includesAnyNormalized(haystack, ['falcon', 'dragon', 'starship', 'starlink'])) {
      score += 0.35;
      signals.push(buildSignal('keyword_family', 'spacex', 0.35));
    }
  } else if (scope === 'blue-origin') {
    if (includesAnyNormalized(haystack, ['blue origin'])) {
      score += 0.6;
      signals.push(buildSignal('entity', 'blue-origin', 0.6));
    }
    if (includesAnyNormalized(haystack, ['blue moon', 'new glenn', 'be-4', 'be-7'])) {
      score += 0.35;
      signals.push(buildSignal('keyword_family', 'blue-origin', 0.35));
    }
  }

  return {
    matched: score >= 0.5,
    score: clampNumber(score, 0, 0.99),
    signals
  };
}

function buildSignal(key: string, value: string, weight: number) {
  return {
    key,
    value,
    weight: clampNumber(weight, 0, 1)
  };
}

function dedupeSignals(signals: Array<Record<string, unknown>>) {
  return dedupeByKey(signals, (signal) =>
    `${normalizeMatchKey(readString(signal, 'key')) || ''}|${normalizeMatchKey(readString(signal, 'value')) || ''}`
  );
}

function includesAnyNormalized(haystack: string | null, needles: string[]) {
  const normalizedHaystack = normalizeMatchText(haystack);
  if (!normalizedHaystack) return false;
  return needles.some((needle) => {
    const normalizedNeedle = normalizeMatchText(needle);
    if (!normalizedNeedle) return false;
    return normalizedHaystack.includes(normalizedNeedle);
  });
}

function countTokenOverlap(left: string | null, right: string | null) {
  const leftTokens = new Set(tokenizeOverlapText(left));
  const rightTokens = tokenizeOverlapText(right);
  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function tokenizeOverlapText(value: string | null | undefined) {
  const normalized = normalizeMatchText(value) || '';
  return normalized
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4);
}

function computeDateDeltaDays(left: string | null, right: string | null) {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return Math.abs(Math.round((leftMs - rightMs) / (24 * 60 * 60 * 1000)));
}

function dedupeByKey<T>(rows: T[], getKey: (row: T) => string) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = getKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function claimStoryAggregate(input: {
  scope: ProgramScope;
  seed: StorySeed;
  strategy: MatchStrategy;
  confidence: number;
  storyMap: Map<string, StoryAggregate>;
  storyByAwardId: Map<string, string>;
  storyByPiid: Map<string, string>;
  storyByContractKey: Map<string, string>;
  storyBySolicitationId: Map<string, string>;
  storyByNoticeId: Map<string, string>;
}) {
  const normalizedSeed: StorySeed = {
    awardId: normalizeAwardId(input.seed.awardId),
    piid: normalizeText(input.seed.piid),
    contractKey: normalizeText(input.seed.contractKey),
    solicitationId: normalizeText(input.seed.solicitationId),
    noticeId: normalizeText(input.seed.noticeId)
  };

  const existingKey =
    (normalizedSeed.awardId ? input.storyByAwardId.get(normalizedSeed.awardId) : null) ||
    (normalizedSeed.piid ? input.storyByPiid.get(normalizedSeed.piid) : null) ||
    (normalizedSeed.contractKey ? input.storyByContractKey.get(normalizedSeed.contractKey) : null) ||
    (normalizedSeed.solicitationId
      ? input.storyBySolicitationId.get(normalizedSeed.solicitationId)
      : null) ||
    (normalizedSeed.noticeId ? input.storyByNoticeId.get(normalizedSeed.noticeId) : null) ||
    null;

  const storyKey =
    existingKey ||
    buildStoryKey(input.scope, normalizedSeed) ||
    `${input.scope}|generated-${crypto.randomUUID()}`;

  let aggregate = input.storyMap.get(storyKey) || null;
  if (!aggregate) {
    aggregate = {
      storyKey,
      programScope: input.scope,
      matchStrategy: input.strategy,
      matchConfidence: clampNumber(input.confidence, 0, 0.99),
      primaryUsaspendingAwardId: normalizedSeed.awardId,
      primaryPiid: normalizedSeed.piid,
      primaryContractKey: normalizedSeed.contractKey,
      primarySolicitationId: normalizedSeed.solicitationId,
      primaryNoticeId: normalizedSeed.noticeId,
      missionKey: null,
      recipient: null,
      title: null,
      awardedOn: null,
      obligatedAmount: null,
      actionCount: 0,
      noticeCount: 0,
      spendingPointCount: 0,
      bidderNames: new Set<string>(),
      latestActionDate: null,
      latestNoticeDate: null,
      latestSpendingFiscalYear: null,
      latestSpendingFiscalMonth: null,
      evidence: {
        sources: new Set<string>(),
        awardIds: new Set<string>(),
        piids: new Set<string>(),
        contractKeys: new Set<string>(),
        solicitationIds: new Set<string>(),
        noticeIds: new Set<string>(),
        samRowKeys: new Set<string>(),
        contractIds: new Set<string>()
      }
    };
    input.storyMap.set(storyKey, aggregate);
  } else {
    if (matchPriority(input.strategy) > matchPriority(aggregate.matchStrategy)) {
      aggregate.matchStrategy = input.strategy;
    }
    if (input.confidence > aggregate.matchConfidence) {
      aggregate.matchConfidence = input.confidence;
    }
  }

  if (normalizedSeed.awardId) {
    if (!aggregate.primaryUsaspendingAwardId) {
      aggregate.primaryUsaspendingAwardId = normalizedSeed.awardId;
    }
    input.storyByAwardId.set(normalizedSeed.awardId, aggregate.storyKey);
  }
  if (normalizedSeed.piid) {
    if (!aggregate.primaryPiid) {
      aggregate.primaryPiid = normalizedSeed.piid;
    }
    input.storyByPiid.set(normalizedSeed.piid, aggregate.storyKey);
  }
  if (normalizedSeed.contractKey) {
    if (!aggregate.primaryContractKey) {
      aggregate.primaryContractKey = normalizedSeed.contractKey;
    }
    input.storyByContractKey.set(normalizedSeed.contractKey, aggregate.storyKey);
  }
  if (normalizedSeed.solicitationId) {
    if (!aggregate.primarySolicitationId) {
      aggregate.primarySolicitationId = normalizedSeed.solicitationId;
    }
    input.storyBySolicitationId.set(normalizedSeed.solicitationId, aggregate.storyKey);
  }
  if (normalizedSeed.noticeId) {
    if (!aggregate.primaryNoticeId) {
      aggregate.primaryNoticeId = normalizedSeed.noticeId;
    }
    input.storyByNoticeId.set(normalizedSeed.noticeId, aggregate.storyKey);
  }

  if (aggregate.primaryUsaspendingAwardId) input.storyByAwardId.set(aggregate.primaryUsaspendingAwardId, aggregate.storyKey);
  if (aggregate.primaryPiid) input.storyByPiid.set(aggregate.primaryPiid, aggregate.storyKey);
  if (aggregate.primaryContractKey) input.storyByContractKey.set(aggregate.primaryContractKey, aggregate.storyKey);
  if (aggregate.primarySolicitationId) input.storyBySolicitationId.set(aggregate.primarySolicitationId, aggregate.storyKey);
  if (aggregate.primaryNoticeId) input.storyByNoticeId.set(aggregate.primaryNoticeId, aggregate.storyKey);

  return aggregate;
}

function mergeStoryRowDetails(
  aggregate: StoryAggregate,
  update: {
    missionKey: string | null;
    recipient: string | null;
    title: string | null;
    awardedOn: string | null;
    obligatedAmount: number | null;
  }
) {
  if (!aggregate.missionKey && update.missionKey) aggregate.missionKey = update.missionKey;
  if (!aggregate.recipient && update.recipient) aggregate.recipient = update.recipient;
  if (!aggregate.title && update.title) aggregate.title = update.title;

  if (update.awardedOn) {
    if (!aggregate.awardedOn) {
      aggregate.awardedOn = update.awardedOn;
    } else {
      const currentTime = Date.parse(aggregate.awardedOn);
      const nextTime = Date.parse(update.awardedOn);
      if (!Number.isFinite(currentTime) || (Number.isFinite(nextTime) && nextTime > currentTime)) {
        aggregate.awardedOn = update.awardedOn;
      }
    }
  }

  if (update.obligatedAmount != null && aggregate.obligatedAmount == null) {
    aggregate.obligatedAmount = update.obligatedAmount;
  }
}

function addEvidenceFromSeed(aggregate: StoryAggregate, seed: StorySeed) {
  if (seed.awardId) aggregate.evidence.awardIds.add(seed.awardId);
  if (seed.piid) aggregate.evidence.piids.add(seed.piid);
  if (seed.contractKey) aggregate.evidence.contractKeys.add(seed.contractKey);
  if (seed.solicitationId) aggregate.evidence.solicitationIds.add(seed.solicitationId);
  if (seed.noticeId) aggregate.evidence.noticeIds.add(seed.noticeId);
}

async function fetchProcurementRows(
  supabase: SupabaseClient,
  scope: ProgramScope,
  limit: number
) {
  const selectFields =
    'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,metadata,updated_at';

  const rows: ProcurementAwardRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const pageSize = Math.min(POSTGREST_MAX_ROWS, limit - rows.length);
    const scoped = await supabase
      .from('artemis_procurement_awards')
      .select(selectFields)
      .eq('program_scope', scope)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (scoped.error) {
      if (!isMissingColumnError(scoped.error.message, 'program_scope')) {
        throw new Error(`procurement row query failed: ${stringifyError(scoped.error)}`);
      }

      return fetchProcurementRowsByMetadataScope(supabase, scope, limit, selectFields);
    }

    const pageRows = (scoped.data || []) as ProcurementAwardRow[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    offset += pageRows.length;
  }

  return rows.slice(0, limit);
}

async function fetchProcurementRowsByMetadataScope(
  supabase: SupabaseClient,
  scope: ProgramScope,
  limit: number,
  selectFields: string
) {
  const rows: ProcurementAwardRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const fallback = await supabase
      .from('artemis_procurement_awards')
      .select(selectFields)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + POSTGREST_MAX_ROWS - 1);

    if (fallback.error) {
      throw new Error(`procurement fallback query failed: ${stringifyError(fallback.error)}`);
    }

    const pageRows = ((fallback.data || []) as unknown) as ProcurementAwardRow[];
    for (const row of pageRows) {
      if (!matchesScopeFromMetadata(scope, row.metadata)) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }

    if (pageRows.length < POSTGREST_MAX_ROWS) break;
    offset += pageRows.length;
  }

  return rows.slice(0, limit);
}

async function fetchSamContractAwardRows(
  supabase: SupabaseClient,
  scope: ProgramScope,
  limit: number
) {
  const rows: SamContractAwardRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const pageSize = Math.min(POSTGREST_MAX_ROWS, limit - rows.length);
    const { data, error } = await supabase
      .from('artemis_sam_contract_award_rows')
      .select('row_key,contract_key,mission_key,solicitation_id,piid,source_document_id,metadata,updated_at')
      .eq('program_scope', scope)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`sam contract award row query failed: ${stringifyError(error)}`);
    }

    const pageRows = (data || []) as SamContractAwardRow[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    offset += pageRows.length;
  }

  return rows.slice(0, limit);
}

async function fetchContracts(
  supabase: SupabaseClient,
  input: { contractKeys: string[]; piids: string[]; limit: number }
) {
  const rows: ContractRow[] = [];
  const seen = new Set<string>();

  for (const chunk of chunkArray(uniqueNonEmptyStrings(input.contractKeys), 200)) {
    const { data, error } = await supabase
      .from('artemis_contracts')
      .select('id,contract_key,piid,mission_key,awardee_name,description,base_award_date,metadata')
      .in('contract_key', chunk)
      .limit(input.limit);

    if (error) throw new Error(`contract query by key failed: ${stringifyError(error)}`);
    for (const row of (data || []) as ContractRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      if (rows.length >= input.limit) return rows;
    }
  }

  for (const chunk of chunkArray(uniqueNonEmptyStrings(input.piids), 200)) {
    const { data, error } = await supabase
      .from('artemis_contracts')
      .select('id,contract_key,piid,mission_key,awardee_name,description,base_award_date,metadata')
      .in('piid', chunk)
      .limit(input.limit);

    if (error) throw new Error(`contract query by piid failed: ${stringifyError(error)}`);
    for (const row of (data || []) as ContractRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      if (rows.length >= input.limit) return rows;
    }
  }

  return rows.slice(0, input.limit);
}

async function fetchContractActions(
  supabase: SupabaseClient,
  contractIds: string[],
  limit: number
) {
  if (contractIds.length < 1) return [] as ContractActionRow[];

  const rows: ContractActionRow[] = [];
  for (const chunk of chunkArray(uniqueNonEmptyStrings(contractIds), 200)) {
    const { data, error } = await supabase
      .from('artemis_contract_actions')
      .select('contract_id,action_date,solicitation_id,sam_notice_id')
      .in('contract_id', chunk)
      .order('action_date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(`contract action query failed: ${stringifyError(error)}`);
    rows.push(...((data || []) as ContractActionRow[]));
    if (rows.length >= limit) break;
  }

  return rows.slice(0, limit);
}

async function fetchSpendingRows(
  supabase: SupabaseClient,
  contractIds: string[],
  limit: number
) {
  if (contractIds.length < 1) return [] as SpendingPointRow[];

  const rows: SpendingPointRow[] = [];
  for (const chunk of chunkArray(uniqueNonEmptyStrings(contractIds), 200)) {
    const { data, error } = await supabase
      .from('artemis_spending_timeseries')
      .select('contract_id,fiscal_year,fiscal_month')
      .in('contract_id', chunk)
      .order('fiscal_year', { ascending: false })
      .order('fiscal_month', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`spending row query failed: ${stringifyError(error)}`);
    rows.push(...((data || []) as SpendingPointRow[]));
    if (rows.length >= limit) break;
  }

  return rows.slice(0, limit);
}

async function fetchOpportunityNotices(
  supabase: SupabaseClient,
  solicitationIds: string[],
  limit: number
) {
  if (solicitationIds.length < 1) return [] as OpportunityNoticeRow[];

  const rows: OpportunityNoticeRow[] = [];
  const seen = new Set<string>();
  for (const chunk of chunkArray(uniqueNonEmptyStrings(solicitationIds), 100)) {
    const { data, error } = await supabase
      .from('artemis_opportunity_notices')
      .select('notice_id,solicitation_id,title,posted_date,awardee_name,award_amount,notice_url,source_document_id,metadata')
      .in('solicitation_id', chunk)
      .order('posted_date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(`opportunity notice query failed: ${stringifyError(error)}`);
    for (const row of (data || []) as OpportunityNoticeRow[]) {
      const noticeId = normalizeText(row.notice_id);
      if (!noticeId || seen.has(noticeId)) continue;
      seen.add(noticeId);
      rows.push(row);
      if (rows.length >= limit) break;
    }

    if (rows.length >= limit) break;
  }

  return rows.slice(0, limit);
}

function buildStoryKey(scope: ProgramScope, seed: StorySeed) {
  if (seed.awardId) return `${scope}|usaspending-${seed.awardId}`;
  if (seed.piid) return `${scope}|piid-${seed.piid}`;
  if (seed.contractKey) return `${scope}|contract-${seed.contractKey}`;
  if (seed.solicitationId) return `${scope}|solicitation-${seed.solicitationId}`;
  if (seed.noticeId) return `${scope}|notice-${seed.noticeId}`;
  return null;
}

function chooseMatchStrategy(seed: StorySeed): MatchStrategy {
  if (seed.awardId) return 'exact_award_id';
  if (seed.piid) return 'exact_piid';
  if (seed.solicitationId) return 'exact_solicitation';
  return 'heuristic_multi_signal';
}

function matchPriority(strategy: MatchStrategy) {
  if (strategy === 'exact_award_id') return 4;
  if (strategy === 'exact_piid') return 3;
  if (strategy === 'exact_solicitation') return 2;
  return 1;
}

function matchesScopeFromMetadata(scope: ProgramScope, metadata: Record<string, unknown> | null) {
  const raw = asRecord(metadata);
  const direct = normalizeScopeText(
    readString(raw, 'programScope') || readString(raw, 'program_scope')
  );
  if (direct) return direct === scope;

  const scopes = readStringArray(raw.programScopes).concat(readStringArray(raw.program_scopes));
  if (scopes.length < 1) return false;
  return scopes.some((value) => normalizeScopeText(value) === scope);
}

function normalizeScopeText(value: string | null | undefined): ProgramScope | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized === 'artemis') return 'artemis';
  if (normalized === 'spacex' || normalized === 'space-x' || normalized === 'space_x') return 'spacex';
  if (normalized === 'blue-origin' || normalized === 'blue_origin' || normalized === 'blueorigin') {
    return 'blue-origin';
  }
  return null;
}

function parseAwardIdFromContractKey(contractKey: string | null | undefined) {
  const normalized = normalizeText(contractKey);
  if (!normalized) return null;
  const match = /^usaspending[-: ]+(.+)$/i.exec(normalized);
  if (!match?.[1]) return null;
  return normalizeAwardId(match[1]);
}

function normalizeAwardId(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.toUpperCase();
}

function maxIsoDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeText(readString(record, key));
    if (value) return value;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = finiteNumberOrNull(record[key]);
    if (value != null) return value;
  }
  return null;
}

function firstDate(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeDate(readString(record, key));
    if (value) return value;
  }
  return null;
}

function normalizeDate(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const collapsed = normalized.toLowerCase().replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeMatchKey(value: string | null | undefined) {
  return normalizeMatchText(value);
}

function normalizeIdentifierKey(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const collapsed = normalized.replace(/\s+/g, ' ').trim().toUpperCase();
  return collapsed.length > 0 ? collapsed : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  }
  return [...set.values()];
}

function sortNormalizedStrings(values: Array<string | null | undefined>) {
  return uniqueNonEmptyStrings(values).sort((left, right) =>
    left.localeCompare(right)
  );
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
    ordered[key] = stableJsonValue(record[key]);
  }
  return ordered;
}

function deterministicHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}:${value.length.toString(16)}`;
}

function chunkArray<T>(values: T[], size: number) {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function isMissingColumnError(message: string | undefined, columnName: string) {
  const normalized = (message || '').toLowerCase();
  return normalized.includes(columnName.toLowerCase()) && normalized.includes('column');
}
