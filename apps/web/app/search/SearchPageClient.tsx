'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SiteSearchResult } from '@/lib/search/shared';
import { SITE_SEARCH_MIN_QUERY_LENGTH, fetchSiteSearch } from '@/lib/search/client';
import {
  formatSiteSearchLongDate,
  getSiteSearchBadge,
  getSiteSearchPreview,
  isExternalSearchUrl
} from '@/lib/search/presentation';

const PAGE_SIZE = 20;
const QUERY_URL_DEBOUNCE_MS = 150;
const QUERY_FETCH_DEBOUNCE_MS = 90;

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export default function SearchPageClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamQuery = searchParams.get('q') || '';
  const searchParamsString = searchParams.toString();
  const initialQuery = searchParamQuery;
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<SiteSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tookMs, setTookMs] = useState<number | null>(null);

  const trimmedQuery = query.trim();
  const deferredTrimmedQuery = deferredQuery.trim();
  const canSearch = deferredTrimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    setQuery(searchParamQuery);
  }, [searchParamQuery]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams(searchParamsString);
      if (trimmedQuery) params.set('q', trimmedQuery);
      else params.delete('q');
      const nextQuery = params.toString();
      const nextHref = `${pathname}${nextQuery ? `?${nextQuery}` : ''}`;
      const currentHref = `${pathname}${searchParamsString ? `?${searchParamsString}` : ''}`;
      if (nextHref !== currentHref) {
        router.replace(nextHref, { scroll: false });
      }
    }, QUERY_URL_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [pathname, query, router, searchParamsString, trimmedQuery]);

  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setStatus('idle');
      setError(null);
      setHasMore(false);
      setTookMs(null);
      return;
    }

    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    setHasMore(false);
    setTookMs(null);

    const timeoutId = window.setTimeout(() => {
      fetchSiteSearch(deferredTrimmedQuery, {
        signal: controller.signal,
        limit: PAGE_SIZE,
        offset: 0
      })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setResults(payload.results);
          setStatus('ready');
          setHasMore(payload.hasMore);
          setTookMs(payload.tookMs);
        })
        .catch((fetchError) => {
          if (controller.signal.aborted) return;
          console.error('search page fetch error', fetchError);
          setStatus('error');
          setError(fetchError instanceof Error ? fetchError.message : 'search_query_failed');
          setHasMore(false);
          setTookMs(null);
        });
    }, QUERY_FETCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [canSearch, deferredTrimmedQuery]);

  const heading = useMemo(() => {
    if (trimmedQuery.length < SITE_SEARCH_MIN_QUERY_LENGTH) return 'Search across launches, programs, guides, and news';
    if (status === 'error') return 'Search is temporarily unavailable';
    if (status === 'loading' && results.length === 0) return 'Searching...';
    return `Results for "${trimmedQuery}"`;
  }, [results.length, status, trimmedQuery]);

  const handleOpenResult = (result: SiteSearchResult) => {
    if (isExternalSearchUrl(result.url)) {
      const opened = window.open(result.url, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.assign(result.url);
      return;
    }

    router.push(result.url);
  };

  const handleLoadMore = async () => {
    if (!canSearch || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const payload = await fetchSiteSearch(deferredTrimmedQuery, {
        limit: PAGE_SIZE,
        offset: results.length,
        bypassCache: true
      });
      setResults((current) => [...current, ...payload.results]);
      setHasMore(payload.hasMore);
    } catch (loadMoreError) {
      console.error('search page load more error', loadMoreError);
      setError(loadMoreError instanceof Error ? loadMoreError.message : 'search_query_failed');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <section className="overflow-hidden rounded-[2rem] border border-stroke bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_38%),rgba(7,9,19,0.96)] shadow-surface">
        <div className="border-b border-stroke/70 px-5 py-6 md:px-7">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text3">Unified Search</div>
          <h1 className="mt-2 text-3xl font-semibold text-text1 md:text-4xl">{heading}</h1>
          <p className="mt-2 max-w-3xl text-sm text-text3">
            Live results update as you type and pull from launches, program hubs, guides, contracts, recovery assets, catalog entities, pages, and news.
          </p>

          <div className="mt-5 rounded-[1.5rem] border border-stroke bg-surface-0 px-4 py-4">
            <label className="text-[11px] uppercase tracking-[0.14em] text-text4" htmlFor="search-page-input">
              Search query
            </label>
            <div className="mt-2 flex items-center gap-3">
              <SearchIcon className="h-4 w-4 shrink-0 text-text4" />
              <input
                id="search-page-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Starship, jellyfish, Artemis II, award ID, OCISLY..."
                className="w-full bg-transparent text-base text-text1 outline-none placeholder:text-text4"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text3">
            <span>Examples: `type:news starship`, `jelly fish`, `artemis contracts`, `-starlink`</span>
            {tookMs != null && canSearch && status === 'ready' && <span>{tookMs} ms</span>}
          </div>
        </div>

        <div className="grid gap-6 px-5 py-6 md:grid-cols-[minmax(0,1fr)_18rem] md:px-7">
          <div>
            {trimmedQuery.length < SITE_SEARCH_MIN_QUERY_LENGTH && (
              <div className="rounded-[1.5rem] border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-5 text-sm text-text3">
                Start with at least {SITE_SEARCH_MIN_QUERY_LENGTH} characters. The index is optimized for instant suggestions and broad site recall without per-query rebuilds.
              </div>
            )}

            {trimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH && status === 'error' && (
              <div className="rounded-[1.5rem] border border-warning/40 bg-[rgba(255,196,0,0.06)] px-4 py-5 text-sm text-warning">
                Search is unavailable{error ? ` (${error})` : ''}.
              </div>
            )}

            {trimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH && status !== 'error' && results.length === 0 && (
              <div className="rounded-[1.5rem] border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-5 text-sm text-text3">
                {status === 'loading' ? 'Searching...' : 'No matches found for this query.'}
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-3">
                {results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="flex w-full items-start justify-between gap-4 rounded-[1.5rem] border border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-4 text-left transition hover:border-primary/60 hover:bg-[rgba(255,255,255,0.04)]"
                    onClick={() => handleOpenResult(result)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-stroke bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text3">
                          {getSiteSearchBadge(result)}
                        </span>
                        <span className="truncate text-base font-semibold text-text1">{result.title}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm text-text3">{getSiteSearchPreview(result)}</div>
                      <div className="mt-3 truncate text-[11px] uppercase tracking-[0.12em] text-text4">{result.url}</div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] uppercase tracking-[0.12em] text-text4">
                      {formatSiteSearchLongDate(result.publishedAt)}
                    </div>
                  </button>
                ))}

                {hasMore && (
                  <div className="pt-2">
                    <button type="button" className="btn rounded-xl px-4 py-2 text-sm" onClick={handleLoadMore} disabled={loadingMore}>
                      {loadingMore ? 'Loading...' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-[1.5rem] border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text4">Coverage</div>
              <div className="mt-2 text-sm text-text3">Launch detail pages, mission hubs, program pages, contracts, people, recovery assets, catalog entities, and live news.</div>
            </div>
            <div className="rounded-[1.5rem] border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text4">Query Tips</div>
              <div className="mt-2 text-sm text-text3">Quoted phrases keep words together. `-exclude` removes a term. `type:news` narrows by result type.</div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
