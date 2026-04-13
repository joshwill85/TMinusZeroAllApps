'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { getCalendarDayTemporalState, type CalendarDayTemporalState } from '@tminuszero/domain';

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

      <span className={clsx('relative flex h-full flex-col', compact ? 'p-2.5 sm:p-3' : 'p-3')}>
        <span className="mt-auto flex min-h-[20px] items-end justify-center">
          {launchCount > 0 ? (
            <CalendarDayMarker
              count={launchCount}
              compact={compact}
              dayState={dayState}
            />
          ) : null}
        </span>
      </span>
    </button>
  );
}

export function CalendarStateLegend({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-3 text-[11px] font-medium text-text3', className)}>
      <CalendarLegendItem
        label="Upcoming launch days"
        marker={<CalendarDayMarker count={3} compact dayState="future" />}
      />
      <CalendarLegendItem
        label="Past launch days"
        marker={<CalendarDayMarker count={3} compact dayState="past" />}
      />
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

function CalendarDayMarker({
  count,
  compact = false,
  dayState = 'future'
}: {
  count: number;
  compact?: boolean;
  dayState?: CalendarDayTemporalState;
}) {
  const dots = Math.min(Math.max(count, 1), 3);
  return (
    <span aria-hidden="true" className={clsx('inline-flex items-center justify-center gap-1', compact ? 'min-h-[12px]' : 'min-h-[14px]')}>
      {Array.from({ length: dots }).map((_, index) => (
        <span
          key={`launch-dot-${index}`}
          className={clsx(
            'rounded-full',
            dayState === 'past'
              ? 'bg-[rgba(74,222,128,0.52)] shadow-[0_0_8px_rgba(74,222,128,0.18)]'
              : 'bg-[rgba(34,211,238,0.92)] shadow-[0_0_10px_rgba(34,211,238,0.35)]',
            compact ? 'h-1.5 w-1.5' : 'h-2 w-2'
          )}
        />
      ))}
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
