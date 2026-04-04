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

export function formatLaunchCountdownClock(totalMs: number) {
  const totalSeconds = Math.max(0, Math.floor(Math.abs(totalMs) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const prefix = totalMs < 0 ? 'T+' : 'T-';
  const clock = `${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`;

  return days > 0 ? `${prefix}${days}d ${clock}` : `${prefix}${clock}`;
}

function padNumber(value: number) {
  return String(Math.max(0, value)).padStart(2, '0');
}
