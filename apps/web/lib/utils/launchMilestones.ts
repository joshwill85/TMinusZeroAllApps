import type { Launch } from '@/lib/types/launch';

type MilestoneOptions = {
  ignoreTimeline?: boolean;
};

export function getLaunchMilestoneEndMs(
  launch: Launch,
  fallbackMs = 0,
  options: MilestoneOptions = {}
): number | null {
  const netMs = Date.parse(launch.net);
  if (!Number.isFinite(netMs)) return null;
  if (options.ignoreTimeline) return netMs + fallbackMs;

  const maxOffsetMs = getMaxTimelineOffsetMs(launch);
  const extensionMs = Math.max(fallbackMs, Math.max(0, maxOffsetMs ?? 0));
  return netMs + extensionMs;
}

export function isLaunchWithinMilestoneWindow(
  launch: Launch,
  nowMs: number,
  fallbackMs = 0,
  options: MilestoneOptions = {}
): boolean {
  const netMs = Date.parse(launch.net);
  if (!Number.isFinite(netMs)) return true;
  if (netMs >= nowMs) return true;
  const endMs = getLaunchMilestoneEndMs(launch, fallbackMs, options);
  if (endMs == null) return false;
  return nowMs < endMs;
}

export function parseIsoDurationToMs(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  const ms = totalSeconds * 1000;
  return negative ? -ms : ms;
}

function getMaxTimelineOffsetMs(launch: Launch): number | null {
  const raw = Array.isArray(launch.timeline) ? launch.timeline : [];
  let max = Number.NEGATIVE_INFINITY;

  raw.forEach((event) => {
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null) return;
    if (offsetMs > max) max = offsetMs;
  });

  return max === Number.NEGATIVE_INFINITY ? null : max;
}
