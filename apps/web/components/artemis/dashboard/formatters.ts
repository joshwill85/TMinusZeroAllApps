import { isDateOnlyNet } from '@/lib/time';
import type { Launch } from '@/lib/types/launch';

export function formatUpdatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

export function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
    : {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatCurrencyCompact(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 1,
    notation: 'compact',
    compactDisplay: 'short'
  }).format(value);
}

export function formatCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

export function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

export function isRenderableImageUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
