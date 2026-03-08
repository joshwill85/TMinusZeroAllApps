import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { buildStoryLookupMapKey, type ContractStoryLookupSeed } from '@/lib/server/programContractStories';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ContractStoryDiscoveryItem,
  ContractStoryDiscoveryJoinStatus,
  ProgramContractStoryScope
} from '@/lib/types/contractsStory';
import { resolveSamPublicUrl } from '@/lib/utils/sam';

type ProgramContractDiscoveryRow = {
  discovery_key: string;
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
  join_status: string;
  best_candidate_story_key: string | null;
  relevance_score: number | null;
  relevance_signals: Array<Record<string, unknown>> | null;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;
const DISCOVERY_SELECT =
  'discovery_key,program_scope,source_type,source_record_key,title,summary,entity_name,agency_name,piid,solicitation_id,notice_id,usaspending_award_id,source_url,published_at,amount,join_status,best_candidate_story_key,relevance_score,relevance_signals';

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export const fetchProgramContractDiscoveryPage = withCache(
  async (
    scope: ProgramContractStoryScope,
    options: { limit?: number; offset?: number; statuses?: ContractStoryDiscoveryJoinStatus[] } = {}
  ) => {
    const limit = clampInt(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const statuses = (options.statuses && options.statuses.length > 0
      ? options.statuses
      : (['unlinked', 'candidate'] as ContractStoryDiscoveryJoinStatus[])
    ).map(normalizeJoinStatus).filter((value): value is ContractStoryDiscoveryJoinStatus => Boolean(value));

    if (!isSupabaseConfigured()) {
      return {
        items: [] as ContractStoryDiscoveryItem[],
        total: 0,
        limit,
        offset,
        hasMore: false
      };
    }

    const supabase = createSupabasePublicClient();
    let query = supabase
      .from('program_contract_story_discoveries')
      .select(DISCOVERY_SELECT, { count: 'exact' })
      .eq('program_scope', scope)
      .order('relevance_score', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (statuses.length > 0) {
      query = query.in('join_status', statuses);
    }

    const { data, count, error } = await query;
    if (error) {
      if (isMissingDiscoveryRelationError(error.message)) {
        return {
          items: [] as ContractStoryDiscoveryItem[],
          total: 0,
          limit,
          offset,
          hasMore: false
        };
      }
      throw error;
    }

    const items = ((data || []) as ProgramContractDiscoveryRow[]).map(mapDiscoveryRow);
    const total = typeof count === 'number' ? count : offset + items.length;

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    };
  }
);

export async function fetchProgramContractLeadCountsBySeeds(
  scope: ProgramContractStoryScope,
  seeds: ContractStoryLookupSeed[]
) {
  const out = new Map<string, number>();
  if (!isSupabaseConfigured() || seeds.length < 1) return out;

  const dedupe = new Map<string, Set<string>>();
  const awardIds = new Map<string, string[]>();
  const piids = new Map<string, string[]>();
  const solicitationIds = new Map<string, string[]>();
  const noticeIds = new Map<string, string[]>();

  for (const seed of seeds) {
    const seedKey = buildStoryLookupMapKey(seed);
    if (!seedKey) continue;

    addLookupValue(awardIds, normalizeIdentifierValue(seed.awardId), seedKey);
    addLookupValue(piids, normalizeIdentifierValue(seed.piid), seedKey);
    addLookupValue(solicitationIds, normalizeIdentifierValue(seed.solicitationId), seedKey);
    addLookupValue(noticeIds, normalizeIdentifierValue(seed.noticeId), seedKey);
  }

  const supabase = createSupabasePublicClient();
  await Promise.all([
    collectLeadMatchesByColumn(supabase, scope, 'usaspending_award_id', [...awardIds.keys()], {
      awardIds,
      piids,
      solicitationIds,
      noticeIds,
      dedupe
    }),
    collectLeadMatchesByColumn(supabase, scope, 'piid', [...piids.keys()], {
      awardIds,
      piids,
      solicitationIds,
      noticeIds,
      dedupe
    }),
    collectLeadMatchesByColumn(supabase, scope, 'solicitation_id', [...solicitationIds.keys()], {
      awardIds,
      piids,
      solicitationIds,
      noticeIds,
      dedupe
    }),
    collectLeadMatchesByColumn(supabase, scope, 'notice_id', [...noticeIds.keys()], {
      awardIds,
      piids,
      solicitationIds,
      noticeIds,
      dedupe
    })
  ]);

  for (const [seedKey, matchedDiscoveryKeys] of dedupe.entries()) {
    out.set(seedKey, matchedDiscoveryKeys.size);
  }

  return out;
}

function mapDiscoveryRow(row: ProgramContractDiscoveryRow): ContractStoryDiscoveryItem {
  return {
    discoveryKey: normalizeText(row.discovery_key) || '',
    programScope: (normalizeScope(row.program_scope) || 'artemis') as ProgramContractStoryScope,
    sourceType: normalizeSourceType(row.source_type),
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
      resolveSamPublicUrl({
        fallbackQuery:
          row.notice_id ||
          row.solicitation_id ||
          row.piid ||
          row.title ||
          row.source_record_key ||
          null
      }),
    publishedAt: row.published_at,
    amount: finiteNumberOrNull(row.amount),
    joinStatus: normalizeJoinStatus(row.join_status) || 'unlinked',
    bestCandidateStoryKey: row.best_candidate_story_key,
    relevanceScore: finiteNumberOrNull(row.relevance_score) ?? 0,
    relevanceSignals: Array.isArray(row.relevance_signals) ? row.relevance_signals : []
  };
}

async function collectLeadMatchesByColumn(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  scope: ProgramContractStoryScope,
  column: 'usaspending_award_id' | 'piid' | 'solicitation_id' | 'notice_id',
  values: string[],
  input: {
    awardIds: Map<string, string[]>;
    piids: Map<string, string[]>;
    solicitationIds: Map<string, string[]>;
    noticeIds: Map<string, string[]>;
    dedupe: Map<string, Set<string>>;
  }
) {
  const normalizedValues = uniqueNonEmptyStrings(values);
  if (normalizedValues.length < 1) return;

  for (const chunk of chunkArray(normalizedValues, 100)) {
    const { data, error } = await supabase
      .from('program_contract_story_discoveries')
      .select('discovery_key,usaspending_award_id,piid,solicitation_id,notice_id')
      .eq('program_scope', scope)
      .in('join_status', ['unlinked', 'candidate'])
      .in(column, chunk);

    if (error) {
      if (isMissingDiscoveryRelationError(error.message)) return;
      throw error;
    }

    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const discoveryKey = normalizeText(readString(row, 'discovery_key'));
      if (!discoveryKey) continue;

      const seedKeys = new Set<string>();
      collectSeedKeys(seedKeys, input.awardIds, normalizeIdentifierValue(readString(row, 'usaspending_award_id')));
      collectSeedKeys(seedKeys, input.piids, normalizeIdentifierValue(readString(row, 'piid')));
      collectSeedKeys(seedKeys, input.solicitationIds, normalizeIdentifierValue(readString(row, 'solicitation_id')));
      collectSeedKeys(seedKeys, input.noticeIds, normalizeIdentifierValue(readString(row, 'notice_id')));

      for (const seedKey of seedKeys) {
        const existing = input.dedupe.get(seedKey) || new Set<string>();
        existing.add(discoveryKey);
        input.dedupe.set(seedKey, existing);
      }
    }
  }
}

function normalizeScope(value: string | null | undefined): ProgramContractStoryScope | null {
  const normalized = normalizeText(value);
  if (normalized === 'artemis') return 'artemis';
  if (normalized === 'spacex') return 'spacex';
  if (normalized === 'blue-origin') return 'blue-origin';
  return null;
}

function normalizeSourceType(value: string | null | undefined) {
  return normalizeText(value) === 'sam-contract-award' ? 'sam-contract-award' : 'sam-opportunity';
}

function normalizeJoinStatus(value: string | null | undefined): ContractStoryDiscoveryJoinStatus | null {
  const normalized = normalizeText(value);
  if (normalized === 'unlinked') return 'unlinked';
  if (normalized === 'candidate') return 'candidate';
  if (normalized === 'linked') return 'linked';
  if (normalized === 'suppressed') return 'suppressed';
  return null;
}

function collectSeedKeys(set: Set<string>, lookup: Map<string, string[]>, value: string | null) {
  if (!value) return;
  for (const seedKey of lookup.get(value) || []) {
    set.add(seedKey);
  }
}

function addLookupValue(lookup: Map<string, string[]>, value: string | null, seedKey: string) {
  if (!value) return;
  const existing = lookup.get(value) || [];
  if (!existing.includes(seedKey)) existing.push(seedKey);
  lookup.set(value, existing);
}

function normalizeIdentifierValue(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) out.add(normalized);
  }
  return [...out.values()];
}

function chunkArray<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMissingDiscoveryRelationError(message: string | undefined) {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('program_contract_story_discoveries') && normalized.includes('does not exist');
}
