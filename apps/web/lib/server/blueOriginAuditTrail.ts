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
import {
  fetchProgramUsaspendingAwards,
  type ProgramUsaspendingAwardFamily,
  type ProgramUsaspendingAward
} from '@/lib/server/usaspendingProgramAwards';
import type {
  ContractStoryPresentation,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import { resolveSamPublicUrl } from '@/lib/utils/sam';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

export type BlueOriginAuditTrailEntryType =
  | 'sam-opportunity'
  | 'sam-contract-award'
  | 'usaspending';

export type BlueOriginAuditTrailEntry = {
  id: string;
  type: BlueOriginAuditTrailEntryType;
  awardFamily?: ProgramUsaspendingAwardFamily;
  noticeId?: string;
  awardId?: string;
  title: string;
  postedDate: string;
  amount?: number | null;
  agency?: string | null;
  status?: string;
  url?: string | null;
  sourceLabel?: string;
  linkTo?: string;
  contractStory?: ContractStorySummary | null;
  storyPresentation: ContractStoryPresentation;
};

export type BlueOriginAuditTrailPage = {
  items: BlueOriginAuditTrailEntry[];
  total: number;
  limit: number;
  hasMore: boolean;
};

type SamContractAwardRow = {
  row_key: string;
  contract_key: string;
  solicitation_id: string | null;
  piid: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type SamOpportunityNoticeRow = {
  id: string;
  notice_id: string;
  solicitation_id: string | null;
  title: string | null;
  posted_date: string | null;
  awardee_name: string | null;
  award_amount: number | null;
  notice_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

const DEFAULT_LIMIT = 20_000;
const MAX_LIMIT = 50_000;
const DEFAULT_PAGE_LIMIT = 250;
const SAM_AWARD_SCAN_BATCH_SIZE = 1000;
const SAM_NOTICE_CHUNK_SIZE = 48;
const SAM_NOTICE_BATCH_SIZE = 500;

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

const fetchBlueOriginAuditTrailRawEntries = withCache(
  async (): Promise<BlueOriginAuditTrailEntry[]> => {
    const [usaspendingRows, samAwardRows] = await Promise.all([
      fetchProgramUsaspendingAwards('blue-origin', MAX_LIMIT),
      fetchBlueOriginSamContractAwardRows(MAX_LIMIT)
    ]);

    const solicitationIds = uniqueNonEmptyStrings(
      samAwardRows.map((row) => normalizeIdentifier(row.solicitation_id))
    ).slice(0, MAX_LIMIT);
    const samOpportunityRows = await fetchSamOpportunityRowsBySolicitationIds(
      solicitationIds,
      MAX_LIMIT
    );

    const usaspendingEntries = usaspendingRows.map(mapUsaspendingEntry);
    const samContractAwardEntries = samAwardRows.map(mapSamContractAwardEntry);
    const samOpportunityEntries = samOpportunityRows.map(
      mapSamOpportunityEntry
    );

    return sortEntriesByDateDesc(
      dedupeByKey(
        [
          ...usaspendingEntries,
          ...samContractAwardEntries,
          ...samOpportunityEntries
        ],
        (entry) => entry.id
      )
    );
  }
);

export const fetchBlueOriginAuditTrailEntries = withCache(
  async (limit = DEFAULT_LIMIT): Promise<BlueOriginAuditTrailEntry[]> => {
    const resolvedLimit = clampInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const entries = await fetchBlueOriginAuditTrailRawEntries();
    return attachContractStorySummaries(entries.slice(0, resolvedLimit));
  }
);

export async function fetchBlueOriginAuditTrailPage(
  limit = DEFAULT_PAGE_LIMIT
): Promise<BlueOriginAuditTrailPage> {
  const resolvedLimit = clampInt(limit, DEFAULT_PAGE_LIMIT, 1, MAX_LIMIT);
  const allEntries = await fetchBlueOriginAuditTrailRawEntries();
  const total = allEntries.length;
  const hasMore = total > resolvedLimit;
  return {
    items: await fetchBlueOriginAuditTrailEntries(resolvedLimit),
    total,
    limit: resolvedLimit,
    hasMore
  };
}

async function fetchBlueOriginSamContractAwardRows(limit: number) {
  if (!isSupabaseConfigured()) return [] as SamContractAwardRow[];

  const supabase = createSupabasePublicClient();
  const resolvedLimit = clampInt(limit, limit, 1, MAX_LIMIT);
  const rows = [] as SamContractAwardRow[];
  let from = 0;

  while (rows.length < resolvedLimit) {
    const batchSize = Math.min(
      SAM_AWARD_SCAN_BATCH_SIZE,
      resolvedLimit - rows.length
    );
    const to = from + batchSize - 1;
    const { data, error } = await supabase
      .from('artemis_sam_contract_award_rows')
      .select('row_key,contract_key,solicitation_id,piid,metadata,updated_at')
      .eq('program_scope', 'blue-origin')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) {
      console.error('blue origin sam contract award rows query error', error);
      return [] as SamContractAwardRow[];
    }

    const chunk = (data || []) as SamContractAwardRow[];
    if (!chunk.length) break;
    rows.push(...chunk);

    if (chunk.length < batchSize) break;
    from += batchSize;
  }

  return rows.slice(0, resolvedLimit);
}

async function fetchSamOpportunityRowsBySolicitationIds(
  solicitationIds: string[],
  limit: number
) {
  if (!isSupabaseConfigured() || solicitationIds.length < 1) {
    return [] as SamOpportunityNoticeRow[];
  }

  const supabase = createSupabasePublicClient();
  const rows = [] as SamOpportunityNoticeRow[];
  const dedupe = new Set<string>();
  const normalizedSolicitations = uniqueNonEmptyStrings(solicitationIds);

  for (const chunk of chunkArray(normalizedSolicitations, SAM_NOTICE_CHUNK_SIZE)) {
    if (rows.length >= limit) break;

    let from = 0;
    while (rows.length < limit) {
      const batchSize = Math.min(SAM_NOTICE_BATCH_SIZE, limit - rows.length);
      const to = from + batchSize - 1;
      const { data, error } = await supabase
        .from('artemis_opportunity_notices')
        .select(
          'id,notice_id,solicitation_id,title,posted_date,awardee_name,award_amount,notice_url,metadata,updated_at'
        )
        .in('solicitation_id', chunk)
        .order('posted_date', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) {
        console.error('blue origin sam opportunity notices query error', error);
        break;
      }

      const page = (data || []) as SamOpportunityNoticeRow[];
      if (!page.length) break;

      for (const row of page) {
        const noticeId = normalizeIdentifier(row.notice_id) || row.id;
        if (dedupe.has(noticeId)) continue;
        dedupe.add(noticeId);
        rows.push(row);
        if (rows.length >= limit) break;
      }

      if (page.length < batchSize || rows.length >= limit) break;
      from += batchSize;
    }
  }

  return rows.slice(0, limit);
}

function mapUsaspendingEntry(row: ProgramUsaspendingAward): BlueOriginAuditTrailEntry {
  const metadata = asRecord(row.metadata);
  const sourceUrl = resolveUsaspendingAwardSourceUrl({
    awardId: row.awardId,
    sourceUrl: row.sourceUrl,
    awardApiUrl: asString(metadata.awardApiUrl),
    awardPageUrl: asString(metadata.awardPageUrl)
  });
  const awardId = normalizeIdentifier(row.awardId);
  const title = normalizeText(row.title) || `USASpending award ${awardId || ''}`.trim();

  return {
    id: `usaspending:${awardId || title}`,
    type: 'usaspending',
    awardFamily: row.awardFamily,
    awardId: awardId || undefined,
    title,
    postedDate: row.awardedOn || row.updatedAt || '',
    amount: finiteNumberOrNull(row.obligatedAmount),
    agency: normalizeText(row.recipient) || 'Blue Origin',
    status: 'AWARDED',
    url: sourceUrl,
    sourceLabel: `USASpending ${formatUsaspendingFamilyLabel(row.awardFamily)}`,
    contractStory: row.contractStory,
    storyPresentation: row.storyPresentation
  };
}

function formatUsaspendingFamilyLabel(family: ProgramUsaspendingAwardFamily) {
  if (family === 'contracts') return 'Contract';
  if (family === 'idvs') return 'IDV';
  if (family === 'grants') return 'Grant';
  if (family === 'loans') return 'Loan';
  if (family === 'direct_payments') return 'Direct Payment';
  if (family === 'other_financial_assistance') return 'Other Assistance';
  return 'Award';
}

function mapSamContractAwardEntry(row: SamContractAwardRow): BlueOriginAuditTrailEntry {
  const metadata = asRecord(row.metadata);
  const layers = unpackSamAwardMetadata(metadata);
  const solicitationIdRecords = [
    layers.extraction,
    layers.raw,
    layers.coreData,
    layers.contractId,
    layers.solicitation,
    layers.award,
    layers.oldContractId
  ];
  const piidRecords = [
    layers.extraction,
    layers.raw,
    layers.contractId,
    layers.award,
    layers.oldContractId
  ];
  const titleRecords = [
    layers.candidate,
    layers.productOrServiceInfo,
    layers.raw,
    layers.coreData,
    layers.awardDetails
  ];
  const agencyRecords = [
    layers.contractingOffice,
    layers.contractingSubtier,
    layers.contractingDepartment,
    layers.fundingOffice,
    layers.fundingSubtier,
    layers.fundingDepartment,
    layers.raw,
    layers.coreData
  ];
  const amountRecords = [
    layers.awardDetailsDollars,
    layers.awardDetailsTotals,
    layers.awardDetails,
    layers.raw,
    layers.coreData
  ];
  const dateRecords = [
    layers.awardDetailsDates,
    layers.transactionData,
    layers.awardDetails,
    layers.raw,
    layers.coreData
  ];
  const urlRecords = [layers.raw, layers.coreData, layers.awardDetails];

  const solicitationId =
    firstString(solicitationIdRecords, [
      'solicitationId',
      'solicitationID',
      'solicitation_id',
      'solicitationNumber',
      'solicitation_number'
    ]) || normalizeIdentifier(row.solicitation_id);
  const piid =
    firstString(piidRecords, [
      'piid',
      'PIID',
      'awardId',
      'award_id',
      'referencedIDVPiid',
      'referencedIdvPiid',
      'referenced_idv_piid'
    ]) ||
    normalizeIdentifier(row.piid) ||
    normalizeIdentifier(row.contract_key);
  const title =
    firstString(titleRecords, [
      'description',
      'descriptionOfContractRequirement',
      'title',
      'solicitationTitle',
      'contractDescription',
      'awardDescription',
      'awardTitle',
      'contractTitle'
    ]) ||
    `SAM contract award ${piid || solicitationId || row.contract_key}`;
  const agency = firstString(agencyRecords, [
    'name',
    'awardingAgencyName',
    'agencyName',
    'agency',
    'departmentName',
    'organizationName',
    'awardingSubTierAgencyName',
    'officeName'
  ]);
  const amount =
    firstPositiveNumber(amountRecords, [
      'actionObligation',
      'awardAmount',
      'obligatedAmount',
      'baseDollarsObligated',
      'baseAndAllOptionsValue',
      'baseAndExercisedOptionsValue',
      'currentTotalValue',
      'totalAwardAmount',
      'totalObligatedAmount',
      'totalActionObligation',
      'totalBaseAndAllOptionsValue',
      'totalBaseAndExercisedOptionsValue'
    ]) ||
    firstNumber(amountRecords, [
      'actionObligation',
      'awardAmount',
      'obligatedAmount',
      'baseDollarsObligated',
      'baseAndAllOptionsValue',
      'baseAndExercisedOptionsValue',
      'currentTotalValue',
      'totalAwardAmount',
      'totalObligatedAmount',
      'totalActionObligation',
      'totalBaseAndAllOptionsValue',
      'totalBaseAndExercisedOptionsValue'
    ]);
  const postedDate =
    firstDate(dateRecords, [
      'dateSigned',
      'awardDate',
      'actionDate',
      'dateSigned',
      'signedDate',
      'approvedDate',
      'createdDate',
      'updatedDate',
      'lastModifiedDate',
      'postedDate',
      'solicitationDate'
    ]) ||
    '';
  const preferredUrl = firstString(urlRecords, [
    'uiLink',
    'awardUrl',
    'noticeUrl',
    'noticeURL',
    'link',
    'url'
  ]);
  const url = resolveSamPublicUrl({
    preferredUrl,
    fallbackQuery: solicitationId || piid || title
  });

  return {
    id: `sam-contract-award:${row.row_key}`,
    type: 'sam-contract-award',
    noticeId: solicitationId || undefined,
    awardId: piid || undefined,
    title: normalizeText(title) || 'SAM contract award',
    postedDate,
    amount,
    agency: normalizeText(agency),
    status: 'CONTRACT AWARD',
    url,
    sourceLabel: 'SAM.gov Contract Awards',
    contractStory: null,
    storyPresentation: buildContractStoryPresentation({
      scope: 'blue-origin',
      story: null,
      leadCount: 0
    })
  };
}

function mapSamOpportunityEntry(row: SamOpportunityNoticeRow): BlueOriginAuditTrailEntry {
  const metadata = asRecord(row.metadata);
  const title =
    normalizeText(row.title) ||
    asString(metadata.solicitationTitle) ||
    asString(metadata.description) ||
    row.notice_id ||
    'SAM opportunity notice';
  const noticeId = normalizeIdentifier(row.notice_id);
  const solicitationId = normalizeIdentifier(row.solicitation_id);
  const status = resolveOpportunityStatus(metadata);
  const url = resolveSamPublicUrl({
    preferredUrl: row.notice_url,
    fallbackQuery: noticeId || solicitationId || title
  });

  return {
    id: `sam-opportunity:${noticeId || row.id}`,
    type: 'sam-opportunity',
    noticeId: noticeId || undefined,
    awardId: solicitationId || undefined,
    title,
    postedDate: row.posted_date || normalizeDateOnly(row.updated_at) || '',
    amount: finiteNumberOrNull(row.award_amount),
    agency: normalizeText(row.awardee_name),
    status,
    url,
    sourceLabel: 'SAM.gov Opportunities',
    contractStory: null,
    storyPresentation: buildContractStoryPresentation({
      scope: 'blue-origin',
      story: null,
      leadCount: 0
    })
  };
}

async function attachContractStorySummaries(entries: BlueOriginAuditTrailEntry[]) {
  if (entries.length < 1) return entries;

  const seeds = entries.map((entry) => {
    if (entry.type === 'usaspending') {
      return {
        awardId: entry.awardId || null,
        piid: null,
        contractKey: null,
        solicitationId: entry.noticeId || null,
        noticeId: null,
        sourceUrl: entry.url || null,
        metadata: {}
      };
    }
    if (entry.type === 'sam-contract-award') {
      return {
        awardId: null,
        piid: entry.awardId || null,
        contractKey: null,
        solicitationId: entry.noticeId || null,
        noticeId: null,
        sourceUrl: entry.url || null,
        metadata: {}
      };
    }
    return {
      awardId: null,
      piid: null,
      contractKey: null,
      solicitationId: entry.awardId || null,
      noticeId: entry.noticeId || null,
      sourceUrl: entry.url || null,
      metadata: {}
    };
  });

  const summaries = await fetchContractStorySummariesByAwards('blue-origin', seeds);
  const leadCounts = await fetchProgramContractLeadCountsBySeeds('blue-origin', seeds);
  const exactSourceCounts = await fetchProgramContractSourceCountsByStoryKeys(
    [...new Set([...summaries.values()].map((story) => story.storyKey).filter(Boolean))]
  );

  return entries.map((entry, index) => {
    const key = buildStoryLookupMapKey(seeds[index]);
    const story = entry.contractStory || (key ? summaries.get(key) || null : null);
    const leadCount = key ? leadCounts.get(key) || 0 : 0;
    const exactSourceCount = story ? exactSourceCounts.get(story.storyKey) || 0 : 0;
    return {
      ...entry,
      contractStory: story,
      storyPresentation: buildContractStoryPresentation({
        scope: 'blue-origin',
        story,
        leadCount,
        exactSourceCount
      })
    };
  });
}

function unpackSamAwardMetadata(metadata: Record<string, unknown>) {
  const raw = asRecord(metadata.row);
  const coreData = asRecord(raw.coreData);
  const contractId = asRecord(raw.contractId);
  const solicitation = asRecord(raw.solicitation);
  const award = asRecord(raw.award);
  const oldContractId = asRecord(raw.oldContractId);
  const awardDetails = asRecord(raw.awardDetails);
  const federalOrganization = asRecord(coreData.federalOrganization);
  const fundingInformation = asRecord(federalOrganization.fundingInformation);
  const contractingInformation = asRecord(federalOrganization.contractingInformation);
  const awardeeData = asRecord(awardDetails.awardeeData);
  return {
    raw,
    coreData,
    contractId,
    solicitation,
    award,
    oldContractId,
    candidate: asRecord(metadata.candidate),
    extraction: asRecord(metadata.extraction),
    awardDetails,
    awardDetailsDates: asRecord(awardDetails.dates),
    awardDetailsDollars: asRecord(awardDetails.dollars),
    awardDetailsTotals: asRecord(awardDetails.totalContractDollars),
    transactionData: asRecord(awardDetails.transactionData),
    productOrServiceInfo: asRecord(awardDetails.productOrServiceInformation),
    contractingOffice: asRecord(contractingInformation.contractingOffice),
    contractingSubtier: asRecord(contractingInformation.contractingSubtier),
    contractingDepartment: asRecord(contractingInformation.contractingDepartment),
    fundingOffice: asRecord(fundingInformation.fundingOffice),
    fundingSubtier: asRecord(fundingInformation.fundingSubtier),
    fundingDepartment: asRecord(fundingInformation.fundingDepartment),
    awardeeHeader: asRecord(awardeeData.awardeeHeader)
  };
}

function resolveOpportunityStatus(metadata: Record<string, unknown>) {
  const candidates = [
    asString(metadata.ptype),
    asString(metadata.type),
    asString(metadata.noticeType),
    asString(metadata.notice_type),
    asString(metadata.classificationCode)
  ].filter((value): value is string => Boolean(value));
  if (candidates.length > 0) {
    return normalizeStatus(candidates[0]);
  }
  return 'OPPORTUNITY';
}

function firstString(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = asString(record[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstNumber(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = finiteNumberOrNull(record[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function firstPositiveNumber(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = finiteNumberOrNull(record[key]);
      if (value != null && value > 0) return value;
    }
  }
  return null;
}

function firstDate(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = normalizeDateOnly(record[key]);
      if (value) return value;
    }
  }
  return null;
}

function normalizeStatus(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/\s+/g, ' ').toUpperCase() : 'N/A';
}

function normalizeIdentifier(value: unknown) {
  const normalized = asString(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, ' ').trim();
}

function normalizeText(value: unknown) {
  const normalized = asString(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, ' ').trim();
}

function normalizeDateOnly(value: unknown) {
  const normalized = asString(value);
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

function asString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    if (map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeIdentifier(value);
    if (!normalized) continue;
    seen.add(normalized);
  }
  return [...seen.values()];
}

function sortEntriesByDateDesc(entries: BlueOriginAuditTrailEntry[]) {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(a.postedDate || '');
    const bTime = Date.parse(b.postedDate || '');
    const safeA = Number.isFinite(aTime) ? aTime : -1;
    const safeB = Number.isFinite(bTime) ? bTime : -1;
    if (safeA !== safeB) return safeB - safeA;
    return a.id.localeCompare(b.id);
  });
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
