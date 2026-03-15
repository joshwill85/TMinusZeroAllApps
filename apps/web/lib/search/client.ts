import { browserApiClient } from '@/lib/api/client';
import type { SiteSearchResponse } from '@tminuszero/domain';

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
    q: trimmed
  });
  if (options?.types) params.set('types', options.types);

  if (options?.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const payload = await browserApiClient.search(trimmed, {
    limit,
    offset,
    types: options?.types ? options.types.split(',').map((value) => value.trim()).filter(Boolean) : undefined
  });
  const normalized: SiteSearchResponse = {
    query: payload.query,
    results: payload.results.map((result) => ({
      id: result.id,
      type: result.type as SiteSearchResponse['results'][number]['type'],
      title: result.title,
      subtitle: result.subtitle,
      summary: result.summary,
      url: result.href,
      imageUrl: result.imageUrl,
      publishedAt: result.publishedAt,
      badge: result.badge
    })),
    tookMs: payload.tookMs,
    limit: payload.limit,
    offset: payload.offset,
    hasMore: payload.hasMore
  };

  searchResponseCache.set(cacheKey, {
    expiresAt: Date.now() + SITE_SEARCH_CACHE_TTL_MS,
    payload: normalized
  });

  return normalized;
}

export async function warmSiteSearch(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}
