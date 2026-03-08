'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { NewsStreamItem, NewsStreamLaunch, NewsStreamPage, NewsType } from '@/lib/types/news';
import { TelemetryCountdown } from './TelemetryCountdown';

type CommLinkStreamProps = {
  initialPage: NewsStreamPage;
  type: NewsType | 'all';
  providerName: string | null;
  initialNowMs?: number;
};

type StreamStatus = {
  tone: 'ok' | 'warn';
  message: string;
};

export function CommLinkStream({ initialPage, type, providerName, initialNowMs }: CommLinkStreamProps) {
  const [items, setItems] = useState<NewsStreamItem[]>(() => initialPage.items || []);
  const [nextCursor, setNextCursor] = useState(() => initialPage.nextCursor || 0);
  const [hasMore, setHasMore] = useState(() => Boolean(initialPage.hasMore));
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setItems(initialPage.items || []);
    setNextCursor(initialPage.nextCursor || 0);
    setHasMore(Boolean(initialPage.hasMore));
    setLoadingMore(false);
    setStatus(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [initialPage.hasMore, initialPage.items, initialPage.nextCursor]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const fetchMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingMore(true);
    setStatus(null);
    try {
      const qs = new URLSearchParams();
      qs.set('cursor', String(nextCursor));
      qs.set('type', type);
      if (providerName) qs.set('provider', providerName);

      const res = await fetch(`/api/news/stream?${qs.toString()}`, {
        signal: controller.signal
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          body?.error === 'supabase_not_configured'
            ? 'Downlink offline (Supabase not configured).'
            : body?.error
              ? `Downlink disruption: ${body.error}`
              : `Downlink disruption: ${res.status}`;
        setStatus({ tone: 'warn', message });
        setHasMore(false);
        return;
      }

      const json = (await res.json()) as NewsStreamPage;
      const nextItems = Array.isArray(json?.items) ? json.items : [];

      setItems((prev) => {
        const existing = new Set(prev.map((item) => item.snapi_uid));
        const merged = [...prev];
        nextItems.forEach((item) => {
          if (!item?.snapi_uid || existing.has(item.snapi_uid)) return;
          merged.push(item);
          existing.add(item.snapi_uid);
        });
        return merged;
      });
      setNextCursor(Number.isFinite(json?.nextCursor) ? json.nextCursor : nextCursor);
      setHasMore(Boolean(json?.hasMore));
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        console.error('news stream fetch error', err);
        setStatus({ tone: 'warn', message: 'Downlink disruption. Try again.' });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor, providerName, type]);

  useEffect(() => {
    if (!hasMore || loadingMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        fetchMore();
      },
      { rootMargin: '500px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchMore, hasMore, loadingMore]);

  const streamMeta = useMemo(() => {
    const typeLabel = type === 'all' ? 'ALL TRAFFIC' : type.toUpperCase();
    const providerLabel = providerName ? providerName.toUpperCase() : 'ALL PROVIDERS';
    return { typeLabel, providerLabel };
  }, [providerName, type]);

  return (
    <section className="rounded-3xl border border-stroke bg-surface-1/70 p-4 shadow-surface backdrop-blur-xl md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-text3">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-primary/60 blur-[2px]" aria-hidden="true" />
              <span className="absolute inset-0 rounded-full bg-primary animate-pulse" aria-hidden="true" />
              <span className="relative h-2 w-2 rounded-full bg-primary" />
            </span>
            CommLink Stream
            <span className="text-text4">/</span>
            <span className="font-mono text-[10px] text-text4">{streamMeta.typeLabel}</span>
            <span className="text-text4">/</span>
            <span className="font-mono text-[10px] text-text4">{streamMeta.providerLabel}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text2">
            Incoming coverage packets fused with mission status. Scroll to keep the downlink alive.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke bg-[rgba(234,240,255,0.04)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
            PACKETS {items.length}
          </span>
          <button
            type="button"
            onClick={() => fetchMore()}
            disabled={!hasMore || loadingMore}
            className={clsx(
              'rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition',
              !hasMore || loadingMore
                ? 'cursor-not-allowed border-stroke bg-[rgba(234,240,255,0.03)] text-text4'
                : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            )}
          >
            {loadingMore ? 'ACQUIRING…' : hasMore ? 'REQUEST MORE' : 'END OF STREAM'}
          </button>
        </div>
      </div>

      {status && (
        <div
          className={clsx(
            'mt-4 rounded-2xl border px-3 py-2 text-xs',
            status.tone === 'warn'
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-stroke bg-[rgba(234,240,255,0.04)] text-text2'
          )}
        >
          {status.message}
        </div>
      )}

      <div className="commlink-rail relative mt-6">
        <ul className="space-y-4">
          {items.map((item, index) => (
            <CommLinkPacket key={item.snapi_uid} item={item} index={index} initialNowMs={initialNowMs} />
          ))}
        </ul>

        <div ref={loadMoreRef} className="h-14" />

        {!loadingMore && !hasMore && items.length > 0 && (
          <div className="mt-2 text-center text-xs text-text4">No further packets detected.</div>
        )}

        {items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-stroke bg-[rgba(234,240,255,0.04)] p-4 text-sm text-text2">
            No packets received yet.
          </div>
        )}
      </div>
    </section>
  );
}

function CommLinkPacket({
  item,
  index,
  initialNowMs
}: {
  item: NewsStreamItem;
  index: number;
  initialNowMs?: number;
}) {
  const title = item.title?.trim() || 'Untitled';
  const summary = item.summary ? truncateText(item.summary, 220) : null;
  const publishedIso = item.published_at || item.updated_at || null;
  const timestamp = formatTelemetryTimestamp(publishedIso);
  const badge = formatNewsType(item.item_type);
  const site = item.news_site || 'Spaceflight News';
  const authors = formatAuthors(item.authors);
  const imageUrl = normalizeImageUrl(item.image_url);
  const packetMeta = derivePacketMeta(item.snapi_uid);

  const launch = item.launch?.primary ?? null;
  const toneSignal = inferToneSignal(item, launch);
  const tone = toneForSignal(toneSignal);

  const missionLabel = launch ? (launch.statusText || launch.statusName || 'Mission').toUpperCase() : null;
  const netLabel = launch ? formatLaunchNetLabel(launch.net, launch.netPrecision) : null;
  const missionHref = launch ? buildLaunchHref({ id: launch.id, name: launch.name || 'Launch' }) : null;

  return (
    <li className="relative pl-10">
      <span
        aria-hidden="true"
        className={clsx(
          'absolute left-4 top-6 h-16 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80 blur-[0.2px]',
          tone.rail,
          tone.glow
        )}
      />
      <span
        aria-hidden="true"
        className={clsx('absolute left-4 top-6 h-px w-6 -translate-y-1/2 opacity-70', tone.rail)}
      />
      <span
        aria-hidden="true"
        className={clsx(
          'absolute left-4 top-6 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border',
          tone.ring
        )}
      >
        <span className={clsx('h-2 w-2 rounded-full', tone.dot)} />
      </span>
      {item.featured && (
        <span
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute left-4 top-6 z-0 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30',
            tone.dot,
            'animate-ping'
          )}
        />
      )}

      <article className="commlink-packet group relative overflow-hidden rounded-2xl border border-stroke bg-surface-1/70 p-4 shadow-surface backdrop-blur-xl transition hover:border-stroke-strong">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text4">
            <span className="font-mono text-text3">SEQ {String(index + 1).padStart(3, '0')}</span>
            <span className="text-text4">/</span>
            <span className="text-text3">{site}</span>
            <span className="text-text4">/</span>
            <span className="text-text3">{badge}</span>
            {item.featured && (
              <>
                <span className="text-text4">/</span>
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] text-primary">
                  PRIORITY
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text4">
            {launch && (
              <>
                <span className={clsx('rounded-full border px-2 py-0.5', tone.badge)}>
                  <TelemetryCountdown
                    net={launch.net}
                    netPrecision={launch.netPrecision}
                    initialNowMs={initialNowMs}
                    className={clsx(tone.countdown, 'text-[10px]')}
                  />
                </span>
                <span className="text-text4">•</span>
              </>
            )}
            {timestamp && <span>{timestamp}Z</span>}
            <span className="text-text4">•</span>
            <span>SNR {packetMeta.snr}%</span>
            <span className="text-text4">•</span>
            <span>CRC {packetMeta.crc}</span>
          </div>
        </header>

        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold text-text1 transition group-hover:text-primary"
            >
              {title}
            </a>
            {summary && <p className="mt-2 text-sm text-text2">{summary}</p>}
            {authors && <div className="mt-2 text-xs text-text3">By {authors}</div>}
          </div>

          {imageUrl && (
            <div className="relative hidden h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-stroke bg-surface-0 sm:block">
              <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              <div className="commlink-scanline absolute inset-0 opacity-70" aria-hidden="true" />
            </div>
          )}
        </div>

        <footer className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text3">
          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:text-primary/80">
            Open packet
            <ExternalIcon className="h-3.5 w-3.5" />
          </a>
          {publishedIso && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text4">
              RX {formatShortDate(publishedIso)}
            </span>
          )}
          {item.launch?.extraCount ? (
            <span className="rounded-full border border-stroke bg-[rgba(234,240,255,0.03)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text4">
              +{item.launch.extraCount} linked
            </span>
          ) : null}
        </footer>

        {launch && missionHref && (
          <div className="mt-4 rounded-2xl border border-stroke bg-[rgba(0,0,0,0.22)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text3">Mission Context</div>
                {item.launch?.matchedBy === 'mention' && (
                  <span className="rounded-full border border-stroke bg-[rgba(234,240,255,0.03)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text4">
                    TEXT MATCH
                  </span>
                )}
              </div>
              {missionLabel && (
                <span className={clsx('rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]', tone.badge)}>
                  {missionLabel}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <Link href={missionHref} className="text-sm font-semibold text-text1 hover:text-primary">
                {launch.name?.trim() || 'Launch'}
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text4">NET</span>
              <span>{netLabel ?? 'TBD'}</span>
              {launch.provider && (
                <>
                  <span className="text-text4">•</span>
                  <span className="truncate">{launch.provider}</span>
                </>
              )}
            </div>
          </div>
        )}
      </article>
    </li>
  );
}

type ToneSignal = 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger';

function inferToneSignal(item: NewsStreamItem, launch: NewsStreamLaunch | null): ToneSignal {
  if (!launch) {
    if (item.item_type === 'blog') return 'secondary';
    if (item.item_type === 'report') return 'accent';
    return 'primary';
  }

  const statusCombined = `${launch.statusName ?? ''} ${launch.statusText ?? ''}`.toLowerCase();
  if (statusCombined.includes('scrub')) return 'danger';
  if (statusCombined.includes('hold') || statusCombined.includes('delay')) return 'warning';
  if (statusCombined.includes('success') || statusCombined.includes('successful')) return 'success';
  if (statusCombined.includes('fail') || statusCombined.includes('anomaly') || statusCombined.includes('partial')) return 'danger';
  if (statusCombined.includes('go')) return 'success';
  return 'primary';
}

function toneForSignal(signal: ToneSignal) {
  switch (signal) {
    case 'success':
      return {
        rail: 'bg-success/70',
        glow: 'shadow-[0_0_22px_rgba(var(--success-rgb)_/_0.35)]',
        dot: 'bg-success',
        ring: 'border-success/40 bg-success/10',
        badge: 'border-success/40 bg-success/10 text-success',
        countdown: 'text-success',
      };
    case 'warning':
      return {
        rail: 'bg-warning/70',
        glow: 'shadow-[0_0_22px_rgba(var(--warning-rgb)_/_0.28)]',
        dot: 'bg-warning',
        ring: 'border-warning/40 bg-warning/10',
        badge: 'border-warning/40 bg-warning/10 text-warning',
        countdown: 'text-warning',
      };
    case 'danger':
      return {
        rail: 'bg-danger/70',
        glow: 'shadow-[0_0_22px_rgba(var(--danger-rgb)_/_0.28)]',
        dot: 'bg-danger',
        ring: 'border-danger/40 bg-danger/10',
        badge: 'border-danger/40 bg-danger/10 text-danger',
        countdown: 'text-danger',
      };
    case 'secondary':
      return {
        rail: 'bg-secondary/70',
        glow: 'shadow-[0_0_22px_rgba(124,92,255,0.28)]',
        dot: 'bg-secondary',
        ring: 'border-secondary/40 bg-secondary/10',
        badge: 'border-secondary/40 bg-secondary/10 text-secondary',
        countdown: 'text-secondary',
      };
    case 'accent':
      return {
        rail: 'bg-accent/70',
        glow: 'shadow-[0_0_22px_rgba(255,77,219,0.22)]',
        dot: 'bg-accent',
        ring: 'border-accent/40 bg-accent/10 text-accent',
        badge: 'border-accent/40 bg-accent/10 text-accent',
        countdown: 'text-accent',
      };
    default:
      return {
        rail: 'bg-primary/70',
        glow: 'shadow-[0_0_22px_rgba(var(--primary-rgb)_/_0.25)]',
        dot: 'bg-primary',
        ring: 'border-primary/40 bg-primary/10',
        badge: 'border-primary/40 bg-primary/10 text-primary',
        countdown: 'text-primary',
      };
  }
}

function formatNewsType(type: NewsType) {
  switch (type) {
    case 'blog':
      return 'Blog';
    case 'report':
      return 'Report';
    default:
      return 'Article';
  }
}

function formatTelemetryTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
}

function formatShortDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function formatLaunchNetLabel(net: string | null, precision: NewsStreamLaunch['netPrecision']) {
  if (!net) return null;
  const date = new Date(net);
  if (Number.isNaN(date.getTime())) return null;
  const showTime = precision === 'minute' || precision === 'hour';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: showTime ? 'short' : undefined,
    timeZone: 'UTC'
  }).format(date);
}

function formatAuthors(authors: NewsStreamItem['authors']) {
  if (!Array.isArray(authors)) return null;
  const names = authors.map((a) => a?.name?.trim()).filter(Boolean) as string[];
  if (!names.length) return null;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function truncateText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3).trim()}...`;
}

function derivePacketMeta(uid: string) {
  const hash = fnv1a(uid);
  const snr = 35 + (hash % 65);
  const crc = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return { snr, crc };
}

function fnv1a(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M14 5h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14 19 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M19 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 17.5v-10A1.5 1.5 0 0 1 7.5 6h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
