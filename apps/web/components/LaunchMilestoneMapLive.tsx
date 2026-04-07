'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

type MilestoneEvent = {
  id: string;
  label: string;
  description?: string;
  relativeLabel?: string;
  absoluteLabel?: string;
  absoluteMs?: number | null;
};

export function LaunchMilestoneMapLive({
  events,
  launchNetMs
}: {
  events: MilestoneEvent[];
  launchNetMs?: number | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const now = Date.now();
      setNowMs(now);
      const delay = 1000 - (now % 1000);
      timer = setTimeout(schedule, delay > 0 ? delay : 1000);
    };

    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const orderedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      if (a.absoluteMs == null && b.absoluteMs == null) return 0;
      if (a.absoluteMs == null) return 1;
      if (b.absoluteMs == null) return -1;
      return a.absoluteMs - b.absoluteMs;
    });
  }, [events]);

  const hasLaunched = launchNetMs != null && Number.isFinite(launchNetMs) ? nowMs >= launchNetMs : false;

  const nextEvent = useMemo(() => {
    return orderedEvents.reduce<MilestoneEvent | null>((acc, event) => {
      if (event.absoluteMs == null || event.absoluteMs < nowMs) return acc;
      if (!acc || (acc.absoluteMs != null && event.absoluteMs < acc.absoluteMs)) return event;
      return acc;
    }, null);
  }, [orderedEvents, nowMs]);

  const decoratedEvents = useMemo(
    () =>
      orderedEvents.map((event) => ({
        ...event,
        isNext: nextEvent ? event.id === nextEvent.id : false,
        isPast: hasLaunched && event.absoluteMs != null ? event.absoluteMs < nowMs : false
      })),
    [hasLaunched, nextEvent, nowMs, orderedEvents]
  );

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Launch sequence</div>
          <h2 className="text-xl font-semibold text-text1">Mission timeline</h2>
          <p className="text-sm text-text3">
            {hasLaunched
              ? 'Live timeline cues are highlighted across the sequence.'
              : 'Deduped milestones from official resources and launch timeline data.'}
          </p>
        </div>
        {nextEvent && (
          <div className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
            <div className="text-[10px] uppercase tracking-[0.12em] text-primary/80">Next event</div>
            <div className="text-sm font-semibold text-text1">{nextEvent.label}</div>
            {nextEvent.relativeLabel && <div className="text-[11px] text-primary/90">{nextEvent.relativeLabel}</div>}
          </div>
        )}
      </div>
      <div className="relative mt-4 overflow-hidden rounded-xl border border-stroke bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_55%)] p-4">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(255,255,255,0.08),_transparent_55%)]" aria-hidden="true" />
        <div className="relative max-h-80 overflow-y-auto pr-2">
          <div className="absolute bottom-3 left-4 top-3 w-px bg-gradient-to-b from-primary/60 via-white/10 to-transparent" aria-hidden="true" />
          <ul className="space-y-3 pl-8">
            {decoratedEvents.map((event) => (
              <li key={event.id} className="relative">
                <span
                  className={clsx(
                    'absolute -left-[26px] top-3 h-2.5 w-2.5 rounded-full',
                    event.isNext ? 'bg-primary shadow-glow' : event.isPast ? 'bg-white/40' : 'bg-white/20'
                  )}
                />
                <div
                  className={clsx(
                    'rounded-lg border px-3 py-2',
                    event.isNext
                      ? 'border-primary/60 bg-primary/10'
                      : event.isPast
                        ? 'border-white/5 bg-white/[0.02] opacity-70'
                        : 'border-white/10 bg-white/[0.02]'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-text3">
                    {event.relativeLabel && <span className="font-mono text-text2">{event.relativeLabel}</span>}
                    {event.absoluteLabel && <span>{event.absoluteLabel}</span>}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-text1">{event.label}</div>
                  {event.description && <div className="mt-1 text-xs text-text3">{event.description}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {!hasLaunched && (
        <div className="mt-2 text-[11px] text-text3">
          Entries are merged from official resources and launch timeline data before liftoff confirms progress.
        </div>
      )}
    </section>
  );
}
