type DateFormatOptions = {
  timeZone?: string;
  fallback?: string;
};

export function formatLaunchDate(value: string | null | undefined, options?: DateFormatOptions) {
  const fallback = options?.fallback ?? 'Date TBD';
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    ...(options?.timeZone ? { timeZone: options.timeZone } : {})
  }).format(new Date(parsed));
}

export function formatUsdAmount(value: number | null | undefined) {
  if (value == null) return 'Amount TBD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

export function formatPercent(value: number) {
  const bounded = Math.min(1, Math.max(0, value));
  return `${Math.round(bounded * 100)}%`;
}

export function formatDateTime(value: string | null | undefined, options?: DateFormatOptions) {
  const fallback = options?.fallback ?? 'N/A';
  if (!value) return fallback;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(options?.timeZone ? { timeZone: options.timeZone } : {})
  }).format(new Date(parsed));
}
