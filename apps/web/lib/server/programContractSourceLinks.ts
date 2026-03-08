import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ContractStorySourceEvidenceGroup,
  ContractStorySourceEvidenceItem,
  ContractStorySourceEvidenceType,
  ProgramContractStoryScope
} from '@/lib/types/contractsStory';
import { resolveSamPublicUrl } from '@/lib/utils/sam';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

type ProgramContractSourceLinkRow = {
  story_key: string;
  program_scope: string;
  source_type: string;
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
};

const SOURCE_LINK_SELECT =
  'story_key,program_scope,source_type,source_record_key,title,summary,entity_name,agency_name,piid,solicitation_id,notice_id,usaspending_award_id,source_url,published_at,amount';
const STORY_KEY_BATCH = 200;

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export const fetchProgramContractSourceEvidenceByStoryKey = withCache(
  async (
    storyKey: string,
    options: {
      includeUsaspending?: {
        programScope: ProgramContractStoryScope;
        awardId?: string | null;
      };
    } = {}
  ): Promise<ContractStorySourceEvidenceGroup[]> => {
    const normalizedStoryKey = normalizeText(storyKey);
    if (!normalizedStoryKey || !isSupabaseConfigured()) {
      return buildEvidenceGroups([]);
    }

    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase
      .from('program_contract_story_source_links')
      .select(SOURCE_LINK_SELECT)
      .eq('story_key', normalizedStoryKey)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('source_type', { ascending: true })
      .order('source_record_key', { ascending: true });

    if (error && !isMissingSourceLinkRelationError(error)) {
      throw error;
    }

    const exactItems = error
      ? ([] as ContractStorySourceEvidenceItem[])
      : ((data || []) as ProgramContractSourceLinkRow[]).map(mapSourceLinkRow);

    const synthesizedItems = buildUsaspendingEvidenceItems(
      normalizedStoryKey,
      options.includeUsaspending?.programScope || null,
      options.includeUsaspending?.awardId || null
    );

    return buildEvidenceGroups([...synthesizedItems, ...exactItems]);
  }
);

export async function fetchProgramContractSourceCountsByStoryKeys(storyKeys: string[]) {
  const normalizedKeys = uniqueNonEmptyStrings(storyKeys);
  const out = new Map<string, number>();
  if (!isSupabaseConfigured() || normalizedKeys.length < 1) return out;

  const supabase = createSupabasePublicClient();
  for (const chunk of chunkArray(normalizedKeys, STORY_KEY_BATCH)) {
    const { data, error } = await supabase
      .from('program_contract_story_source_links')
      .select('story_key')
      .in('story_key', chunk);
    if (error) {
      if (isMissingSourceLinkRelationError(error)) return out;
      throw error;
    }

    for (const row of (data || []) as Array<{ story_key: string | null }>) {
      const storyKey = normalizeText(row.story_key);
      if (!storyKey) continue;
      out.set(storyKey, (out.get(storyKey) || 0) + 1);
    }
  }

  return out;
}

function mapSourceLinkRow(row: ProgramContractSourceLinkRow): ContractStorySourceEvidenceItem {
  const sourceType = normalizeSourceType(row.source_type);
  return {
    id: `${row.story_key}:${row.source_type}:${row.source_record_key}`,
    storyKey: normalizeText(row.story_key) || '',
    programScope: (normalizeScope(row.program_scope) || 'artemis') as ProgramContractStoryScope,
    sourceType,
    sourceRecordKey: normalizeText(row.source_record_key) || '',
    title: row.title,
    summary: row.summary,
    entityName: row.entity_name,
    agencyName: row.agency_name,
    piid: row.piid,
    solicitationId: row.solicitation_id,
    noticeId: row.notice_id,
    usaspendingAwardId: row.usaspending_award_id,
    sourceUrl:
      row.source_url ||
      (sourceType === 'usaspending-award'
        ? resolveUsaspendingAwardSourceUrl({
            awardId: row.usaspending_award_id,
            awardApiUrl: null,
            awardPageUrl: null,
            sourceUrl: null
          })
        : resolveSamPublicUrl({
            fallbackQuery:
              row.notice_id ||
              row.solicitation_id ||
              row.piid ||
              row.title ||
              row.source_record_key ||
              null
          })),
    publishedAt: row.published_at,
    amount: finiteNumberOrNull(row.amount)
  };
}

function buildUsaspendingEvidenceItems(
  storyKey: string,
  programScope: ProgramContractStoryScope | null,
  awardId: string | null
): ContractStorySourceEvidenceItem[] {
  const normalizedAwardId = normalizeText(awardId);
  if (!programScope || !normalizedAwardId) return [] as ContractStorySourceEvidenceItem[];

  return [
    {
      id: `${storyKey}:usaspending-award:${normalizedAwardId}`,
      storyKey,
      programScope,
      sourceType: 'usaspending-award' as const,
      sourceRecordKey: normalizedAwardId,
      title: null,
      summary: null,
      entityName: null,
      agencyName: null,
      piid: null,
      solicitationId: null,
      noticeId: null,
      usaspendingAwardId: normalizedAwardId,
      sourceUrl: resolveUsaspendingAwardSourceUrl({
        awardId: normalizedAwardId,
        awardApiUrl: null,
        awardPageUrl: null,
        sourceUrl: null
      }),
      publishedAt: null,
      amount: null
    }
  ];
}

function buildEvidenceGroups(items: ContractStorySourceEvidenceItem[]): ContractStorySourceEvidenceGroup[] {
  const grouped = new Map<ContractStorySourceEvidenceType, ContractStorySourceEvidenceItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.sourceType) || [];
    existing.push(item);
    grouped.set(item.sourceType, existing);
  }

  return ([
    ['usaspending-award', 'USASpending award'],
    ['sam-contract-award', 'SAM contract award'],
    ['sam-opportunity', 'SAM notice']
  ] as Array<[ContractStorySourceEvidenceType, string]>)
    .map(([sourceType, label]) => ({
      sourceType,
      label,
      items: dedupeByKey(grouped.get(sourceType) || [], (item) => item.id).sort(sortEvidenceItems)
    }))
    .filter((group) => group.items.length > 0);
}

function sortEvidenceItems(
  left: ContractStorySourceEvidenceItem,
  right: ContractStorySourceEvidenceItem
) {
  const leftMs = Date.parse(left.publishedAt || '');
  const rightMs = Date.parse(right.publishedAt || '');
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  if (safeLeft !== safeRight) return safeRight - safeLeft;
  return (left.title || left.sourceRecordKey).localeCompare(right.title || right.sourceRecordKey);
}

function normalizeScope(value: string | null | undefined): ProgramContractStoryScope | null {
  const normalized = normalizeText(value);
  if (normalized === 'artemis') return 'artemis';
  if (normalized === 'spacex') return 'spacex';
  if (normalized === 'blue-origin') return 'blue-origin';
  return null;
}

function normalizeSourceType(value: string | null | undefined): ContractStorySourceEvidenceType {
  const normalized = normalizeText(value);
  if (normalized === 'sam-contract-award') return 'sam-contract-award';
  if (normalized === 'sam-opportunity') return 'sam-opportunity';
  return 'usaspending-award';
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  }
  return [...set.values()];
}

function chunkArray<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function dedupeByKey<T>(rows: T[], getKey: (row: T) => string) {
  const out = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key || out.has(key)) continue;
    out.set(key, row);
  }
  return [...out.values()];
}

function isMissingSourceLinkRelationError(error: unknown) {
  if (typeof error === 'string') {
    return isMissingSourceLinkRelationText(error);
  }

  if (!error || typeof error !== 'object') return false;

  const record = error as Record<string, unknown>;
  const code = normalizeText(typeof record.code === 'string' ? record.code : null);
  if (code === '42P01' || code === 'PGRST205') return true;

  return [record.message, record.details, record.hint].some((value) =>
    isMissingSourceLinkRelationText(typeof value === 'string' ? value : '')
  );
}

function isMissingSourceLinkRelationText(value: string | undefined) {
  const normalized = (value || '').toLowerCase();
  return (
    normalized.includes('program_contract_story_source_links') &&
    (normalized.includes('does not exist') || normalized.includes('schema cache') || normalized.includes('could not find'))
  );
}
