import { cache } from 'react';
import { buildContractStoryPresentation } from '@/lib/server/contractStoryPresentation';
import { fetchProgramContractLeadCountsBySeeds } from '@/lib/server/programContractDiscovery';
import { isSupabaseConfigured } from '@/lib/server/env';
import {
  buildStoryLookupMapKey,
  fetchContractStorySummariesByAwards
} from '@/lib/server/programContractStories';
import { fetchProgramContractSourceCountsByStoryKeys } from '@/lib/server/programContractSourceLinks';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ContractStoryPresentation,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import {
  classifyUsaspendingAwardForScope,
  normalizeProgramScope as normalizeHubAuditProgramScope,
  readProgramScopes as readHubAuditProgramScopes
} from '@/lib/usaspending/hubAudit';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

export type ProcurementProgramScope = 'artemis' | 'blue-origin' | 'spacex';
export type ProgramUsaspendingAwardFamily =
  | 'contracts'
  | 'idvs'
  | 'grants'
  | 'loans'
  | 'direct_payments'
  | 'other_financial_assistance'
  | 'unknown';

type ProcurementAwardRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  program_scope?: string | null;
  scope_tier?: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

export type ProgramUsaspendingAward = {
  awardId: string | null;
  title: string | null;
  recipient: string | null;
  obligatedAmount: number | null;
  awardedOn: string | null;
  awardFamily: ProgramUsaspendingAwardFamily;
  missionKey: string | null;
  programScope: ProcurementProgramScope | null;
  programScopes: ProcurementProgramScope[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceFieldCount: number;
  sourceColumns: string[];
  detail: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
  contractStory: ContractStorySummary | null;
  storyPresentation: ContractStoryPresentation;
};

export type ProgramUsaspendingAwardSummary = {
  awardId: string | null;
  title: string | null;
  recipient: string | null;
  obligatedAmount: number | null;
  awardedOn: string | null;
  awardFamily: ProgramUsaspendingAwardFamily;
  missionKey: string | null;
  programScope: ProcurementProgramScope | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceFieldCount: number;
  updatedAt: string | null;
  contractStory: ContractStorySummary | null;
  storyPresentation: ContractStoryPresentation;
};

export type ProgramUsaspendingAwardPage = {
  items: ProgramUsaspendingAwardSummary[];
  total: number | null;
  offset: number;
  limit: number;
  hasMore: boolean;
};

const DEFAULT_LIMIT = 240;
const MAX_LIMIT = 50_000;
const FALLBACK_LIMIT_MULTIPLIER = 8;
const SCOPED_QUERY_BATCH_SIZE = 1000;
const MAX_SCOPED_SCAN_ROWS = 100_000;
const FALLBACK_SCAN_BATCH_SIZE = 500;
const MAX_FALLBACK_SCAN_ROWS = 100_000;
const DEFAULT_PAGE_LIMIT = 80;
const MAX_PAGE_LIMIT = 500;
const AUDITED_SELECT =
  'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,program_scope,scope_tier,metadata,updated_at';
const RAW_SELECT =
  'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,program_scope,metadata,updated_at';

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export const fetchProgramUsaspendingAwards = withCache(
  async (
    scope: ProcurementProgramScope,
    limit = DEFAULT_LIMIT
  ): Promise<ProgramUsaspendingAward[]> => {
    if (!isSupabaseConfigured()) return [];

    const supabase = createSupabasePublicClient();
    const requestedLimit = clampIntValue(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const scopedResult = await queryAuditedScopedRows(supabase, scope, requestedLimit);
    if (scopedResult.error) {
      console.error(
        'usaspending audited procurement query error',
        scopedResult.error
      );
    }

    const rawRows =
      scopedResult.rows.length > 0
        ? scopedResult.rows
        : await queryLegacyScopeRows(
            supabase,
            scope,
            clampIntValue(
              requestedLimit * FALLBACK_LIMIT_MULTIPLIER,
              requestedLimit,
              requestedLimit,
              MAX_LIMIT
            )
          );

    if (!rawRows.length) return [];

    const mapped = rawRows
      .map<ProgramUsaspendingAward | null>((row) =>
        mapUsaspendingRow(row, scope)
      )
      .filter((row): row is ProgramUsaspendingAward => Boolean(row));

    const deduped = dedupeByKey(
      mapped,
      (row) =>
        `${row.awardId || ''}|${row.missionKey || ''}|${row.programScope || ''}`
    );
    return attachContractStorySummaries(scope, deduped);
  }
);

export async function fetchProgramUsaspendingAwardsPage(
  scope: ProcurementProgramScope,
  options?: { limit?: number; offset?: number }
): Promise<ProgramUsaspendingAwardPage> {
  if (!isSupabaseConfigured()) {
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: clampIntValue(options?.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
      hasMore: false
    };
  }

  const supabase = createSupabasePublicClient();
  const limit = clampIntValue(options?.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
  const offset = clampIntValue(options?.offset ?? 0, 0, 0, MAX_SCOPED_SCAN_ROWS);
  const auditedPage = await queryAuditedScopedPage(supabase, scope, { limit, offset });
  if (auditedPage.error) {
    console.error(
      'usaspending paged audited query error',
      auditedPage.error
    );
  }

  const rows =
    auditedPage.rows.length > 0
      ? auditedPage.rows
      : (await queryLegacyScopeRows(supabase, scope, offset + limit)).slice(offset, offset + limit);

  const mapped = dedupeByKey(
    rows
      .map<ProgramUsaspendingAward | null>((row) =>
        mapUsaspendingRow(row, scope)
      )
      .filter((row): row is ProgramUsaspendingAward => Boolean(row)),
    (row) => `${row.awardId || ''}|${row.missionKey || ''}|${row.programScope || ''}`
  );

  const enriched = await attachContractStorySummaries(scope, mapped);
  const summaryItems = enriched.map(toProgramUsaspendingAwardSummary);

  const total = auditedPage.rows.length > 0 ? auditedPage.total : null;
  const hasMore =
    total != null
      ? offset + mapped.length < total
      : summaryItems.length === limit;

  return {
    items: summaryItems,
    total,
    offset,
    limit,
    hasMore
  };
}

async function queryAuditedScopedRows(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  scope: ProcurementProgramScope,
  limit: number
) {
  const scopedLimit = clampIntValue(limit, limit, 1, MAX_LIMIT);

  const rows: ProcurementAwardRow[] = [];
  let from = 0;

  while (rows.length < scopedLimit && from < MAX_SCOPED_SCAN_ROWS) {
    const batchSize = Math.min(
      SCOPED_QUERY_BATCH_SIZE,
      scopedLimit - rows.length
    );
    const to = from + batchSize - 1;
    const scopedRes = await supabase
      .from('program_usaspending_audited_awards')
      .select(AUDITED_SELECT)
      .eq('program_scope', scope)
      .eq('scope_tier', 'exact')
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('usaspending_award_id', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (scopedRes.error) {
      return {
        rows: [] as ProcurementAwardRow[],
        error: isMissingAuditedAwardsRelationError(scopedRes.error.message)
          ? null
          : scopedRes.error
      };
    }

    const chunk = (scopedRes.data || []) as ProcurementAwardRow[];
    if (!chunk.length) break;
    rows.push(...chunk);

    if (chunk.length < batchSize) break;
    from += batchSize;
  }

  return {
    rows: rows.slice(0, scopedLimit),
    error: null
  };
}

async function queryAuditedScopedPage(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  scope: ProcurementProgramScope,
  options: { limit: number; offset: number }
) {
  const limit = clampIntValue(options.limit, DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
  const offset = clampIntValue(options.offset, 0, 0, MAX_SCOPED_SCAN_ROWS);
  const to = offset + limit - 1;
  const scopedRes =
    offset === 0
      ? await supabase
          .from('program_usaspending_audited_awards')
          .select(AUDITED_SELECT, { count: 'exact' })
          .eq('program_scope', scope)
          .eq('scope_tier', 'exact')
          .order('awarded_on', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false, nullsFirst: false })
          .order('usaspending_award_id', { ascending: false, nullsFirst: false })
          .range(offset, to)
      : await supabase
          .from('program_usaspending_audited_awards')
          .select(AUDITED_SELECT)
          .eq('program_scope', scope)
          .eq('scope_tier', 'exact')
          .order('awarded_on', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false, nullsFirst: false })
          .order('usaspending_award_id', { ascending: false, nullsFirst: false })
          .range(offset, to);

  if (scopedRes.error) {
    return {
      rows: [] as ProcurementAwardRow[],
      total: null as number | null,
      error: isMissingAuditedAwardsRelationError(scopedRes.error.message)
        ? null
        : scopedRes.error
    };
  }

  return {
    rows: (scopedRes.data || []) as ProcurementAwardRow[],
    total: typeof scopedRes.count === 'number' ? scopedRes.count : null,
    error: null
  };
}

async function queryLegacyScopeRows(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  scope: ProcurementProgramScope,
  limit: number
) {
  const fallbackLimit = clampIntValue(limit, limit, 1, MAX_LIMIT);

  const matchedRows: ProcurementAwardRow[] = [];
  let scanned = 0;
  let from = 0;

  while (
    matchedRows.length < fallbackLimit &&
    scanned < MAX_FALLBACK_SCAN_ROWS
  ) {
    const to = from + FALLBACK_SCAN_BATCH_SIZE - 1;
    const fallbackRes = await supabase
      .from('artemis_procurement_awards')
      .select(RAW_SELECT)
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('usaspending_award_id', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (fallbackRes.error) {
      console.error(
        'usaspending legacy procurement query error',
        fallbackRes.error
      );
      return [] as ProcurementAwardRow[];
    }

    const chunk = (fallbackRes.data || []) as ProcurementAwardRow[];
    if (!chunk.length) break;
    scanned += chunk.length;

    for (const row of chunk) {
      if (!matchesExactScope(row, scope)) continue;
      matchedRows.push(row);
      if (matchedRows.length >= fallbackLimit) break;
    }

    if (chunk.length < FALLBACK_SCAN_BATCH_SIZE) break;
    from += FALLBACK_SCAN_BATCH_SIZE;
  }

  return matchedRows.slice(0, fallbackLimit);
}

function mapUsaspendingRow(
  row: ProcurementAwardRow,
  fallbackScope: ProcurementProgramScope
) {
  const metadata = toMetadata(row.metadata);
  const awardId = asString(row.usaspending_award_id);
  const title = asString(row.award_title);
  if (!awardId && !title) return null;
  const metadataScopes = readProgramScopes(metadata, null);
  const directScope =
    normalizeProgramScope(asString(row.program_scope)) || null;
  const resolvedProgramScope = metadataScopes.includes(fallbackScope)
    ? fallbackScope
    : directScope || metadataScopes[0] || fallbackScope;
  const programScopes = readProgramScopes(metadata, resolvedProgramScope);

  const normalizedProgramScope = resolvedProgramScope;
  const sourceColumns = readStringArray(metadata.sourceColumns);
  const sourceFieldCount = resolveSourceFieldCount(
    metadata,
    sourceColumns.length
  );
  const detail = asString(metadata.detail) || asString(metadata.description);
  const awardFamily = resolveAwardFamily(metadata);
  const sourceUrl = resolveUsaspendingAwardSourceUrl({
    awardId,
    sourceUrl: asString(metadata.sourceUrl),
    awardApiUrl: asString(metadata.awardApiUrl),
    awardPageUrl: asString(metadata.awardPageUrl)
  });
  const sourceTitle =
    asString(metadata.sourceTitle) || 'USASpending award record';

  return {
    awardId,
    title,
    recipient: asString(row.recipient),
    obligatedAmount: finiteNumberOrNull(row.obligated_amount),
    awardedOn: normalizeDate(row.awarded_on),
    awardFamily,
    missionKey: asString(row.mission_key),
    programScope: normalizedProgramScope,
    programScopes,
    sourceUrl,
    sourceTitle,
    sourceFieldCount,
    sourceColumns,
    detail,
    metadata,
    updatedAt: asString(row.updated_at),
    contractStory: null,
    storyPresentation: buildContractStoryPresentation({
      scope: normalizedProgramScope,
      story: null,
      leadCount: 0,
      fallbackContractKey:
        asString(metadata.contractKey) || asString(metadata.contract_key)
    })
  } satisfies ProgramUsaspendingAward;
}

function matchesExactScope(
  row: ProcurementAwardRow,
  expected: ProcurementProgramScope
) {
  const metadata = toMetadata(row.metadata);
  const classification = classifyUsaspendingAwardForScope(
    {
      awardId: asString(row.usaspending_award_id),
      title: asString(row.award_title),
      recipient: asString(row.recipient),
      awardedOn: asString(row.awarded_on),
      metadata
    },
    expected
  );
  return classification.tier === 'exact';
}

function readProgramScopes(
  metadata: Record<string, unknown>,
  fallback: ProcurementProgramScope | null
) {
  return readHubAuditProgramScopes(metadata, fallback);
}

function mergeProcurementRows(rows: ProcurementAwardRow[]) {
  const seen = new Set<string>();
  const merged: ProcurementAwardRow[] = [];

  for (const row of rows) {
    const awardId = asString(row.usaspending_award_id) || '';
    const mission = asString(row.mission_key) || '';
    const title = asString(row.award_title) || '';
    const key = `${awardId}|${mission}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged;
}

function resolveSourceFieldCount(
  metadata: Record<string, unknown>,
  fallback: number
) {
  const numeric = finiteNumberOrNull(metadata.sourceFieldCount);
  if (numeric != null) return Math.max(0, Math.trunc(numeric));
  return Math.max(0, fallback);
}

export function toProgramUsaspendingAwardSummary(
  award: ProgramUsaspendingAward
): ProgramUsaspendingAwardSummary {
  return {
    awardId: award.awardId,
    title: award.title,
    recipient: award.recipient,
    obligatedAmount: award.obligatedAmount,
    awardedOn: award.awardedOn,
    awardFamily: award.awardFamily,
    missionKey: award.missionKey,
    programScope: award.programScope,
    sourceUrl: award.sourceUrl,
    sourceTitle: award.sourceTitle,
    sourceFieldCount: Math.max(
      award.sourceFieldCount || 0,
      Array.isArray(award.sourceColumns) ? award.sourceColumns.length : 0
    ),
    updatedAt: award.updatedAt,
    contractStory: award.contractStory,
    storyPresentation: award.storyPresentation
  };
}

async function attachContractStorySummaries(
  scope: ProcurementProgramScope,
  rows: ProgramUsaspendingAward[]
) {
  if (!rows.length) return rows;

  const seeds = rows.map((row) => ({
    awardId: row.awardId,
    piid: asString(row.metadata.piid),
    contractKey:
      asString(row.metadata.contractKey) ||
      asString(row.metadata.contract_key),
    solicitationId:
      asString(row.metadata.solicitationId) ||
      asString(row.metadata.solicitation_id),
    noticeId:
      asString(row.metadata.noticeId) || asString(row.metadata.notice_id),
    sourceUrl: row.sourceUrl,
    metadata: row.metadata
  }));

  const summaries = await fetchContractStorySummariesByAwards(scope, seeds);
  const leadCounts = await fetchProgramContractLeadCountsBySeeds(scope, seeds);
  const exactSourceCounts = await fetchProgramContractSourceCountsByStoryKeys(
    [...new Set([...summaries.values()].map((story) => story.storyKey).filter(Boolean))]
  );

  return rows.map((row, index) => {
    const key = buildStoryLookupMapKey(seeds[index]);
    const story = key ? summaries.get(key) || null : null;
    const leadCount = key ? leadCounts.get(key) || 0 : 0;
    const exactSourceCount = story ? exactSourceCounts.get(story.storyKey) || 0 : 0;
    return {
      ...row,
      contractStory: story,
      storyPresentation: buildContractStoryPresentation({
        scope,
        story,
        leadCount,
        exactSourceCount,
        fallbackContractKey:
          asString(row.metadata.contractKey) ||
          asString(row.metadata.contract_key)
      })
    };
  });
}

function resolveAwardFamily(
  metadata: Record<string, unknown>
): ProgramUsaspendingAwardFamily {
  const directFamily = normalizeAwardFamily(
    asString(metadata.awardFamily) || asString(metadata.award_family)
  );
  if (directFamily !== 'unknown') return directFamily;

  const queryGroups = readStringArray(metadata.queryGroups);
  const queryGroup = asString(metadata.queryGroup);
  const candidates = queryGroup
    ? [queryGroup, ...queryGroups]
    : queryGroups;

  for (const candidate of candidates) {
    const normalized = normalizeAwardFamily(candidate);
    if (normalized !== 'unknown') return normalized;
  }

  const sourceRow = toMetadata(metadata.sourceRow);
  const awardTypeText = [
    asString(sourceRow['Award Type']),
    asString(sourceRow.award_type),
    asString(sourceRow.awardType),
    asString(sourceRow['Contract Award Type']),
    asString(sourceRow.contract_award_type),
    asString(sourceRow.contractAwardType)
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (!awardTypeText) return 'unknown';
  if (
    awardTypeText.includes('direct payment') ||
    awardTypeText.includes('non-reimbursable direct financial aid')
  ) {
    return 'direct_payments';
  }
  if (
    awardTypeText.includes('loan') ||
    awardTypeText.includes('guaranteed/insured')
  ) {
    return 'loans';
  }
  if (
    awardTypeText.includes('grant') ||
    awardTypeText.includes('cooperative agreement')
  ) {
    return 'grants';
  }
  if (
    awardTypeText.includes('insurance') ||
    awardTypeText.includes('indemnity') ||
    awardTypeText.includes('other financial assistance')
  ) {
    return 'other_financial_assistance';
  }
  if (
    awardTypeText.includes('indefinite delivery') ||
    awardTypeText.includes('fss') ||
    awardTypeText.includes('gwac') ||
    awardTypeText.includes('boa') ||
    awardTypeText.includes('bpa')
  ) {
    return 'idvs';
  }
  if (
    awardTypeText.includes('contract') ||
    awardTypeText.includes('delivery order') ||
    awardTypeText.includes('purchase order') ||
    awardTypeText.includes('definitive')
  ) {
    return 'contracts';
  }
  return 'unknown';
}

function normalizeAwardFamily(
  value: string | null
): ProgramUsaspendingAwardFamily {
  if (!value) return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'contracts') return 'contracts';
  if (normalized === 'idvs') return 'idvs';
  if (normalized === 'grants') return 'grants';
  if (normalized === 'loans') return 'loans';
  if (
    normalized === 'direct_payments' ||
    normalized === 'direct-payments' ||
    normalized === 'direct payments'
  ) {
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

function toMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function normalizeProgramScope(
  value: string | null
): ProcurementProgramScope | null {
  return normalizeHubAuditProgramScope(value);
}

function dedupeByKey<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function asString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampIntValue(
  value: number,
  fallback: number,
  min: number,
  max: number
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isMissingAuditedAwardsRelationError(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('program_usaspending_audited_awards') ||
    normalized.includes('scope_tier')
  );
}
