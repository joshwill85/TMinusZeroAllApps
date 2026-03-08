export type CountdownSnapshot = {
  totalMs: number;
  isPast: boolean;
};

export function buildCountdownSnapshot(targetIso: string | null, nowMs = Date.now()): CountdownSnapshot | null {
  if (!targetIso) {
    return null;
  }

  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs)) {
    return null;
  }

  const totalMs = targetMs - nowMs;
  return {
    totalMs,
    isPast: totalMs < 0
  };
}

export { SharedTicker } from './ticker';
