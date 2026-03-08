'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { XTweetEmbed } from '@/components/XTweetEmbed';
import { BlueOriginLocalTime } from '@/app/blue-origin/_components/BlueOriginLocalTime';

export type SignalEntry = {
  id: string;
  type: 'social' | 'technical' | 'government';
  title: string;
  date: string;
  summary?: string;
  sourceLabel: string;
  primaryUrl?: string | null;
  sourceUrl?: string | null;
  tweetId?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

type BlueOriginTimelineApiEvent = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  source: {
    label: string;
    href?: string;
  };
  confidence: 'high' | 'medium' | 'low';
};

type BlueOriginTimelineApiResponse = {
  events: BlueOriginTimelineApiEvent[];
  nextCursor: string | null;
};

const BLUE_ORIGIN_SIGNAL_LOG_INITIAL_LIMIT = 20;
const BLUE_ORIGIN_SIGNAL_LOG_EXPAND_LIMIT = 100;

type BlueOriginSignalLogProps = {
  timelineSignals: SignalEntry[];
  socialSignals: SignalEntry[];
  initialTimelineNextCursor: string | null;
};

export function BlueOriginSignalLog({
  timelineSignals,
  socialSignals,
  initialTimelineNextCursor
}: BlueOriginSignalLogProps) {
  const [expandedTimelineSignals, setExpandedTimelineSignals] = useState<SignalEntry[]>(() => timelineSignals);
  const [timelineNextCursor, setTimelineNextCursor] = useState<string | null>(() => initialTimelineNextCursor);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const visibleSignals = useMemo(() => {
    const merged = mergeSignalsByDateDesc(expandedTimelineSignals, socialSignals);
    return isExpanded ? merged : merged.slice(0, BLUE_ORIGIN_SIGNAL_LOG_INITIAL_LIMIT);
  }, [expandedTimelineSignals, isExpanded, socialSignals]);

  const canExpand =
    timelineNextCursor !== null ||
    expandedTimelineSignals.length + socialSignals.length > BLUE_ORIGIN_SIGNAL_LOG_INITIAL_LIMIT;

  const handleExpandToggle = useCallback(async () => {
    if (loadingAll) return;

    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    if (timelineNextCursor === null) {
      setIsExpanded(true);
      return;
    }

    setLoadingAll(true);
    setErrorMessage(null);
    let cursor: string | null = timelineNextCursor;
    let mergedTimelineSignals = [...expandedTimelineSignals];

    try {
      while (cursor) {
        const qs = new URLSearchParams({
          mode: 'quick',
          mission: 'all',
          sourceType: 'all',
          includeSuperseded: 'false',
          limit: String(BLUE_ORIGIN_SIGNAL_LOG_EXPAND_LIMIT),
          cursor
        });

        const res = await fetch(`/api/public/blue-origin/timeline?${qs.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const serverError = body && typeof body === 'object' && 'error' in body
            ? String(body.error)
            : `HTTP ${res.status}`;
          setErrorMessage(`Unable to load full timeline: ${serverError}`);
          return;
        }

        const page = (await res.json()) as BlueOriginTimelineApiResponse;
        const nextSignals = Array.isArray(page?.events)
          ? page.events.map(toSignalEntry)
          : [];
        mergedTimelineSignals = mergeUniqueSignals(mergedTimelineSignals, nextSignals);

        const nextCursor = typeof page?.nextCursor === 'string' ? page.nextCursor : null;
        if (!nextCursor) {
          cursor = null;
          break;
        }

        if (nextCursor === cursor) {
          setErrorMessage('Timeline paging cursor did not advance; stopped to avoid a request loop.');
          cursor = null;
          break;
        }

        cursor = nextCursor;
      }

      setExpandedTimelineSignals(mergedTimelineSignals);
      setTimelineNextCursor(cursor);
      setIsExpanded(true);
    } catch (error) {
      console.error('blue origin timeline expand error', error);
      setErrorMessage('Unable to load the complete timeline. Please try again.');
    } finally {
      setLoadingAll(false);
    }
  }, [expandedTimelineSignals, isExpanded, loadingAll, timelineNextCursor]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between border-b border-stroke pb-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-text1">Unified Intelligence Feed</h3>
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest text-text3">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/40"></span>Social</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400/40"></span>Technical</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-text3/40"></span>Gov Records</span>
        </div>
      </header>

      {errorMessage ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-0.5 border-l border-stroke">
        {visibleSignals.map((signal) => (
          <div
            key={signal.id}
            className="group relative flex items-start gap-8 pl-8 pb-10 last:pb-0"
          >
            <div className={`absolute left-0 -translate-x-1/2 mt-1 h-3 w-3 rounded-full border-2 border-surface-0 ${
              signal.type === 'social' ? 'bg-primary/60' :
              signal.type === 'technical' ? 'bg-cyan-400/60' :
              'bg-text3/60'
            }`}
            title={signal.type === 'social' ? 'Social Signal' : signal.type === 'technical' ? 'Technical Signal' : 'Government Record'} />

            <div className="flex flex-grow flex-col gap-3">
              <header className="flex flex-col gap-1 md:flex-row md:items-center md:gap-4">
                <span className="font-mono text-[10px] uppercase tracking-tighter text-text3">
                  <BlueOriginLocalTime
                    value={signal.date}
                    variant="date"
                    className="font-mono text-[10px] uppercase tracking-tighter text-text3"
                    fallback="Date TBD"
                  />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text3">
                  {signal.sourceLabel}
                </span>
                {signal.confidence && (
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter text-text3">
                    {signal.confidence} CONFIDENCE
                  </span>
                )}
              </header>

              <div className="flex flex-col">
                <h4 className="text-[14px] font-bold text-text1">{renderSignalTitle(signal)}</h4>
                {signal.summary && <p className="mt-1 text-[12px] leading-relaxed text-text2">{signal.summary}</p>}
                {signal.sourceUrl && signal.sourceUrl !== (signal.primaryUrl || signal.sourceUrl) ? (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 text-[11px] text-primary transition-colors hover:text-primary/80"
                  >
                    Source reference ↗
                  </a>
                ) : null}
              </div>

              {signal.tweetId && (
                <div className="mt-2 max-w-lg overflow-hidden rounded-xl border border-stroke bg-surface-1/40 p-2 shadow-sm group-hover:bg-surface-1 group-hover:shadow-md transition-all">
                  <XTweetEmbed
                    tweetId={signal.tweetId}
                    tweetUrl={signal.sourceUrl || signal.primaryUrl || `https://x.com/blueorigin/status/${signal.tweetId}`}
                    theme="dark"
                    conversation="none"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {canExpand ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleExpandToggle}
            disabled={loadingAll}
            className="rounded-full border border-stroke px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text1 transition hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingAll
              ? 'Loading complete timeline…'
              : isExpanded
                ? `Show First ${BLUE_ORIGIN_SIGNAL_LOG_INITIAL_LIMIT}`
                : 'Expand to All'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function mergeSignalsByDateDesc(leftSignals: SignalEntry[], rightSignals: SignalEntry[]) {
  const merged = mergeUniqueSignals(leftSignals, rightSignals);
  return merged.sort((a, b) => {
    const leftDate = Date.parse(a.date);
    const rightDate = Date.parse(b.date);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return rightDate - leftDate;
    if (Number.isFinite(leftDate) && !Number.isFinite(rightDate)) return -1;
    if (!Number.isFinite(leftDate) && Number.isFinite(rightDate)) return 1;
    return a.id.localeCompare(b.id);
  });
}

function mergeUniqueSignals(leftSignals: SignalEntry[], rightSignals: SignalEntry[]) {
  const nextSignals = new Map<string, SignalEntry>();
  for (const signal of leftSignals) nextSignals.set(signal.id, signal);
  for (const signal of rightSignals) {
    if (!nextSignals.has(signal.id)) nextSignals.set(signal.id, signal);
  }
  return [...nextSignals.values()];
}

function toSignalEntry(event: BlueOriginTimelineApiEvent): SignalEntry {
  return {
    id: event.id,
    type: 'technical',
    title: event.title,
    date: event.date,
    summary: event.summary || undefined,
    sourceLabel: event.source.label,
    primaryUrl: event.source.href,
    sourceUrl: event.source.href,
    confidence: event.confidence
  };
}

function renderSignalTitle(signal: SignalEntry) {
  const href = signal.primaryUrl || signal.sourceUrl;
  if (!href) return signal.title;

  if (isInternalHref(href)) {
    return (
      <Link href={href} className="transition-colors hover:text-primary">
        {signal.title}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="transition-colors hover:text-primary">
      {signal.title}
    </a>
  );
}

function isInternalHref(value: string) {
  return value.startsWith('/');
}
