import { buildCountdownSnapshot, formatLaunchCountdownClock } from '@tminuszero/domain';
import { useSharedNow } from '@/src/hooks/useSharedNow';

type CountdownTextOptions = {
  fallback?: string;
  pastLabel?: string | null;
};

type LiveLaunchCountdownProps = CountdownTextOptions & {
  net: string | null | undefined;
};

const DEFAULT_FALLBACK = 'NET TBD';

export function buildLaunchCountdownDisplay(
  net: string | null | undefined,
  nowMs = Date.now(),
  options: CountdownTextOptions = {}
) {
  const snapshot = buildCountdownSnapshot(net ?? null, nowMs);
  if (!snapshot) return options.fallback ?? DEFAULT_FALLBACK;
  if (snapshot.isPast && typeof options.pastLabel === 'string') {
    return options.pastLabel;
  }
  return formatLaunchCountdownClock(snapshot.totalMs);
}

export function buildLaunchCountdownLabel(net: string | null | undefined, nowMs = Date.now(), fallback = DEFAULT_FALLBACK) {
  const snapshot = buildCountdownSnapshot(net ?? null, nowMs);
  if (!snapshot) return fallback;

  const totalMinutes = Math.round(Math.abs(snapshot.totalMs) / 60_000);
  if (totalMinutes >= 24 * 60) {
    const days = Math.round(totalMinutes / (24 * 60));
    return snapshot.isPast ? `${days}d since liftoff` : `${days}d to launch`;
  }
  if (totalMinutes >= 60) {
    const hours = Math.round(totalMinutes / 60);
    return snapshot.isPast ? `${hours}h since liftoff` : `${hours}h to launch`;
  }
  return snapshot.isPast ? `${totalMinutes}m since liftoff` : `${totalMinutes}m to launch`;
}

export function LiveLaunchCountdownClock({ net, fallback = DEFAULT_FALLBACK, pastLabel }: LiveLaunchCountdownProps) {
  const nowMs = useSharedNow();
  return buildLaunchCountdownDisplay(net, nowMs, { fallback, pastLabel });
}

export function LiveLaunchCountdownLabel({ net, fallback = DEFAULT_FALLBACK }: LiveLaunchCountdownProps) {
  const nowMs = useSharedNow();
  return buildLaunchCountdownLabel(net, nowMs, fallback);
}
