'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteSearchResult } from '@/lib/search/shared';
import { SITE_SEARCH_MIN_QUERY_LENGTH, fetchSiteSearch, warmSiteSearch } from '@/lib/search/client';
import {
  formatSiteSearchShortDate,
  getSiteSearchBadge,
  getSiteSearchPreview,
  isExternalSearchUrl
} from '@/lib/search/presentation';

const QUERY_DEBOUNCE_MS = 75;

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export function LaunchSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<SiteSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmedQuery = query.trim();
  const deferredTrimmedQuery = deferredQuery.trim();
  const canSearch = deferredTrimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH;
  const showIdleHint = trimmedQuery.length < SITE_SEARCH_MIN_QUERY_LENGTH;
  const selectedResult = results[activeIndex] || null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setStatus('idle');
      setError(null);
      setTookMs(null);
      setActiveIndex(0);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    warmSiteSearch(controller.signal);
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredTrimmedQuery]);

  useEffect(() => {
    if (!open) return;

    if (!canSearch) {
      setResults([]);
      setStatus('idle');
      setError(null);
      setTookMs(null);
      return;
    }

    const controller = new AbortController();
    setStatus('loading');
    setError(null);

    const timeoutId = window.setTimeout(() => {
      fetchSiteSearch(deferredTrimmedQuery, {
        signal: controller.signal,
        limit: 8
      })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setResults(payload.results);
          setStatus('ready');
          setError(null);
          setTookMs(payload.tookMs);
        })
        .catch((fetchError) => {
          if (controller.signal.aborted) return;
          console.error('site search fetch error', fetchError);
          setStatus('error');
          setError(fetchError instanceof Error ? fetchError.message : 'search_query_failed');
          setTookMs(null);
        });
    }, QUERY_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [canSearch, deferredTrimmedQuery, open]);

  useEffect(() => {
    if (results.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, results.length - 1));
  }, [results]);

  const summaryText = useMemo(() => {
    if (showIdleHint) return `Type at least ${SITE_SEARCH_MIN_QUERY_LENGTH} characters to search launches, hubs, guides, news, contracts, people, recovery, catalog, and pages.`;
    if (status === 'error') return `Search unavailable${error ? ` (${error})` : ''}.`;
    if (status === 'loading' && results.length === 0) return 'Searching the site…';
    if (status === 'loading' && results.length > 0) return 'Refreshing results…';
    if (status === 'ready' && results.length === 0) return 'No matches found.';
    if (status === 'ready') {
      return tookMs != null ? `${results.length} result${results.length === 1 ? '' : 's'} in ${tookMs} ms.` : `${results.length} results.`;
    }
    return 'Search the full public site corpus.';
  }, [error, results.length, showIdleHint, status, tookMs]);

  const openResult = (result: SiteSearchResult) => {
    if (isExternalSearchUrl(result.url)) {
      const opened = window.open(result.url, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.assign(result.url);
      onClose();
      return;
    }

    router.push(result.url);
    onClose();
  };

  const openFullResults = () => {
    if (!trimmedQuery) return;
    router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-20 md:pt-24">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(0,0,0,0.72)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close search"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-search-title"
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-stroke bg-[rgba(7,9,19,0.95)] shadow-surface backdrop-blur-xl"
      >
        <div className="border-b border-stroke/80 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_48%),rgba(255,255,255,0.02)] px-4 py-4 md:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text3">Site Search</div>
              <h2 id="site-search-title" className="mt-1 text-lg font-semibold text-text1">
                Search the full site corpus
              </h2>
              <p className="mt-1 text-sm text-text3">Use plain language, quotes, `-exclude`, or `type:news Artemis`.</p>
            </div>
            <button type="button" className="text-sm text-text3 transition hover:text-text1" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-stroke bg-surface-0 px-3 py-3">
            <label className="text-[11px] uppercase tracking-[0.14em] text-text4" htmlFor="site-search-input">
              Query
            </label>
            <div className="mt-2 flex items-center gap-3">
              <SearchIcon className="h-4 w-4 shrink-0 text-text4" />
              <input
                id="site-search-input"
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Jellyfish, Artemis contracts, OCISLY, Blue Ring, Starship…"
                className="w-full bg-transparent text-sm text-text1 outline-none placeholder:text-text4"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
                    return;
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                    return;
                  }

                  if (event.key === 'Enter') {
                    if (selectedResult) {
                      event.preventDefault();
                      openResult(selectedResult);
                      return;
                    }

                    if (trimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH) {
                      event.preventDefault();
                      openFullResults();
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div className="px-4 py-3 md:px-5">
          <div className="flex items-center justify-between gap-3 border-b border-stroke/70 px-1 pb-3 text-xs text-text3">
            <div>{summaryText}</div>
            {trimmedQuery.length >= SITE_SEARCH_MIN_QUERY_LENGTH && (
              <button type="button" className="text-text2 transition hover:text-primary" onClick={openFullResults}>
                Open full results
              </button>
            )}
          </div>

          <div className="mt-3 max-h-[56vh] overflow-y-auto pr-1">
            {showIdleHint && (
              <div className="rounded-2xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-5 text-sm text-text3">
                Search covers launch details, program hubs, guides, catalog entities, contracts, recovery assets, people, and live news.
              </div>
            )}

            {!showIdleHint && results.length > 0 && (
              <div className="space-y-2">
                {results.map((result, index) => {
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={result.id}
                      type="button"
                      className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        isActive
                          ? 'border-primary bg-[rgba(34,211,238,0.12)]'
                          : 'border-stroke bg-[rgba(255,255,255,0.02)] hover:border-primary/60 hover:bg-[rgba(255,255,255,0.04)]'
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => openResult(result)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-stroke bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text3">
                            {getSiteSearchBadge(result)}
                          </span>
                          <span className="truncate text-sm font-semibold text-text1">{result.title}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm text-text3">{getSiteSearchPreview(result)}</div>
                        <div className="mt-2 truncate text-[11px] uppercase tracking-[0.12em] text-text4">{result.url}</div>
                      </div>
                      <div className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-text4">
                        {formatSiteSearchShortDate(result.publishedAt)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!showIdleHint && status === 'ready' && results.length === 0 && (
              <div className="rounded-2xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] px-4 py-5 text-sm text-text3">
                No matches found for this query.
              </div>
            )}

            {!showIdleHint && status === 'error' && (
              <div className="rounded-2xl border border-warning/40 bg-[rgba(255,196,0,0.06)] px-4 py-5 text-sm text-warning">
                Search is temporarily unavailable.
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-stroke/70 pt-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-text4">Shortcuts: `/` or `Cmd/Ctrl+K`</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary rounded-xl px-3 py-2 text-sm"
                onClick={() => setQuery('')}
                disabled={!trimmedQuery}
              >
                Clear
              </button>
              <button type="button" className="btn rounded-xl px-4 py-2 text-sm" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
