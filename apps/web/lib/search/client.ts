import type { SiteSearchResponse } from '@/lib/search/shared';

export const SITE_SEARCH_MIN_QUERY_LENGTH = 2;
const SITE_SEARCH_CACHE_TTL_MS = 30_000;

const searchResponseCache = new Map<string, { expiresAt: number; payload: SiteSearchResponse }>();

function buildCacheKey(query: string, limit: number, offset: number, types?: string | null) {
  return JSON.stringify({
    query: query.trim().toLowerCase(),
    limit,
    offset,
    types: types || ''
  });
}

function emptySearchResponse(query: string, limit: number, offset: number): SiteSearchResponse {
  return {
    query,
    results: [],
    tookMs: 0,
    limit,
    offset,
    hasMore: false
  };
}

export async function fetchSiteSearch(
  query: string,
  options?: {
    signal?: AbortSignal;
    limit?: number;
    offset?: number;
    types?: string | null;
    bypassCache?: boolean;
  }
) {
  const trimmed = query.trim();
  const limit = Math.max(1, Math.min(50, Math.trunc(options?.limit ?? 8)));
  const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
  if (!trimmed) return emptySearchResponse('', limit, offset);

  const cacheKey = buildCacheKey(trimmed, limit, offset, options?.types);
  const cached = searchResponseCache.get(cacheKey);
  if (!options?.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(limit),
    offset: String(offset)
  });
  if (options?.types) params.set('types', options.types);

  const response = await fetch(`/api/search?${params.toString()}`, {
    signal: options?.signal,
    cache: 'no-store'
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<SiteSearchResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(payload?.error || 'search_query_failed');
  }

  const normalized: SiteSearchResponse = {
    query: typeof payload.query === 'string' ? payload.query : trimmed,
    results: Array.isArray(payload.results) ? payload.results : [],
    tookMs: Number.isFinite(payload.tookMs) ? Number(payload.tookMs) : 0,
    limit: Number.isFinite(payload.limit) ? Number(payload.limit) : limit,
    offset: Number.isFinite(payload.offset) ? Number(payload.offset) : offset,
    hasMore: Boolean(payload.hasMore)
  };

  searchResponseCache.set(cacheKey, {
    expiresAt: Date.now() + SITE_SEARCH_CACHE_TTL_MS,
    payload: normalized
  });

  return normalized;
}

export async function warmSiteSearch(signal?: AbortSignal) {
  await fetch('/api/search?warm=1', { signal, cache: 'no-store' }).catch(() => undefined);
}
