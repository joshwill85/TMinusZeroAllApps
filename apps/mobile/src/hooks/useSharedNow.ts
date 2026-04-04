import { useEffect, useState } from 'react';
import { SharedTicker } from '@tminuszero/domain';

const tickerRegistry = new Map<number, SharedTicker>();

function getTicker(intervalMs: number) {
  const existing = tickerRegistry.get(intervalMs);
  if (existing) {
    return existing;
  }

  const ticker = new SharedTicker(intervalMs);
  tickerRegistry.set(intervalMs, ticker);
  return ticker;
}

export function useSharedNow(intervalMs = 1_000, initialNowMs?: number) {
  const [nowMs, setNowMs] = useState(() =>
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now()
  );

  useEffect(() => {
    const ticker = getTicker(intervalMs);
    return ticker.subscribe((nextNowMs) => {
      setNowMs(nextNowMs);
    });
  }, [intervalMs]);

  return nowMs;
}
