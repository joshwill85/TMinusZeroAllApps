'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { isDateOnlyNet } from '@/lib/time';
import type { NewsStreamLaunch } from '@/lib/types/news';

type TelemetryCountdownProps = {
  net: string | null;
  netPrecision: NewsStreamLaunch['netPrecision'];
  initialNowMs?: number;
  className?: string;
};

export function TelemetryCountdown({ net, netPrecision, initialNowMs, className }: TelemetryCountdownProps) {
  const dateOnly = useMemo(() => {
    if (!net) return true;
    return isDateOnlyNet(net, netPrecision ?? undefined);
  }, [net, netPrecision]);

  const netMs = useMemo(() => {
    if (!net) return null;
    const parsed = Date.parse(net);
    return Number.isFinite(parsed) ? parsed : null;
  }, [net]);

  const nowMs = useSharedNow(1_000, initialNowMs);
  const label = useMemo(() => computeCountdownLabel(net, dateOnly, nowMs), [dateOnly, net, nowMs]);

  return (
    <span className={clsx('font-mono text-xs tabular-nums text-text1', className)}>
      {label}
    </span>
  );
}

function computeCountdownLabel(netIso: string | null, dateOnly: boolean, nowMs?: number) {
  if (!netIso) return 'NET TBD';
  if (dateOnly) return 'TIME TBD';

  const netMs = Date.parse(netIso);
  if (!Number.isFinite(netMs)) return 'NET TBD';

  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const diffSeconds = Math.round((netMs - now) / 1000);
  const absSeconds = Math.max(0, Math.abs(diffSeconds));
  const days = Math.floor(absSeconds / 86400);
  const hours = Math.floor((absSeconds % 86400) / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;

  const prefix = diffSeconds >= 0 ? 'T-' : 'T+';
  if (days > 0) {
    return `${prefix}${days}d ${hours.toString().padStart(2, '0')}h`;
  }

  return `${prefix}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}
