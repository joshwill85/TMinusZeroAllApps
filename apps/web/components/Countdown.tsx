'use client';

import { useMemo } from 'react';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { computeCountdown } from '@/lib/time';

export function Countdown({ net, initialNowMs }: { net: string; initialNowMs?: number }) {
  const initialNowMsValue =
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
  const nowMs = useSharedNow(1_000, initialNowMsValue);
  const label = useMemo(() => computeCountdown(net, nowMs).label, [net, nowMs]);

  return (
    <span className="text-lg font-semibold text-text1" suppressHydrationWarning>
      {label}
    </span>
  );
}
