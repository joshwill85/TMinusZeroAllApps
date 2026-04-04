'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import {
  getCalendarDayTemporalState,
  getCalendarLaunchMarkerState,
  type CalendarDayTemporalState,
  type CalendarLaunchMarkerState
} from '@tminuszero/domain';

type CalendarDayTileProps = {
  dayKey: string;
  dayNumber: number;
  launchCount: number;
  isCurrentMonth: boolean;
  isSelected?: boolean;
  ariaLabel: string;
  onClick: () => void;
  compact?: boolean;
};

export function CalendarDayTile({
  dayKey,
  dayNumber,
  launchCount,
  isCurrentMonth,
  isSelected = false,
  ariaLabel,
  onClick,
  compact = false
}: CalendarDayTileProps) {
  const dayState = getCalendarDayTemporalState(dayKey) ?? 'future';
  const markerState = getCalendarLaunchMarkerState(dayKey, launchCount);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={clsx(
        'group relative isolate aspect-square overflow-hidden rounded-[22px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
        isCurrentMonth ? 'opacity-100' : 'opacity-[0.55]',
        resolveTileTone(dayState, isSelected)
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))] opacity-0 transition',
          (isSelected || dayState === 'today') && 'opacity-100'
        )}
      />

      <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className={clsx(resolveNumberSize(dayNumber, compact), resolveNumberTone(dayState, isCurrentMonth))}>{dayNumber}</span>
      </span>

      <span className={clsx('relative flex h-full flex-col justify-between', compact ? 'p-2.5 sm:p-3' : 'p-3')}>
        <span className="flex justify-end">
          {launchCount > 0 ? <CalendarLaunchCountBadge count={launchCount} markerState={markerState} /> : null}
        </span>

        <span className="flex min-h-[20px] items-end justify-center">
          {markerState !== 'none' ? <CalendarDayMarker state={markerState} count={launchCount} compact={compact} /> : null}
        </span>
      </span>
    </button>
  );
}

export function CalendarStateLegend({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-3 text-[11px] font-medium text-text3', className)}>
      <CalendarLegendItem label="Past launches" marker={<CalendarDayMarker state="past" count={1} compact />} />
      <CalendarLegendItem label="Today" marker={<CalendarDayMarker state="today" count={1} compact />} />
      <CalendarLegendItem label="Upcoming launches" marker={<CalendarDayMarker state="future" count={3} compact />} />
    </div>
  );
}

function CalendarLegendItem({ marker, label }: { marker: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-stroke bg-surface-0/60 px-2.5 py-1">
      {marker}
      <span>{label}</span>
    </span>
  );
}

function CalendarLaunchCountBadge({
  count,
  markerState
}: {
  count: number;
  markerState: CalendarLaunchMarkerState;
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'inline-flex min-w-[1.7rem] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
        resolveCountTone(markerState)
      )}
    >
      {count}
    </span>
  );
}

function CalendarDayMarker({
  state,
  count,
  compact = false
}: {
  state: Exclude<CalendarLaunchMarkerState, 'none'>;
  count: number;
  compact?: boolean;
}) {
  if (state === 'future') {
    const dots = Math.min(Math.max(count, 1), 3);
    return (
      <span aria-hidden="true" className={clsx('inline-flex items-center justify-center gap-1', compact ? 'min-h-[12px]' : 'min-h-[14px]')}>
        {Array.from({ length: dots }).map((_, index) => (
          <span
            key={`${state}-${index}`}
            className={clsx('rounded-full bg-[rgba(34,211,238,0.92)] shadow-[0_0_10px_rgba(34,211,238,0.35)]', compact ? 'h-1.5 w-1.5' : 'h-2 w-2')}
          />
        ))}
      </span>
    );
  }

  if (state === 'past') {
    return (
      <span
        aria-hidden="true"
        className={clsx(
          'inline-flex items-center justify-center rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.8)]',
          compact ? 'h-4 w-4' : 'h-5 w-5'
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className={clsx(compact ? 'h-2.5 w-2.5' : 'h-3 w-3')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 5.5" />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={clsx('relative inline-flex items-center justify-center', compact ? 'h-4 w-4' : 'h-5 w-5')}
    >
      <span className="absolute inset-0 rounded-full border border-[rgba(34,211,238,0.7)]" />
      <span className="absolute inset-[3px] rounded-full border border-[rgba(34,211,238,0.4)]" />
      <span className={clsx('rounded-full bg-primary shadow-[0_0_14px_rgba(34,211,238,0.55)]', compact ? 'h-1 w-1' : 'h-1.5 w-1.5')} />
    </span>
  );
}

function resolveTileTone(dayState: CalendarDayTemporalState, isSelected: boolean) {
  if (dayState === 'today') {
    return clsx(
      'border-[rgba(34,211,238,0.55)] bg-[radial-gradient(circle_at_50%_22%,rgba(34,211,238,0.18),rgba(34,211,238,0.05)_58%,rgba(255,255,255,0.03))] shadow-[0_0_0_1px_rgba(34,211,238,0.12),0_18px_36px_rgba(34,211,238,0.08)]',
      isSelected && 'ring-1 ring-inset ring-[rgba(255,255,255,0.18)]'
    );
  }

  if (dayState === 'past') {
    return clsx(
      'border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]',
      isSelected ? 'border-[rgba(34,211,238,0.35)] ring-1 ring-inset ring-[rgba(255,255,255,0.12)]' : 'hover:border-[rgba(255,255,255,0.14)]'
    );
  }

  return clsx(
    'border-stroke bg-[rgba(255,255,255,0.03)] hover:border-[rgba(34,211,238,0.35)]',
    isSelected && 'border-[rgba(34,211,238,0.4)] bg-[rgba(34,211,238,0.1)] ring-1 ring-inset ring-[rgba(255,255,255,0.14)]'
  );
}

function resolveNumberSize(dayNumber: number, compact: boolean) {
  if (compact) {
    return clsx('font-semibold leading-none tracking-[-0.08em]', dayNumber >= 10 ? 'text-[3rem] sm:text-[3.15rem]' : 'text-[3.4rem] sm:text-[3.55rem]');
  }

  return clsx('font-semibold leading-none tracking-[-0.08em]', dayNumber >= 10 ? 'text-[3.8rem] md:text-[4.25rem]' : 'text-[4.3rem] md:text-[4.8rem]');
}

function resolveNumberTone(dayState: CalendarDayTemporalState, isCurrentMonth: boolean) {
  if (!isCurrentMonth) return 'text-[rgba(233,240,255,0.08)]';
  if (dayState === 'today') return 'text-[rgba(34,211,238,0.3)]';
  if (dayState === 'past') return 'text-[rgba(233,240,255,0.14)]';
  return 'text-[rgba(233,240,255,0.18)]';
}

function resolveCountTone(markerState: CalendarLaunchMarkerState) {
  if (markerState === 'past') return 'border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.07)] text-text2';
  if (markerState === 'today') return 'border-[rgba(34,211,238,0.3)] bg-[rgba(34,211,238,0.14)] text-primary';
  return 'border-[rgba(34,211,238,0.2)] bg-[rgba(34,211,238,0.1)] text-primary';
}
