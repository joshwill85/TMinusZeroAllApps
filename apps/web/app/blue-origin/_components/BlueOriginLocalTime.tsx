'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatLaunchDate } from '@/lib/utils/formatters';

type BlueOriginLocalTimeProps = {
  value: string | null | undefined;
  variant?: 'date' | 'dateTime';
  className?: string;
  fallback?: string;
};

export function BlueOriginLocalTime({
  value,
  variant = 'dateTime',
  className,
  fallback
}: BlueOriginLocalTimeProps) {
  const [timeZone, setTimeZone] = useState('UTC');

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimeZone(detected);
  }, []);

  const formatted = useMemo(() => {
    if (variant === 'date') {
      return formatLaunchDate(value, {
        timeZone,
        fallback: fallback ?? 'Date TBD'
      });
    }
    return formatDateTime(value, {
      timeZone,
      fallback: fallback ?? 'N/A'
    });
  }, [fallback, timeZone, value, variant]);

  const dateTimeAttr = useMemo(() => {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }, [value]);

  return (
    <time dateTime={dateTimeAttr} className={className} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
