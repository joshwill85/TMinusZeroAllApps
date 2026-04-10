import { cache } from 'react';
import { buildContractStoryPresentation } from '@/lib/server/contractStoryPresentation';
import {
  buildStoryLookupMapKey,
  fetchContractStorySummariesByAwards
} from '@/lib/server/programContractStories';
import { fetchProgramContractDiscoveryPage } from '@/lib/server/programContractDiscovery';
import { fetchProgramContractLeadCountsBySeeds } from '@/lib/server/programContractDiscovery';
import { fetchProgramContractSourceCountsByStoryKeys } from '@/lib/server/programContractSourceLinks';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import type {
  ContractStoryDiscoveryItem,
  ContractStoryPresentation,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import { classifyUsaspendingAwardForScope } from '@/lib/usaspending/hubAudit';
import { buildArtemisBudgetIdentityKey, buildArtemisProcurementIdentityKey } from '@/lib/utils/artemisDedupe';
import { normalizeUsaspendingPublicUrl, resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

type BudgetLineRow = {
  fiscal_year: number | null;
  agency: string | null;
  program: string | null;
  line_item: string | null;
  amount_requested: number | null;
  amount_enacted: number | null;
  announced_time: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ProcurementRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  source_document_id: string | null;
  program_scope?: string | null;
  scope_tier?: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type SourceDocumentRow = {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  fetched_at: string | null;
  published_at: string | null;
};

export type ArtemisProgramBudgetLine = {
  fiscalYear: number | null;
  agency: string | null;
  program: string | null;
  lineItem: string | null;
  amountRequested: number | null;
  amountEnacted: number | null;
  announcedTime: string | null;
  detail: string | null;
  sourceClass: string | null;
  amountType: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
};

export type ArtemisProgramProcurementAward = {
  awardId: string | null;
  title: string | null;
  recipient: string | null;
  obligatedAmount: number | null;
  awardedOn: string | null;
  awardFamily:
    | 'contracts'
    | 'idvs'
    | 'grants'
    | 'loans'
    | 'direct_payments'
    | 'other_financial_assistance'
    | 'unknown';
  missionKey: string | null;
  contractKey?: string | null;
  solicitationId?: string | null;
  modificationCount?: number | null;
  detail: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  contractStory: ContractStorySummary | null;
  storyPresentation: ContractStoryPresentation;
};

export type ArtemisProgramIntel = {
  generatedAt: string;
  budgetLines: ArtemisProgramBudgetLine[];
  procurementAwards: ArtemisProgramProcurementAward[];
  discoveryItems: ContractStoryDiscoveryItem[];
  lastBudgetRefresh: string | null;
  lastProcurementRefresh: string | null;
};

const MAX_BUDGET_LINES = 1000;
const MAX_PROCUREMENT_AWARDS = 25_000;
const PROCUREMENT_BATCH_SIZE = 1000;

export const fetchArtemisProgramIntel = cache(async (): Promise<ArtemisProgramIntel> => {
  const generatedAt = new Date().toISOString();
  if (!isSupabaseConfigured()) {
    return {
      generatedAt,
      budgetLines: [],
      procurementAwards: [],
      discoveryItems: [],
      lastBudgetRefresh: null,
      lastProcurementRefresh: null
    };
  }

  const supabase = createSupabasePublicClient();
  const discoveryPagePromise = fetchProgramContractDiscoveryPage('artemis', { limit: 8 }).catch((error) => {
    console.error('artemis discovery query error', error);
    return {
      items: [] as ContractStoryDiscoveryItem[],
      total: 0,
      limit: 8,
      offset: 0,
      hasMore: false
    };
  });

  const [budgetRes, procurementCacheRes, discoveryPage] = await Promise.all([
    supabase
      .from('artemis_budget_lines')
      .select('fiscal_year,agency,program,line_item,amount_requested,amount_enacted,announced_time,source_document_id,metadata,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('announced_time', { ascending: false, nullsFirst: false })
      .order('fiscal_year', { ascending: false, nullsFirst: false })
      .limit(1000),
    fetchProcurementCacheRows(supabase, MAX_PROCUREMENT_AWARDS),
    discoveryPagePromise
  ]);

  let procurementRowsRaw: ProcurementRow[] = [];
  let procurementError = procurementCacheRes.error;

  if (procurementCacheRes.error) {
    console.error('artemis procurement cache query error', procurementCacheRes.error);
  }

  if (procurementCacheRes.data.length > 0) {
    procurementRowsRaw = procurementCacheRes.data;
    procurementError = null;
  } else {
    const latestProcurementSourceDocumentId = await fetchLatestProcurementSourceDocumentId(supabase);
    const procurementLegacyRes = await fetchProcurementRows(supabase, {
      latestSourceDocumentId: latestProcurementSourceDocumentId,
      limit: MAX_PROCUREMENT_AWARDS
    });
    procurementError = procurementLegacyRes.error;
    procurementRowsRaw = procurementLegacyRes.error
      ? []
      : procurementLegacyRes.data.filter((row) => isExactArtemisProcurementRow(row));
  }

  if (budgetRes.error || procurementError) {
    console.error('artemis program intel query error', {
      budget: budgetRes.error,
      procurement: procurementError
    });
    return {
      generatedAt,
      budgetLines: [],
      procurementAwards: [],
      discoveryItems: discoveryPage.items,
      lastBudgetRefresh: null,
      lastProcurementRefresh: null
    };
  }

  const budgetRowsRaw = (budgetRes.data || []) as BudgetLineRow[];

  const budgetRows = dedupeByKey(
    budgetRowsRaw,
    (row) =>
      buildArtemisBudgetIdentityKey({
        fiscalYear: row.fiscal_year,
        agency: row.agency,
        program: row.program,
        lineItem: row.line_item,
        amountRequested: coerceFiniteNumber(row.amount_requested),
        amountEnacted: coerceFiniteNumber(row.amount_enacted),
        announcedTime: row.announced_time,
        sourceDocumentId: row.source_document_id,
        sourceClass: metadataString(row.metadata, 'sourceClass'),
        amountType: metadataString(row.metadata, 'amountType'),
        sourceUrl: metadataString(row.metadata, 'sourceUrl'),
        sourceTitle: metadataString(row.metadata, 'sourceTitle'),
        detail: metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'snippet')
      })
  );
  const procurementRows = dedupeByKey(
    procurementRowsRaw,
    (row) =>
      buildArtemisProcurementIdentityKey({
        awardId: metadataString(row.metadata, 'contractKey') || row.usaspending_award_id,
        title: row.award_title,
        recipient: row.recipient,
        obligatedAmount: coerceFiniteNumber(row.obligated_amount),
        awardedOn: row.awarded_on,
        missionKey: row.mission_key,
        sourceDocumentId: row.source_document_id,
        sourceUrl: resolveUsaspendingAwardSourceUrl({
          awardId: row.usaspending_award_id,
          awardApiUrl: metadataString(row.metadata, 'awardApiUrl'),
          awardPageUrl: metadataString(row.metadata, 'awardPageUrl'),
          sourceUrl: metadataString(row.metadata, 'sourceUrl')
        }),
        sourceTitle: metadataString(row.metadata, 'sourceTitle'),
        detail: metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'description')
      })
  );
  const sourceDocIds = [
    ...new Set(
      [...budgetRows, ...procurementRows]
        .map((row) => row.source_document_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  ];

  const sourceDocsById = new Map<string, SourceDocumentRow>();
  if (sourceDocIds.length > 0) {
    const { data: docs, error: docsError } = await supabase
      .from('artemis_source_documents')
      .select('id,url,title,source_type,fetched_at,published_at')
      .in('id', sourceDocIds)
      .limit(200);

    if (docsError) {
      console.error('artemis program source docs query error', docsError);
    } else {
      for (const doc of (docs || []) as SourceDocumentRow[]) {
        sourceDocsById.set(doc.id, doc);
      }
    }
  }

  const budgetLines = budgetRows.slice(0, MAX_BUDGET_LINES).map((row) => {
    const sourceDoc = row.source_document_id ? sourceDocsById.get(row.source_document_id) : null;
    const detail = metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'snippet');
    const sourceClass = metadataString(row.metadata, 'sourceClass');
    const amountType = metadataString(row.metadata, 'amountType');
    const metadataSourceUrl = metadataString(row.metadata, 'sourceUrl');
    const metadataSourceTitle = metadataString(row.metadata, 'sourceTitle');
    return {
      fiscalYear: row.fiscal_year ?? null,
      agency: row.agency ?? null,
      program: row.program ?? null,
      lineItem: row.line_item ?? null,
      amountRequested: coerceFiniteNumber(row.amount_requested),
      amountEnacted: coerceFiniteNumber(row.amount_enacted),
      announcedTime: row.announced_time ?? null,
      detail,
      sourceClass,
      amountType,
      sourceUrl: normalizeUsaspendingPublicUrl(
        metadataSourceUrl || sourceDoc?.url || null
      ),
      sourceTitle: metadataSourceTitle || sourceDoc?.title || null
    } satisfies ArtemisProgramBudgetLine;
  });

  const procurementAwardsBase = procurementRows.slice(0, MAX_PROCUREMENT_AWARDS).map((row) => {
    const sourceDoc = row.source_document_id ? sourceDocsById.get(row.source_document_id) : null;
    const awardApiUrl = metadataString(row.metadata, 'awardApiUrl');
    const awardPageUrl = metadataString(row.metadata, 'awardPageUrl');
    const metadataSourceUrl = metadataString(row.metadata, 'sourceUrl');
    const metadataSourceTitle = metadataString(row.metadata, 'sourceTitle');
    const detail = metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'description');
    const contractKey = metadataString(row.metadata, 'contractKey');
    const solicitationId = metadataString(row.metadata, 'solicitationId');
    const modificationCount = coerceFiniteNumber((row.metadata || {})['actionCount']);
    const awardFamily = resolveProcurementAwardFamily(row.metadata);
    return {
      awardId: row.usaspending_award_id ?? null,
      title: row.award_title ?? null,
      recipient: row.recipient ?? null,
      obligatedAmount: coerceFiniteNumber(row.obligated_amount),
      awardedOn: row.awarded_on ?? null,
      awardFamily,
      missionKey: row.mission_key ?? null,
      contractKey,
      solicitationId,
      modificationCount,
      detail,
      sourceUrl: resolveUsaspendingAwardSourceUrl({
        awardId: row.usaspending_award_id,
        awardApiUrl,
        awardPageUrl,
        sourceUrl: metadataSourceUrl || sourceDoc?.url || null
      }),
      sourceTitle: metadataSourceTitle || sourceDoc?.title || null,
      contractStory: null,
      storyPresentation: buildContractStoryPresentation({
        scope: 'artemis',
        story: null,
        leadCount: 0,
        fallbackContractKey: contractKey || row.usaspending_award_id
      })
    } satisfies ArtemisProgramProcurementAward;
  });

  const procurementStorySeeds = procurementAwardsBase.map((award) => ({
    awardId: award.awardId,
    piid: null,
    contractKey: award.contractKey,
    solicitationId: award.solicitationId,
    noticeId: null,
    sourceUrl: award.sourceUrl,
    metadata: {
      awardId: award.awardId,
      contractKey: award.contractKey,
      solicitationId: award.solicitationId
    }
  }));
  const procurementStoryMap = await fetchContractStorySummariesByAwards(
    'artemis',
    procurementStorySeeds
  );
  const procurementLeadCounts = await fetchProgramContractLeadCountsBySeeds(
    'artemis',
    procurementStorySeeds
  );
  const procurementExactSourceCounts = await fetchProgramContractSourceCountsByStoryKeys(
    [...new Set([...procurementStoryMap.values()].map((story) => story.storyKey).filter(Boolean))]
  );
  const procurementAwards = procurementAwardsBase.map((award, index) => {
    const key = buildStoryLookupMapKey(procurementStorySeeds[index]);
    const story = key ? procurementStoryMap.get(key) || null : null;
    const leadCount = key ? procurementLeadCounts.get(key) || 0 : 0;
    const exactSourceCount = story
      ? procurementExactSourceCounts.get(story.storyKey) || 0
      : 0;
    return {
      ...award,
      contractStory: story,
      storyPresentation: buildContractStoryPresentation({
        scope: 'artemis',
        story,
        leadCount,
        exactSourceCount,
        fallbackContractKey: award.contractKey || award.awardId || null
      })
    } satisfies ArtemisProgramProcurementAward;
  });

  const lastBudgetRefresh =
    budgetRows
      .map((row) => row.updated_at)
      .find((value): value is string => typeof value === 'string' && value.length > 0) || null;
  const lastProcurementRefresh =
    procurementRows
      .map((row) => row.updated_at)
      .find((value): value is string => typeof value === 'string' && value.length > 0) || null;

  return {
    generatedAt,
    budgetLines,
    procurementAwards,
    discoveryItems: discoveryPage.items,
    lastBudgetRefresh,
    lastProcurementRefresh
  };
});

type PagedRowResult<T> = {
  data: T[];
  error: unknown | null;
};

async function fetchProcurementRows(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  options: { latestSourceDocumentId: string | null; limit: number }
): Promise<PagedRowResult<ProcurementRow>> {
  const auditedRes = await supabase
    .from('program_usaspending_audited_awards')
    .select(
      'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,program_scope,scope_tier,metadata,updated_at'
    )
    .eq('program_scope', 'artemis')
    .eq('scope_tier', 'exact')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('obligated_amount', { ascending: false, nullsFirst: false })
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(options.limit);

  if (!auditedRes.error && (auditedRes.data || []).length > 0) {
    return {
      data: (auditedRes.data || []) as ProcurementRow[],
      error: null
    };
  }

  const rows: ProcurementRow[] = [];
  let from = 0;

  while (rows.length < options.limit) {
    const batchSize = Math.min(PROCUREMENT_BATCH_SIZE, options.limit - rows.length);
    const to = from + batchSize - 1;
    let query = supabase
      .from('artemis_procurement_awards')
      .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,metadata,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('obligated_amount', { ascending: false, nullsFirst: false })
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('usaspending_award_id', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (options.latestSourceDocumentId) {
      query = query.eq('source_document_id', options.latestSourceDocumentId);
    }

    const { data, error } = await query;
    if (error) return { data: [], error };
    const chunk = (data || []) as ProcurementRow[];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < batchSize) break;
    from += batchSize;
  }

  return {
    data: rows.slice(0, options.limit),
    error: null
  };
}

async function fetchProcurementCacheRows(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  limit: number
): Promise<PagedRowResult<ProcurementRow>> {
  const rows: ProcurementRow[] = [];
  let from = 0;

  while (rows.length < limit) {
    const batchSize = Math.min(PROCUREMENT_BATCH_SIZE, limit - rows.length);
    const to = from + batchSize - 1;
    const { data, error } = await supabase
      .from('artemis_program_procurement_cache')
      .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,metadata,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('contract_key', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) return { data: [], error };
    const chunk = (data || []) as ProcurementRow[];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < batchSize) break;
    from += batchSize;
  }

  return {
    data: rows.slice(0, limit),
    error: null
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  if (!metadata) return null;
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function metadataStringArray(metadata: Record<string, unknown> | null | undefined, key: string) {
  if (!metadata) return [];
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
}

function isExactArtemisProcurementRow(row: ProcurementRow) {
  const classification = classifyUsaspendingAwardForScope(
    {
      awardId: row.usaspending_award_id,
      title: row.award_title,
      recipient: row.recipient,
      awardedOn: row.awarded_on,
      metadata: row.metadata
    },
    'artemis'
  );
  return classification.tier === 'exact';
}

function resolveProcurementAwardFamily(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return 'unknown';

  const direct = normalizeProcurementAwardFamily(
    metadataString(metadata, 'awardFamily') || metadataString(metadata, 'award_family')
  );
  if (direct !== 'unknown') return direct;

  const groups = metadataStringArray(metadata, 'queryGroups');
  const primaryGroup = metadataString(metadata, 'queryGroup');
  const candidates = primaryGroup ? [primaryGroup, ...groups] : groups;
  for (const candidate of candidates) {
    const normalized = normalizeProcurementAwardFamily(candidate);
    if (normalized !== 'unknown') return normalized;
  }

  const sourceRow =
    metadata.sourceRow && typeof metadata.sourceRow === 'object' && !Array.isArray(metadata.sourceRow)
      ? (metadata.sourceRow as Record<string, unknown>)
      : null;
  if (!sourceRow) return 'unknown';

  const awardTypeText = [
    stringOrNull(sourceRow['Award Type']),
    stringOrNull(sourceRow.award_type),
    stringOrNull(sourceRow.awardType),
    stringOrNull(sourceRow['Contract Award Type']),
    stringOrNull(sourceRow.contract_award_type),
    stringOrNull(sourceRow.contractAwardType)
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (!awardTypeText) return 'unknown';
  if (awardTypeText.includes('direct payment')) return 'direct_payments';
  if (awardTypeText.includes('loan') || awardTypeText.includes('guaranteed/insured')) return 'loans';
  if (awardTypeText.includes('grant') || awardTypeText.includes('cooperative agreement')) return 'grants';
  if (
    awardTypeText.includes('insurance') ||
    awardTypeText.includes('indemnity') ||
    awardTypeText.includes('other financial assistance')
  ) {
    return 'other_financial_assistance';
  }
  if (
    awardTypeText.includes('indefinite delivery') ||
    awardTypeText.includes('gwac') ||
    awardTypeText.includes('fss') ||
    awardTypeText.includes('boa') ||
    awardTypeText.includes('bpa')
  ) {
    return 'idvs';
  }
  if (
    awardTypeText.includes('contract') ||
    awardTypeText.includes('delivery order') ||
    awardTypeText.includes('purchase order')
  ) {
    return 'contracts';
  }
  return 'unknown';
}

function normalizeProcurementAwardFamily(value: string | null) {
  if (!value) return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'contracts') return 'contracts';
  if (normalized === 'idvs') return 'idvs';
  if (normalized === 'grants') return 'grants';
  if (normalized === 'loans') return 'loans';
  if (normalized === 'direct_payments' || normalized === 'direct-payments' || normalized === 'direct payments') {
    return 'direct_payments';
  }
  if (
    normalized === 'other_financial_assistance' ||
    normalized === 'other-financial-assistance' ||
    normalized === 'other financial assistance' ||
    normalized === 'other'
  ) {
    return 'other_financial_assistance';
  }
  return 'unknown';
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeByKey<T>(rows: T[], keyFn: (row: T) => string) {
  const deduped = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

async function fetchLatestProcurementSourceDocumentId(supabase: ReturnType<typeof createSupabasePublicClient>) {
  const { data, error } = await supabase
    .from('artemis_procurement_awards')
    .select('source_document_id,updated_at')
    .not('source_document_id', 'is', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('artemis procurement latest source document lookup error', error);
    return null;
  }

  return typeof data?.source_document_id === 'string' && data.source_document_id.length > 0 ? data.source_document_id : null;
}
