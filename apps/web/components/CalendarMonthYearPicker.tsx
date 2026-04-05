'use client';

import clsx from 'clsx';

const MONTH_OPTIONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export function CalendarMonthYearPicker({
  value,
  onChange,
  today = new Date(),
  compact = false,
  embedded = false
}: {
  value: Date;
  onChange: (next: Date) => void;
  today?: Date;
  compact?: boolean;
  embedded?: boolean;
}) {
  const years = buildYearOptions(value.getFullYear(), today.getFullYear());

  return (
    <div className={clsx(!embedded && 'rounded-2xl border border-stroke bg-surface-0/70', !embedded && (compact ? 'p-3' : 'p-4'))}>
      <div className={clsx('flex flex-col gap-3', compact ? 'sm:flex-row sm:items-end sm:justify-between' : 'lg:flex-row lg:items-end lg:justify-between')}>
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Current view</div>
          <div
            aria-live="polite"
            aria-atomic="true"
            className={clsx('mt-1 font-semibold text-text1', compact ? 'text-lg' : 'text-xl')}
          >
            {formatMonthLabel(value)}
          </div>
          <div className="mt-1 text-xs text-text3">Today is {formatCurrentDate(today)}</div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs uppercase tracking-[0.08em] text-text3">
            <span className="mb-1 block">Month</span>
            <select
              aria-label="Choose calendar month"
              className="w-full rounded-xl border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              value={String(value.getMonth())}
              onChange={(event) => {
                onChange(new Date(value.getFullYear(), Number(event.target.value), 1));
              }}
            >
              {MONTH_OPTIONS.map((monthLabel, index) => (
                <option key={monthLabel} value={index}>
                  {monthLabel}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs uppercase tracking-[0.08em] text-text3">
            <span className="mb-1 block">Year</span>
            <select
              aria-label="Choose calendar year"
              className="w-full rounded-xl border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              value={String(value.getFullYear())}
              onChange={(event) => {
                onChange(new Date(Number(event.target.value), value.getMonth(), 1));
              }}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

function buildYearOptions(viewYear: number, currentYear: number) {
  const start = Math.min(viewYear, currentYear) - 4;
  const end = Math.max(viewYear, currentYear) + 8;

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatCurrentDate(value: Date) {
  return value.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
