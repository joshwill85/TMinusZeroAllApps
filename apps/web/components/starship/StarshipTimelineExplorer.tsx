'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';
import type { StarshipMissionSnapshot, StarshipProgramSnapshot } from '@/lib/types/starship';
import type { Launch } from '@/lib/types/launch';

type StarshipSnapshot = StarshipProgramSnapshot | StarshipMissionSnapshot;

export type StarshipTimelineEventTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export type StarshipTimelineLink = {
  eventId: string;
  reason?: string;
};

export type StarshipTimelineEvent = {
  id: string;
  title: string;
  when: string;
  summary?: string;
  mission?: string;
  tone?: StarshipTimelineEventTone;
  launch?: Launch | null;
  status?: 'completed' | 'upcoming' | 'tentative' | 'superseded' | string;
  eventTime?: string | null;
  announcedTime?: string | null;
  sourceType?: string;
  sourceLabel?: string;
  sourceHref?: string;
  confidence?: string;
  supersedes?: StarshipTimelineLink[];
  supersededBy?: StarshipTimelineLink | null;
};

export type StarshipTimelineSourceFilter = 'all' | 'll2-cache' | 'spacex-official' | 'curated-fallback';

export type StarshipTimelineFilters = {
  sourceType: StarshipTimelineSourceFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
};

export type StarshipTimelineExplorerProps = {
  snapshot?: StarshipSnapshot;
  events?: readonly StarshipTimelineEvent[];
  selectedEventId?: string | null;
  defaultSelectedEventId?: string | null;
  onSelectEvent?: (event: StarshipTimelineEvent) => void;
  title?: string;
  emptyLabel?: string;
  listAriaLabel?: string;
  className?: string;
  initialSourceType?: StarshipTimelineSourceFilter;
  initialIncludeSuperseded?: boolean;
  initialFrom?: string | null;
  initialTo?: string | null;
  onFiltersChange?: (filters: StarshipTimelineFilters) => void;
};

const TONE_CLASS: Record<StarshipTimelineEventTone, string> = {
  default: 'border-stroke bg-surface-0',
  success: 'border-success/35 bg-[rgba(52,211,153,0.08)]',
  warning: 'border-warning/35 bg-[rgba(251,191,36,0.08)]',
  danger: 'border-danger/35 bg-[rgba(251,113,133,0.08)]',
  info: 'border-info/35 bg-[rgba(96,165,250,0.08)]'
};

const SOURCE_LABELS: Record<Exclude<StarshipTimelineSourceFilter, 'all'>, string> = {
  'll2-cache': 'Launch Library cache',
  'spacex-official': 'SpaceX official',
  'curated-fallback': 'Curated fallback'
};

export function StarshipTimelineExplorer({
  snapshot,
  events,
  selectedEventId,
  defaultSelectedEventId = null,
  onSelectEvent,
  title = 'Timeline explorer',
  emptyLabel = 'No timeline events are available for the selected scope.',
  listAriaLabel = 'Timeline events',
  className,
  initialSourceType = 'all',
  initialIncludeSuperseded = false,
  initialFrom = null,
  initialTo = null,
  onFiltersChange
}: StarshipTimelineExplorerProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const resolvedEvents = useMemo(() => {
    const source = events && events.length > 0 ? [...events] : buildTimelineEvents(snapshot);
    source.sort((a, b) => parseDateOrFallback(a.when) - parseDateOrFallback(b.when));
    return source;
  }, [events, snapshot]);

  const [sourceType, setSourceType] = useState<StarshipTimelineSourceFilter>(initialSourceType);
  const [includeSuperseded, setIncludeSuperseded] = useState(initialIncludeSuperseded);
  const [fromValue, setFromValue] = useState(initialFrom ? initialFrom.slice(0, 10) : '');
  const [toValue, setToValue] = useState(initialTo ? initialTo.slice(0, 10) : '');
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(defaultSelectedEventId);

  const filteredEvents = useMemo(() => {
    return resolvedEvents.filter((event) => {
      if (!includeSuperseded && (event.status === 'superseded' || event.supersededBy)) return false;
      if (sourceType !== 'all' && event.sourceType !== sourceType) return false;

      const eventMs = Date.parse(event.when);
      if (!Number.isNaN(eventMs) && fromValue) {
        const fromMs = Date.parse(`${fromValue}T00:00:00Z`);
        if (!Number.isNaN(fromMs) && eventMs < fromMs) return false;
      }
      if (!Number.isNaN(eventMs) && toValue) {
        const toMs = Date.parse(`${toValue}T23:59:59Z`);
        if (!Number.isNaN(toMs) && eventMs > toMs) return false;
      }
      return true;
    });
  }, [fromValue, includeSuperseded, resolvedEvents, sourceType, toValue]);

  const selectedId = selectedEventId ?? internalSelectedId ?? filteredEvents[0]?.id ?? null;
  const activeIndex = Math.max(0, filteredEvents.length > 0 ? filteredEvents.findIndex((event) => event.id === selectedId) : -1);
  const activeEvent = filteredEvents[activeIndex] || null;
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onFiltersChangeRef = useRef(onFiltersChange);

  useEffect(() => {
    onFiltersChangeRef.current = onFiltersChange;
  }, [onFiltersChange]);

  useEffect(() => {
    const nextFilters: StarshipTimelineFilters = {
      sourceType,
      includeSuperseded,
      from: fromValue ? `${fromValue}T00:00:00.000Z` : null,
      to: toValue ? `${toValue}T23:59:59.999Z` : null
    };
    onFiltersChangeRef.current?.(nextFilters);
  }, [fromValue, includeSuperseded, sourceType, toValue]);

  useEffect(() => {
    if (!filteredEvents.length) return;
    const selectedStillExists = selectedId ? filteredEvents.some((event) => event.id === selectedId) : false;
    if (selectedStillExists) return;
    const next = filteredEvents[0];
    if (!next) return;
    setInternalSelectedId(next.id);
    onSelectEvent?.(next);
  }, [filteredEvents, onSelectEvent, selectedId]);

  useEffect(() => {
    const activeNode = optionRefs.current[activeIndex];
    if (!activeNode) return;
    activeNode.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
  }, [activeIndex, prefersReducedMotion]);

  const sourceTypeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of resolvedEvents) {
      const key = event.sourceType || 'curated-fallback';
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const options: Array<{ value: StarshipTimelineSourceFilter; label: string }> = [
      { value: 'all', label: `All sources (${resolvedEvents.length})` }
    ];

    for (const key of ['ll2-cache', 'spacex-official', 'curated-fallback'] as const) {
      if (!counts.has(key) && key !== sourceType) continue;
      options.push({ value: key, label: `${SOURCE_LABELS[key]} (${counts.get(key) || 0})` });
    }

    return options;
  }, [resolvedEvents, sourceType]);

  const selectEvent = (index: number, shouldFocus: boolean) => {
    const next = filteredEvents[index];
    if (!next) return;
    if (selectedEventId == null) {
      setInternalSelectedId(next.id);
    }
    onSelectEvent?.(next);
    if (shouldFocus) {
      optionRefs.current[index]?.focus();
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!filteredEvents.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      const nextIndex = (index + 1) % filteredEvents.length;
      selectEvent(nextIndex, true);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const nextIndex = (index - 1 + filteredEvents.length) % filteredEvents.length;
      selectEvent(nextIndex, true);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      selectEvent(0, true);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      selectEvent(filteredEvents.length - 1, true);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectEvent(index, false);
    }
  };

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text1">{title}</h3>
        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
          {filteredEvents.length} events
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
          <span className="mb-1 block uppercase tracking-[0.08em]">Source type</span>
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as StarshipTimelineSourceFilter)}
            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
          >
            {sourceTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
          <span className="mb-1 block uppercase tracking-[0.08em]">From</span>
          <input
            type="date"
            value={fromValue}
            onChange={(event) => setFromValue(event.target.value)}
            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
          />
        </label>

        <label className="rounded-lg border border-stroke bg-surface-0 px-2 py-1.5 text-xs text-text3">
          <span className="mb-1 block uppercase tracking-[0.08em]">To</span>
          <input
            type="date"
            value={toValue}
            onChange={(event) => setToValue(event.target.value)}
            className="w-full rounded-md border border-stroke bg-surface-1 px-2 py-1 text-xs text-text1"
          />
        </label>

        <label className="flex items-center gap-2 rounded-lg border border-stroke bg-surface-0 px-2 py-2 text-xs text-text2">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(event) => setIncludeSuperseded(event.target.checked)}
            className="h-4 w-4 rounded border-stroke bg-surface-1"
          />
          Show superseded milestones
        </label>
      </div>

      {filteredEvents.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <>
          <div
            role="listbox"
            aria-label={listAriaLabel}
            aria-activedescendant={activeEvent ? getTimelineOptionId(activeEvent.id) : undefined}
            className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1"
          >
            {filteredEvents.map((event, index) => {
              const isSelected = index === activeIndex;
              return (
                <button
                  key={event.id}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  id={getTimelineOptionId(event.id)}
                  role="option"
                  type="button"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => selectEvent(index, false)}
                  onKeyDown={(keyEvent) => handleOptionKeyDown(keyEvent, index)}
                  className={clsx(
                    'w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                    TONE_CLASS[event.tone || 'default'],
                    isSelected && 'border-primary bg-[rgba(34,211,238,0.12)] shadow-glow'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text1">{event.title}</div>
                      <div className="mt-1 text-xs text-text3">{formatTimelineDate(event.when)}</div>
                    </div>
                    {event.mission ? (
                      <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                        {event.mission}
                      </span>
                    ) : null}
                  </div>
                  {event.summary ? <p className="mt-2 text-xs text-text2">{event.summary}</p> : null}
                </button>
              );
            })}
          </div>

          {activeEvent ? (
            <article className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3" aria-live="polite">
              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Focused event</div>
              <h4 className="mt-1 text-sm font-semibold text-text1">{activeEvent.title}</h4>
              {activeEvent.summary ? <p className="mt-1 text-sm text-text2">{activeEvent.summary}</p> : null}

              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs text-text3 md:grid-cols-2">
                <DetailRow label="event_time" value={formatTimelineDate(activeEvent.eventTime || activeEvent.when)} />
                <DetailRow label="announced_time" value={formatTimelineDate(activeEvent.announcedTime || activeEvent.when)} />
                <DetailRow label="source_type" value={activeEvent.sourceType || 'curated-fallback'} />
                <DetailRow label="confidence" value={activeEvent.confidence || 'low'} />
                <DetailRow label="supersedes" value={formatSupersedes(activeEvent.supersedes)} />
                <DetailRow label="superseded_by" value={activeEvent.supersededBy?.eventId || 'none'} />
              </dl>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stroke bg-surface-1 px-2 py-1">
      <dt className="uppercase tracking-[0.08em]">{label}</dt>
      <dd className="mt-0.5 text-text2">{value}</dd>
    </div>
  );
}

function buildTimelineEvents(snapshot: StarshipSnapshot | undefined): StarshipTimelineEvent[] {
  if (!snapshot) return [];
  const events: StarshipTimelineEvent[] = [];
  const seen = new Set<string>();

  for (const launch of [...snapshot.recent, ...snapshot.upcoming]) {
    const id = launch.id || `${launch.name}:${launch.net}`;
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({
      id,
      title: launch.name,
      when: launch.net,
      summary: `${launch.statusText || launch.status || 'Status pending'} • ${launch.provider} • ${launch.pad?.shortCode || 'Pad TBD'}`,
      mission: launch.mission?.name || undefined,
      tone: toneFromLaunchStatus(launch.status),
      launch,
      status: launch.status,
      eventTime: launch.net,
      announcedTime: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
      sourceType: 'll2-cache',
      sourceLabel: 'Launch Library 2 cache',
      confidence: launch.netPrecision === 'minute' || launch.netPrecision === 'hour' ? 'high' : 'medium',
      supersedes: [],
      supersededBy: null
    });
  }

  if (isMissionSnapshot(snapshot)) {
    snapshot.changes.forEach((change, index) => {
      const id = `change-${index}-${change.date}-${change.title}`;
      if (seen.has(id)) return;
      seen.add(id);
      events.push({
        id,
        title: change.title,
        when: change.date,
        summary: change.summary,
        mission: snapshot.missionName,
        tone: 'info',
        launch: null,
        status: 'tentative',
        eventTime: change.date,
        announcedTime: change.date,
        sourceType: 'curated-fallback',
        sourceLabel: 'Mission change log',
        confidence: 'medium',
        supersedes: [],
        supersededBy: null
      });
    });
  }

  return events;
}

function toneFromLaunchStatus(status: Launch['status'] | undefined): StarshipTimelineEventTone {
  if (status === 'go') return 'success';
  if (status === 'hold') return 'warning';
  if (status === 'scrubbed') return 'danger';
  if (status === 'tbd') return 'info';
  return 'default';
}

function isMissionSnapshot(snapshot: StarshipSnapshot): snapshot is StarshipMissionSnapshot {
  return 'missionName' in snapshot;
}

function formatTimelineDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function parseDateOrFallback(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getTimelineOptionId(eventId: string) {
  return `timeline-event-${eventId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function formatSupersedes(value: StarshipTimelineLink[] | undefined) {
  if (!value || value.length === 0) return 'none';
  return value.map((entry) => (entry.reason ? `${entry.eventId} (${entry.reason})` : entry.eventId)).join(', ');
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return prefersReducedMotion;
}
