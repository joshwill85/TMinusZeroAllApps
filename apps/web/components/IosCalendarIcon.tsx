'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

type IosCalendarIconProps = {
  className?: string;
};

export function IosCalendarIcon({ className }: IosCalendarIconProps) {
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
        'relative inline-flex h-8 w-8 flex-col overflow-hidden rounded-[9px] border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
        className
      )}
    >
      <span className="flex h-[30%] w-full items-center justify-center bg-[#ff3b30] text-[8px] font-semibold uppercase leading-none tracking-[0.08em] text-white">
        {weekday}
      </span>
      <span className="flex flex-1 items-center justify-center text-[14px] font-semibold leading-none text-black tabular-nums">
        {dayLabel}
      </span>
    </span>
  );
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date).toUpperCase();
}
