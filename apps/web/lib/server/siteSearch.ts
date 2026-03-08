import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import {
  parseSiteSearchInput,
  parseSiteSearchTypesParam,
  type SiteSearchResponse,
  type SiteSearchResult,
  type SearchResultType
} from '@/lib/search/shared';
import { ensureSiteSearchFresh } from '@/lib/server/siteSearchSync';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

type SearchRpcRow = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  summary: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
  badge: string | null;
  score: number | null;
};

function clampLimit(raw: number | null | undefined) {
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw as number)));
}

function clampOffset(raw: number | null | undefined) {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw as number));
}

function normalizeResults(rows: SearchRpcRow[]) {
  return rows.map(
    (row) =>
      ({
        id: String(row.id),
        type: row.type,
        title: row.title,
        subtitle: row.subtitle,
        summary: row.summary,
        url: row.url,
        imageUrl: row.image_url,
        publishedAt: row.published_at,
        badge: row.badge
      }) satisfies SiteSearchResult
  );
}

export async function warmSiteSearchIndex() {
  if (!isSupabaseConfigured()) return { ok: false, warmed: false };
  await ensureSiteSearchFresh({ requireReady: false });
  return { ok: true, warmed: true };
}

export async function searchSite(
  rawQuery: string | null | undefined,
  options?: {
    limit?: number;
    offset?: number;
    types?: string | null | undefined;
  }
): Promise<SiteSearchResponse> {
  const parsed = parseSiteSearchInput(rawQuery);
  const requestedTypes = parseSiteSearchTypesParam(options?.types);
  const limit = clampLimit(options?.limit);
  const offset = clampOffset(options?.offset);
  const types = [...new Set<SearchResultType>([...parsed.types, ...requestedTypes])];

  if (!parsed.query || !parsed.hasPositiveTerms || !isSupabaseConfigured()) {
    return {
      query: parsed.query || '',
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    };
  }

  const startedAt = Date.now();
  await ensureSiteSearchFresh({ requireReady: true });

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc('search_public_documents', {
    q_in: parsed.query,
    limit_n: limit + 1,
    offset_n: offset,
    types_in: types.length ? types : null
  });

  if (error) throw error;

  const rows = Array.isArray(data) ? (data as SearchRpcRow[]) : [];
  return {
    query: parsed.query,
    results: normalizeResults(rows.slice(0, limit)),
    tookMs: Date.now() - startedAt,
    limit,
    offset,
    hasMore: rows.length > limit
  };
}
