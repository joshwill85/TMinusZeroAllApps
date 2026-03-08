'use client';

import { useMemo } from 'react';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { computeCountdown } from '@/lib/time';

export function Countdown({ net }: { net: string }) {
  const nowMs = useSharedNow(1_000);
  const label = useMemo(() => computeCountdown(net, nowMs).label, [net, nowMs]);

  return <span className="text-lg font-semibold text-text1">{label}</span>;
}
