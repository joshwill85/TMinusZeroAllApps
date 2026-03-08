import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/artemisIngest.ts';
import { ARTEMIS_SOURCE_URLS } from '../_shared/artemisSources.ts';
import {
  classifyUsaspendingAwardForScope,
  normalizeProgramScope as normalizeHubAuditProgramScope,
  readProgramScopes as readHubAuditProgramScopes,
  type UsaSpendingAwardAuditInput
} from '../../../lib/usaspending/hubAudit.ts';

type MissionKey =
  | 'program'
  | 'artemis-i'
  | 'artemis-ii'
  | 'artemis-iii'
  | 'artemis-iv'
  | 'artemis-v'
  | 'artemis-vi'
  | 'artemis-vii';

type ProgramScope = 'artemis' | 'blue-origin' | 'spacex';

type UsaSpendingQueryGroup = {
  name: string;
  awardTypeCodes: string[];
  sortField: string;
};

type UsaSpendingAgencyFilter = {
  type: string;
  tier: string;
  name: string;
};

type UsaSpendingSearchMeta = {
  ok: boolean;
  status: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  json: unknown;
  text: string;
};

type QuerySummary = {
  scope: ProgramScope;
  group: string;
  keyword: string;
  recipientSearchText: string | null;
  status: number;
  ok: boolean;
  resultCount: number;
  error: string | null;
};

type AwardRecord = {
  id: string;
  title: string;
  recipient: string;
  amount: number | null;
  date: string | null;
  scope: ProgramScope;
  missionKey: MissionKey;
  metadata: Record<string, unknown>;
};

type ProcurementScopeConfig = {
  scope: ProgramScope;
  label: string;
  agencies: UsaSpendingAgencyFilter[] | null;
  keywords: string[];
  recipientSearchTerms: string[];
  minHealthyAwardCount: number;
};

type ScopeRunStats = {
  scope: ProgramScope;
  label: string;
  keywordsPlanned: number;
  keywordsProcessed: number;
  queriesAttempted: number;
  queriesSucceeded: number;
  awardsBeforeFilter: number;
  awardsExcludedByRelevance: number;
  awardsSelected: number;
  relevanceFallback: boolean;
};

const NASA_AWARDING_AGENCY_FILTER = [{ type: 'awarding', tier: 'toptier', name: 'National Aeronautics and Space Administration' }];
const QUERY_LIMIT = 100;
const MAX_PAGES_PER_QUERY = 250;
const DEFAULT_MIN_HEALTHY_AWARD_COUNT = 5;
const UPSERT_BATCH_SIZE = 300;
const HTTP_RETRY_ATTEMPTS = 4;
const HTTP_RETRY_BASE_DELAY_MS = 400;

const QUERY_GROUPS: UsaSpendingQueryGroup[] = [
  { name: 'contracts', awardTypeCodes: ['A', 'B', 'C', 'D'], sortField: 'Award Amount' },
  { name: 'idvs', awardTypeCodes: ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'], sortField: 'Award Amount' },
  { name: 'grants', awardTypeCodes: ['02', '03', '04', '05', 'F001', 'F002'], sortField: 'Award Amount' },
  { name: 'loans', awardTypeCodes: ['07', '08', 'F003', 'F004'], sortField: 'Loan Value' },
  { name: 'direct_payments', awardTypeCodes: ['06', '10', 'F006', 'F007'], sortField: 'Award Amount' },
  { name: 'other_financial_assistance', awardTypeCodes: ['09', '11', '-1', 'F005', 'F008', 'F009', 'F010'], sortField: 'Award Amount' }
];

const USASPENDING_AWARD_FIELDS = [
  'Award ID',
  'Recipient Name',
  'Recipient UEI',
  'Parent Recipient Name',
  'Parent Recipient UEI',
  'Award Amount',
  'Outlayed Amount',
  'Description',
  'Award Type',
  'Contract Award Type',
  'Loan Value',
  'Subsidy Cost',
  'Issued Date',
  'Base Obligation Date',
  'Action Date',
  'Start Date',
  'End Date',
  'Last Modified Date',
  'Awarding Agency',
  'Awarding Agency Code',
  'Awarding Sub Agency',
  'Awarding Office Name',
  'Awarding Office Code',
  'Funding Agency',
  'Funding Agency Code',
  'Funding Sub Agency',
  'Funding Office Name',
  'Funding Office Code',
  'Period of Performance Start Date',
  'Period of Performance Current End Date',
  'Period of Performance Potential End Date',
  'Potential Total Value of Award',
  'Current Total Value of Award',
  'Type of Contract Pricing',
  'Set Aside Type',
  'Extent Competed',
  'NAICS Code',
  'NAICS Description',
  'PSC Code',
  'PSC Description',
  'Product or Service Code',
  'Place of Performance Country Code',
  'Place of Performance Country Name',
  'Place of Performance State Code',
  'Place of Performance State Name',
  'Place of Performance City Name',
  'Place of Performance Zip5',
  'generated_internal_id',
  'generated_unique_award_id'
];

const PROCUREMENT_SCOPES: ProcurementScopeConfig[] = [
  {
    scope: 'artemis',
    label: 'Artemis',
    agencies: NASA_AWARDING_AGENCY_FILTER,
    // Order matters: start specific, then broaden.
    keywords: [
      'Artemis II',
      'Artemis III',
      'Artemis I',
      'Artemis IV',
      'Artemis program',
      'Moon to Mars',
      'Space Launch System',
      'Exploration Ground Systems',
      'Human Landing System',
      'Gateway',
      'xEVA',
      'Orion',
      'Mobile Launcher',
      'Artemis'
    ],
    recipientSearchTerms: [],
    minHealthyAwardCount: DEFAULT_MIN_HEALTHY_AWARD_COUNT
  },
  {
    scope: 'blue-origin',
    label: 'Blue Origin',
    agencies: null,
    keywords: ['Blue Origin', 'Blue Moon', 'New Glenn', 'Blue Origin Federation', 'Blue Origin Manufacturing', 'Blue Origin Washington', 'BE-4', 'BE-7'],
    recipientSearchTerms: ['Blue Origin, LLC', 'Blue Origin', 'Blue Origin Federation, LLC'],
    minHealthyAwardCount: 1
  },
  {
    scope: 'spacex',
    label: 'SpaceX',
    agencies: null,
    keywords: ['SpaceX', 'Space Exploration Technologies', 'Falcon 9', 'Falcon Heavy', 'Dragon', 'Starship', 'Starlink'],
    recipientSearchTerms: ['Space Exploration Technologies Corp.', 'SpaceX'],
    minHealthyAwardCount: 1
  }
];

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_procurement_ingest');
  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    awardsInserted: 0,
    timelineEventsUpserted: 0,
    queriesAttempted: 0,
    queriesSucceeded: 0,
    scopeStats: [] as ScopeRunStats[],
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_procurement_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'usaspending_awards', {
      sourceType: 'procurement',
      status: 'running',
      startedAt: new Date().toISOString(),
      lastError: null
    });

    const relevanceFilterEnabled = await readBooleanSetting(supabase, 'artemis_procurement_relevance_filter_enabled', true);
    const maxPagesPerQuery = await readPositiveIntegerSetting(
      supabase,
      'artemis_procurement_max_pages_per_query',
      MAX_PAGES_PER_QUERY,
      1,
      1000
    );
    stats.relevanceFilterEnabled = relevanceFilterEnabled;
    stats.maxPagesPerQuery = maxPagesPerQuery;

    const querySummaries: QuerySummary[] = [];
    const dedupedAwards = new Map<string, AwardRecord>();

    for (const scopeConfig of PROCUREMENT_SCOPES) {
      const scopeDeduped = new Map<string, AwardRecord>();
      let queryInputsProcessed = 0;

      for (const keyword of scopeConfig.keywords) {
        await runAwardQueryRound({
          scope: scopeConfig.scope,
          agencies: scopeConfig.agencies,
          keyword,
          recipientSearchText: null,
          querySummaries,
          dedupedAwards: scopeDeduped,
          maxPagesPerQuery
        });
        queryInputsProcessed += 1;
      }
      if (scopeConfig.recipientSearchTerms.length > 0) {
        for (const recipientSearchText of scopeConfig.recipientSearchTerms) {
          await runAwardQueryRound({
            scope: scopeConfig.scope,
            agencies: scopeConfig.agencies,
            keyword: scopeConfig.keywords[0] || scopeConfig.label,
            recipientSearchText,
            querySummaries,
            dedupedAwards: scopeDeduped,
            maxPagesPerQuery
          });
          queryInputsProcessed += 1;
        }
      }

      const scopeSummaries = querySummaries.filter((summary) => summary.scope === scopeConfig.scope);
      const scopeAttempted = scopeSummaries.length;
      const scopeSucceeded = scopeSummaries.filter((summary) => summary.ok).length;

      if (scopeConfig.scope === 'artemis' && scopeSucceeded === 0) {
        throw new Error('usaspending_no_successful_queries_artemis');
      }

      const unfilteredAwards = [...scopeDeduped.values()];
      const filtered = relevanceFilterEnabled
        ? scopeConfig.scope === 'artemis'
          ? filterAwardsForArtemisProgram(unfilteredAwards)
          : filterAwardsForCompanyScope(unfilteredAwards, scopeConfig.scope)
        : {
            kept: unfilteredAwards,
            excluded: [] as Array<{ awardId: string; title: string; amount: number | null; keywords: string[]; reason: string }>
          };

      let finalAwards = filtered.kept;
      let finalExcluded = filtered.excluded;
      let relevanceFallback = false;

      if (finalAwards.length < scopeConfig.minHealthyAwardCount && unfilteredAwards.length >= scopeConfig.minHealthyAwardCount) {
        // Keep data flowing when heuristics over-filter due to upstream title/description drift.
        relevanceFallback = true;
        finalAwards = unfilteredAwards;
        finalExcluded = [];
      }

      const selectedAwards = [...finalAwards].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));

      if (scopeConfig.scope === 'artemis' && selectedAwards.length < scopeConfig.minHealthyAwardCount) {
        throw new Error(`usaspending_awards_below_threshold:artemis:${selectedAwards.length}`);
      }

      for (const award of selectedAwards) {
        const key = awardDedupeKey(award);
        const existing = dedupedAwards.get(key);
        if (!existing) {
          dedupedAwards.set(key, award);
          continue;
        }
        dedupedAwards.set(key, mergeAwardRecords(existing, award));
      }

      (stats.scopeStats as ScopeRunStats[]).push({
        scope: scopeConfig.scope,
        label: scopeConfig.label,
        keywordsPlanned: scopeConfig.keywords.length + scopeConfig.recipientSearchTerms.length,
        keywordsProcessed: queryInputsProcessed,
        queriesAttempted: scopeAttempted,
        queriesSucceeded: scopeSucceeded,
        awardsBeforeFilter: unfilteredAwards.length,
        awardsExcludedByRelevance: finalExcluded.length,
        awardsSelected: selectedAwards.length,
        relevanceFallback
      });
    }

    stats.queriesAttempted = querySummaries.length;
    stats.queriesSucceeded = querySummaries.filter((summary) => summary.ok).length;

    if (Number(stats.queriesSucceeded || 0) === 0) {
      throw new Error('usaspending_no_successful_queries');
    }

    const awards = [...dedupedAwards.values()].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));

    stats.awardsBeforeFilter = Number((stats.scopeStats as ScopeRunStats[]).reduce((sum, scope) => sum + scope.awardsBeforeFilter, 0));
    stats.awardsExcludedByRelevance = Number((stats.scopeStats as ScopeRunStats[]).reduce((sum, scope) => sum + scope.awardsExcludedByRelevance, 0));
    stats.awardsSelected = awards.length;
    stats.scopeAwardBreakdown = (stats.scopeStats as ScopeRunStats[]).reduce<Record<string, number>>((acc, item) => {
      acc[item.scope] = item.awardsSelected;
      return acc;
    }, {});

    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: 'usaspending_awards',
      sourceType: 'procurement',
      url: ARTEMIS_SOURCE_URLS.usaspendingAwardSearch,
      title: 'USASpending procurement refresh (Artemis, Blue Origin, SpaceX)',
      summary: `Resolved ${awards.length} procurement rows across Artemis/Blue Origin/SpaceX from ${String(stats.queriesSucceeded)}/${querySummaries.length} successful USASpending queries.`,
      announcedTime: new Date().toISOString(),
      httpStatus: highestStatus(querySummaries),
      contentType: 'application/json',
      raw: {
        fields: USASPENDING_AWARD_FIELDS,
        ingestConfig: {
          relevanceFilterEnabled,
          maxPagesPerQuery,
          queryLimit: QUERY_LIMIT
        },
        scopes: PROCUREMENT_SCOPES.map((scope) => ({
          scope: scope.scope,
          label: scope.label,
          keywords: scope.keywords
        })),
        querySummaries,
        scopeStats: stats.scopeStats,
        sampleAwards: awards.slice(0, 10).map((award) => ({
          awardId: award.id,
          scope: award.scope,
          title: award.title,
          amount: award.amount,
          missionKey: award.missionKey
        }))
      }
    });

    stats.sourceDocumentsInserted = 1;

    const rowsByConflict = new Map<
      string,
      {
        usaspending_award_id: string;
        award_title: string;
        recipient: string;
        obligated_amount: number | null;
        awarded_on: string | null;
        mission_key: MissionKey;
        source_document_id: string;
        metadata: Record<string, unknown>;
        updated_at: string;
      }
    >();

    for (const award of awards) {
      const missionKey = missionKeyForStorage(award);
      const row = {
        usaspending_award_id: award.id,
        award_title: award.title,
        recipient: award.recipient,
        obligated_amount: award.amount,
        awarded_on: award.date,
        mission_key: missionKey,
        source_document_id: sourceDocId,
        metadata: {
          ...award.metadata,
          programScope: primaryProgramScopeFromMetadata(award.metadata) || award.scope,
          programScopes: extractProgramScopes(award.metadata),
          sourceModel: 'multi-scope-usaspending-v2'
        },
        updated_at: new Date().toISOString()
      };

      const conflictKey = `${row.usaspending_award_id}|${row.mission_key}`;
      if (!rowsByConflict.has(conflictKey)) {
        rowsByConflict.set(conflictKey, row);
      }
    }

    const rows = [...rowsByConflict.values()];
    stats.awardsDedupedForUpsert = Math.max(0, awards.length - rows.length);

    for (const chunk of chunkRows(rows, UPSERT_BATCH_SIZE)) {
      const { error } = await supabase.from('artemis_procurement_awards').upsert(chunk, { onConflict: 'usaspending_award_id,mission_key' });
      if (error) throw error;
    }
    stats.awardsInserted = rows.length;

    const staleDelete = await supabase
      .from('artemis_procurement_awards')
      .delete({ count: 'exact' })
      .neq('source_document_id', sourceDocId)
      .or('metadata->>sourceModel.eq.multi-scope-usaspending,metadata->>sourceModel.eq.multi-scope-usaspending-v2');
    if (staleDelete.error) throw staleDelete.error;
    stats.staleRowsDeleted = staleDelete.count || 0;

    await upsertTimelineEvent(supabase, {
      fingerprint: ['procurement-refresh', new Date().toISOString().slice(0, 10)].join('|'),
      missionKey: 'program',
      title: 'Procurement data refreshed (Artemis, Blue Origin, SpaceX)',
      summary: 'USASpending procurement awards were refreshed across Artemis, Blue Origin, and SpaceX query scopes.',
      eventTime: null,
      eventTimePrecision: 'unknown',
      announcedTime: new Date().toISOString(),
      sourceType: 'procurement',
      confidence: 'secondary',
      sourceDocumentId: sourceDocId,
      sourceUrl: ARTEMIS_SOURCE_URLS.usaspendingAwardSearch,
      tags: ['procurement']
    });
    stats.timelineEventsUpserted = 1;

    await updateCheckpoint(supabase, 'usaspending_awards', {
      sourceType: 'procurement',
      status: 'complete',
      recordsIngested: Number(stats.awardsInserted || 0),
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: new Date().toISOString(),
      lastError: null,
      metadata: {
        queriesAttempted: querySummaries.length,
        queriesSucceeded: Number(stats.queriesSucceeded || 0),
        awardsFound: awards.length,
        scopeStats: stats.scopeStats,
        queryGroups: QUERY_GROUPS,
        relevanceFilterEnabled,
        maxPagesPerQuery
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'usaspending_awards', {
      sourceType: 'procurement',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function runAwardQueryRound({
  scope,
  agencies,
  keyword,
  recipientSearchText,
  querySummaries,
  dedupedAwards,
  maxPagesPerQuery
}: {
  scope: ProgramScope;
  agencies: UsaSpendingAgencyFilter[] | null;
  keyword: string;
  recipientSearchText: string | null;
  querySummaries: QuerySummary[];
  dedupedAwards: Map<string, AwardRecord>;
  maxPagesPerQuery: number;
}) {
  for (const group of QUERY_GROUPS) {
    let lastStatus = 0;
    let hadSuccessfulPage = false;
    let lastError: string | null = null;
    let pagesFetched = 0;
    let resultCount = 0;

    for (let page = 1; page <= maxPagesPerQuery; page += 1) {
      const response = await searchUsaSpendingAwards({ group, keyword, agencies, page, recipientSearchText });
      pagesFetched += 1;
      lastStatus = response.status;
      if (response.ok) hadSuccessfulPage = true;

      const extracted = extractAwards(response.json, {
        scope,
        groupName: group.name,
        keyword
      });
      resultCount += extracted.length;
      for (const award of extracted) {
        const key = awardDedupeKey(award);
        const existing = dedupedAwards.get(key);
        if (!existing) {
          dedupedAwards.set(key, award);
          continue;
        }
        dedupedAwards.set(key, mergeAwardRecords(existing, award));
      }

      const errorMessage = extractApiError(response.json);
      if (response.status === 422 && errorMessage) {
        throw new Error(`usaspending_query_invalid:${scope}:${group.name}:${keyword}:${errorMessage}`);
      }
      if (!response.ok) {
        const normalizedError = errorMessage || `http_${response.status}`;
        lastError = hadSuccessfulPage ? `partial_failure:${normalizedError}` : normalizedError;
        break;
      }
      if (!responseHasNextPage(response.json)) {
        break;
      }
    }

    querySummaries.push({
      scope,
      group: pagesFetched > 1 ? `${group.name} (pages:${pagesFetched})` : group.name,
      keyword,
      recipientSearchText,
      status: lastStatus,
      ok: hadSuccessfulPage,
      resultCount,
      error: lastError
    });
  }
}

async function searchUsaSpendingAwards({
  group,
  keyword,
  agencies,
  page,
  recipientSearchText
}: {
  group: UsaSpendingQueryGroup;
  keyword: string;
  agencies: UsaSpendingAgencyFilter[] | null;
  page: number;
  recipientSearchText: string | null;
}): Promise<UsaSpendingSearchMeta> {
  const filters: Record<string, unknown> = {
    award_type_codes: group.awardTypeCodes,
    keyword
  };

  if (agencies && agencies.length > 0) {
    filters.agencies = agencies;
  }
  if (recipientSearchText && recipientSearchText.trim().length > 0) {
    filters.recipient_search_text = [recipientSearchText.trim()];
  }

  for (let attempt = 1; attempt <= HTTP_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(ARTEMIS_SOURCE_URLS.usaspendingAwardSearch, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filters,
          fields: USASPENDING_AWARD_FIELDS,
          page: Math.max(1, Math.trunc(page)),
          limit: QUERY_LIMIT,
          sort: group.sortField,
          order: 'desc'
        })
      });

      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      // Retry transient upstream errors to avoid aborting whole runs.
      if (response.status >= 500 && attempt < HTTP_RETRY_ATTEMPTS) {
        await waitForMs(HTTP_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        lastModified: toIsoOrNull(response.headers.get('last-modified')),
        json,
        text
      };
    } catch (error) {
      const message = stringifyError(error);
      if (attempt < HTTP_RETRY_ATTEMPTS) {
        await waitForMs(HTTP_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      return {
        ok: false,
        status: 0,
        contentType: null,
        etag: null,
        lastModified: null,
        json: { error: message },
        text: message
      };
    }
  }

  return {
    ok: false,
    status: 0,
    contentType: null,
    etag: null,
    lastModified: null,
    json: { error: 'usaspending_request_retry_exhausted' },
    text: 'usaspending_request_retry_exhausted'
  };
}

function extractAwards(
  payload: unknown,
  options: {
    scope: ProgramScope;
    groupName: string;
    keyword: string;
  }
): AwardRecord[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows = Array.isArray((payload as any).results) ? (payload as any).results : [];

  return rows.map((row: any, index: number) => {
    const sourceRow = safeRecord(row);
    const sourceColumns = Object.keys(sourceRow).sort();

    const description = cleanText(sourceRow.Description || sourceRow.description || '');
    const recipient = cleanText(sourceRow['Recipient Name'] || sourceRow.recipient || 'Unknown recipient');
    const awardId = cleanText(sourceRow['Award ID'] || sourceRow.generated_unique_award_id || `award-${options.groupName}-${index + 1}`);
    const amountRaw =
      sourceRow['Award Amount'] ??
      sourceRow.award_amount ??
      sourceRow['Loan Value'] ??
      sourceRow.loan_value ??
      sourceRow['Subsidy Cost'] ??
      sourceRow.subsidy_cost;
    const amount = finiteNumberOrNull(amountRaw);
    const dateRaw =
      sourceRow['Start Date'] ||
      sourceRow.period_of_performance_start_date ||
      sourceRow['Issued Date'] ||
      sourceRow.issued_date ||
      sourceRow['Base Obligation Date'] ||
      sourceRow.base_obligation_date ||
      null;
    const date = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : null;

    const internalId = finiteNumberOrNull(sourceRow.internal_id);
    const generatedAwardId = cleanText(sourceRow.generated_internal_id || sourceRow.generated_unique_award_id || '');
    const title = description || awardId;

    const awardApiUrl = internalId != null ? `https://api.usaspending.gov/api/v2/awards/${Math.trunc(internalId)}/` : null;
    const awardPageUrl = generatedAwardId ? `https://www.usaspending.gov/award/${encodeURIComponent(generatedAwardId)}/` : null;
    const awardSearchUrl = `https://www.usaspending.gov/search/?hash=${encodeURIComponent(awardId)}`;
    const sourceUrl = awardPageUrl || awardSearchUrl || ARTEMIS_SOURCE_URLS.usaspendingAwardSearch;
    const sourceTitle = awardPageUrl ? 'USASpending award record' : awardApiUrl ? 'USASpending award API record' : 'USASpending award result';

    const missionKey = options.scope === 'artemis' ? classifyMissionKey(`${title} ${options.keyword}`) : 'program';

    return {
      id: awardId,
      title,
      recipient,
      amount,
      date,
      scope: options.scope,
      missionKey,
      metadata: {
        queryGroup: options.groupName,
        queryGroups: [options.groupName],
        awardFamily: queryGroupToAwardFamily(options.groupName),
        keyword: options.keyword,
        keywords: [options.keyword],
        programScope: options.scope,
        programScopes: [options.scope],
        description: description || null,
        detail: description || null,
        awardApiUrl,
        awardPageUrl,
        sourceTitle,
        sourceUrl,
        internalId: internalId != null ? Math.trunc(internalId) : null,
        generatedAwardId: generatedAwardId || null,
        sourceColumns,
        sourceFieldCount: sourceColumns.length,
        sourceRow
      }
    };
  });
}

function classifyMissionKey(text: string): MissionKey {
  const value = text.toLowerCase();
  if (/\bartemis\s*(vii|7)\b/.test(value)) return 'artemis-vii';
  if (/\bartemis\s*(vi|6)\b/.test(value)) return 'artemis-vi';
  if (/\bartemis\s*(v|5)\b/.test(value)) return 'artemis-v';
  if (/\bartemis\s*(iv|4)\b/.test(value)) return 'artemis-iv';
  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
  return 'program';
}

function extractApiError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const message = (payload as any).message;
  if (typeof message === 'string' && message.trim().length) return message.trim();
  const detail = (payload as any).error;
  if (typeof detail === 'string' && detail.trim().length) return detail.trim();
  return null;
}

function responseHasNextPage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const metadata = (payload as any).page_metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as any).hasNext);
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

async function waitForMs(ms: number) {
  const duration = Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;
  if (duration <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, duration));
}

async function readPositiveIntegerSetting(
  supabase: any,
  key: string,
  fallback: number,
  min: number,
  max: number
) {
  try {
    const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
    if (error) return fallback;
    const value = data?.value;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
  } catch {
    return fallback;
  }
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function finiteNumberOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function awardDedupeKey(award: AwardRecord) {
  return `${award.id}|${missionKeyForStorage(award)}`;
}

function missionKeyForStorage(award: AwardRecord): MissionKey {
  return award.scope === 'artemis' ? award.missionKey : 'program';
}

function highestStatus(summaries: QuerySummary[]) {
  if (!summaries.length) return null;
  return summaries.reduce((highest, summary) => Math.max(highest, summary.status), 0);
}

function mergeAwardRecords(existing: AwardRecord, incoming: AwardRecord): AwardRecord {
  const existingAmount = Number(existing.amount || 0);
  const incomingAmount = Number(incoming.amount || 0);
  const preferIncoming = incomingAmount > existingAmount;
  const primary = preferIncoming ? incoming : existing;
  const secondary = preferIncoming ? existing : incoming;

  const mergedScopes = mergeProgramScopes(
    primary.scope,
    secondary.scope,
    primary.metadata['programScope'],
    secondary.metadata['programScope'],
    primary.metadata['programScopes'],
    secondary.metadata['programScopes']
  );

  const mergedKeywords = unionStringArrays(primary.metadata['keywords'], secondary.metadata['keywords'], [
    primary.metadata['keyword'],
    secondary.metadata['keyword']
  ]);
  const mergedGroups = unionStringArrays(primary.metadata['queryGroups'], secondary.metadata['queryGroups'], [
    primary.metadata['queryGroup'],
    secondary.metadata['queryGroup']
  ]);

  const mergedSourceColumns = unionStringArrays(primary.metadata['sourceColumns'], secondary.metadata['sourceColumns']);
  const mergedSourceRow = {
    ...safeRecord(secondary.metadata['sourceRow']),
    ...safeRecord(primary.metadata['sourceRow'])
  };
  const mergedScope = pickPrimaryProgramScope(mergedScopes) || primary.scope;
  const mergedAwardFamily = resolveMergedAwardFamily(
    primary.metadata['awardFamily'],
    secondary.metadata['awardFamily'],
    ...mergedGroups
  );

  return {
    ...primary,
    scope: mergedScope,
    missionKey: mergeMissionKey(primary.missionKey, secondary.missionKey),
    metadata: {
      ...secondary.metadata,
      ...primary.metadata,
      programScope: mergedScope,
      programScopes: mergedScopes,
      keywords: mergedKeywords,
      queryGroups: mergedGroups,
      awardFamily: mergedAwardFamily,
      sourceColumns: mergedSourceColumns,
      sourceFieldCount: mergedSourceColumns.length,
      sourceRow: mergedSourceRow
    }
  };
}

function mergeMissionKey(primary: MissionKey, secondary: MissionKey): MissionKey {
  if (primary !== 'program') return primary;
  if (secondary !== 'program') return secondary;
  return 'program';
}

function unionStringArrays(...values: unknown[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) set.add(entry.trim());
      }
      continue;
    }
    if (typeof value === 'string' && value.trim()) set.add(value.trim());
  }
  return [...set.values()];
}

function queryGroupToAwardFamily(value: unknown) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (
    normalized === 'contracts' ||
    normalized === 'idvs' ||
    normalized === 'grants' ||
    normalized === 'loans' ||
    normalized === 'direct_payments' ||
    normalized === 'other_financial_assistance'
  ) {
    return normalized;
  }
  return 'unknown';
}

function resolveMergedAwardFamily(...values: unknown[]) {
  for (const value of values) {
    const normalized = queryGroupToAwardFamily(typeof value === 'string' ? value : null);
    if (normalized !== 'unknown') return normalized;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const fromEntry = queryGroupToAwardFamily(typeof entry === 'string' ? entry : null);
        if (fromEntry !== 'unknown') return fromEntry;
      }
    }
  }
  return 'unknown';
}

function normalizeProgramScope(value: unknown): ProgramScope | null {
  return normalizeHubAuditProgramScope(value);
}

function mergeProgramScopes(...values: unknown[]): ProgramScope[] {
  const set = new Set<ProgramScope>();
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = normalizeProgramScope(item);
        if (normalized) set.add(normalized);
      }
      continue;
    }
    const normalized = normalizeProgramScope(value);
    if (normalized) set.add(normalized);
  }
  return [...set.values()].sort((a, b) => scopePriority(a) - scopePriority(b));
}

function pickPrimaryProgramScope(scopes: ProgramScope[]) {
  return scopes.slice().sort((a, b) => scopePriority(a) - scopePriority(b))[0] || null;
}

function scopePriority(scope: ProgramScope) {
  if (scope === 'artemis') return 1;
  if (scope === 'blue-origin') return 2;
  return 3;
}

function primaryProgramScopeFromMetadata(metadata: Record<string, unknown>) {
  const scopes = readHubAuditProgramScopes(metadata, null);
  return pickPrimaryProgramScope(scopes);
}

function extractProgramScopes(metadata: Record<string, unknown>) {
  return readHubAuditProgramScopes(metadata, null);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunkSize = Math.max(1, Math.trunc(size));
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

function filterAwardsForArtemisProgram(awards: AwardRecord[]) {
  const kept: AwardRecord[] = [];
  const excluded: Array<{ awardId: string; title: string; amount: number | null; keywords: string[]; reason: string }> = [];

  for (const award of awards) {
    const classification = classifyAwardForScope(award, 'artemis');
    if (classification.tier === 'excluded') {
      excluded.push({
        awardId: award.id,
        title: award.title.slice(0, 140),
        amount: award.amount,
        keywords: unionStringArrays(award.metadata['keywords'], award.metadata['keyword']),
        reason: classification.reasonCodes[0] || 'excluded'
      });
      continue;
    }

    kept.push({
      ...award,
      metadata: {
        ...award.metadata,
        relevanceScore: classification.score,
        relevanceSignals: classification.signals,
        relevanceTier: classification.tier,
        relevanceReasonCodes: classification.reasonCodes
      }
    });
  }

  return { kept, excluded };
}

function filterAwardsForCompanyScope(awards: AwardRecord[], scope: ProgramScope) {
  const kept: AwardRecord[] = [];
  const excluded: Array<{ awardId: string; title: string; amount: number | null; keywords: string[]; reason: string }> = [];

  for (const award of awards) {
    const classification = classifyAwardForScope(award, scope);
    if (classification.tier !== 'exact') {
      excluded.push({
        awardId: award.id,
        title: award.title.slice(0, 140),
        amount: award.amount,
        keywords: unionStringArrays(award.metadata['keywords'], award.metadata['keyword']),
        reason: classification.reasonCodes[0] || 'excluded'
      });
      continue;
    }

    kept.push({
      ...award,
      metadata: {
        ...award.metadata,
        relevanceScore: classification.score,
        relevanceSignals: classification.signals,
        relevanceTier: classification.tier,
        relevanceReasonCodes: classification.reasonCodes
      }
    });
  }

  return { kept, excluded };
}

function classifyAwardForScope(award: AwardRecord, scope: ProgramScope) {
  const input: UsaSpendingAwardAuditInput = {
    awardId: award.id,
    title: award.title,
    recipient: award.recipient,
    awardedOn: award.date,
    metadata: award.metadata
  };
  return classifyUsaspendingAwardForScope(input, scope);
}
