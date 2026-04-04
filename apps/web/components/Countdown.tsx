'use client';

import { useMemo } from 'react';
import { buildCountdownSnapshot } from '@tminuszero/domain';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { computeCountdown } from '@/lib/time';

export function Countdown({
  net,
  initialNowMs,
  pastLabel
}: {
  net: string;
  initialNowMs?: number;
  pastLabel?: string | null;
}) {
  const initialNowMsValue =
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
  const nowMs = useSharedNow(1_000, initialNowMsValue);
  const label = useMemo(() => {
    const snapshot = buildCountdownSnapshot(net, nowMs);
    if (snapshot?.isPast && typeof pastLabel === 'string') {
      return pastLabel;
    }
    return computeCountdown(net, nowMs).label;
  }, [net, nowMs, pastLabel]);

  return (
    <span className="inline-block whitespace-nowrap tabular-nums text-lg font-semibold text-text1" suppressHydrationWarning>
      {label}
    </span>
  );
}
