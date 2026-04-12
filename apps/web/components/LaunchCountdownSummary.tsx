'use client';

import { useMemo } from 'react';
import { buildCountdownSnapshot } from '@tminuszero/domain';
import { useSharedNow } from '@/lib/client/useSharedNow';
import { computeCountdown, formatDateOnly, formatLaunchMoment, isDateOnlyNet } from '@/lib/time';
import { useResolvedTimeZone } from '@/lib/hooks/useResolvedTimeZone';
import type { Launch } from '@/lib/types/launch';
import { LaunchTimingInfoButton } from './LaunchTimingInfoButton';

type LaunchCountdownSummaryProps = {
  net: string;
  netPrecision: Launch['netPrecision'];
  padTimeZone?: string | null;
  initialNowMs?: number;
};

export function LaunchCountdownSummary({
  net,
  netPrecision,
  padTimeZone,
  initialNowMs
}: LaunchCountdownSummaryProps) {
  const initialNowMsValue =
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
  const nowMs = useSharedNow(1_000, initialNowMsValue);
  const fallbackPadTimeZone = String(padTimeZone || '').trim() || 'America/New_York';
  const displayTimeZone = useResolvedTimeZone(fallbackPadTimeZone);
  const dateOnly = isDateOnlyNet(net, netPrecision, displayTimeZone);

  const countdownLabel = useMemo(() => {
    const snapshot = buildCountdownSnapshot(net, nowMs);
    if (!snapshot) return 'TBD';
    return computeCountdown(net, nowMs).label;
  }, [net, nowMs]);

  const dateLabel = useMemo(() => {
    if (dateOnly) {
      return formatDateOnly(net, displayTimeZone);
    }
    return formatLaunchMoment(net, displayTimeZone, netPrecision, { includeTimeTbd: false });
  }, [dateOnly, displayTimeZone, net, netPrecision]);

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {dateOnly ? 'Launch window' : 'T- countdown'}
      </div>
      <div className="flex min-w-0 items-center justify-center gap-2 overflow-hidden">
        {dateOnly ? (
          <span className="rounded-full bg-[rgba(234,240,255,0.05)] px-3 py-1 text-xs font-semibold text-text2">Time TBD</span>
        ) : (
          <span className="font-mono text-lg font-semibold tabular-nums text-text1">{countdownLabel}</span>
        )}
        <span className="max-w-[34vw] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-text2 sm:max-w-none sm:text-xs">
          {dateLabel}
        </span>
        <LaunchTimingInfoButton
          net={net}
          netPrecision={netPrecision}
          padTimeZone={fallbackPadTimeZone}
          countdownLabel={countdownLabel}
          align="center"
        />
      </div>
    </div>
  );
}
