'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

type CalendarBadgeProps = {
  className?: string;
};

export function CalendarBadge({ className }: CalendarBadgeProps) {
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    setToday(new Date());
  }, []);

  useEffect(() => {
    if (!today) return;
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const timeout = window.setTimeout(() => setToday(new Date()), nextMidnight.getTime() - now.getTime() + 1000);
    return () => window.clearTimeout(timeout);
  }, [today]);

  const weekday = useMemo(() => (today ? formatWeekday(today) : '---'), [today]);
  const dayLabel = today ? String(today.getDate()) : '--';

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'relative inline-flex h-8 w-8 flex-col overflow-hidden rounded-[10px] border border-stroke bg-surface-0 shadow-[0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      <span className="flex h-[32%] w-full items-center justify-center bg-[rgba(34,211,238,0.14)] text-[8px] font-semibold uppercase leading-none tracking-[0.08em] text-primary">
        {weekday}
      </span>
      <span className="flex flex-1 items-center justify-center text-[14px] font-semibold leading-none text-text1 tabular-nums">
        {dayLabel}
      </span>
    </span>
  );
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date).toUpperCase();
}
