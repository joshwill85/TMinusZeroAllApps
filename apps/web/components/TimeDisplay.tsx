'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDateOnly, formatNetLabel, isDateOnlyNet } from '@/lib/time';
import { Launch } from '@/lib/types/launch';

export function TimeDisplay({
  net,
  netPrecision
}: {
  net: string;
  netPrecision: Launch['netPrecision'];
}) {
  const [userTz, setUserTz] = useState('UTC');

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setUserTz(tz);
  }, []);

  const isDateOnly = isDateOnlyNet(net, netPrecision, userTz);
  const tz = userTz;
  const dateTime = useMemo(() => {
    const date = new Date(net);
    if (Number.isNaN(date.getTime())) return undefined;
    const iso = date.toISOString();
    return isDateOnly ? iso.slice(0, 10) : iso;
  }, [isDateOnly, net]);

  if (isDateOnly) {
    return (
      <div className="flex items-center gap-2 text-sm text-text2">
        <div className="font-semibold text-text1">
          <abbr title="No Earlier Than (earliest possible launch time)" className="no-underline">
            NET
          </abbr>{' '}
          <time dateTime={dateTime}>{formatDateOnly(net, tz)}</time>
        </div>
        <span className="rounded-full bg-[rgba(234,240,255,0.05)] px-2 py-1 text-xs text-text3">Time TBD</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm text-text2">
      <div className="flex flex-col">
        <time dateTime={dateTime} className="font-semibold text-text1">
          {formatDateOnly(net, tz)}, {formatNetLabel(net, tz)}
        </time>
      </div>
    </div>
  );
}
