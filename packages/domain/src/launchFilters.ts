export const LAUNCH_FILTER_RANGE_OPTIONS = ['today', '7d', 'month', 'year', 'past', 'all'] as const;
export const LAUNCH_FILTER_REGION_OPTIONS = ['us', 'non-us', 'all'] as const;
export const LAUNCH_FILTER_SORT_OPTIONS = ['soonest', 'latest', 'changed'] as const;
export const LAUNCH_FILTER_STATUS_OPTIONS = ['go', 'hold', 'scrubbed', 'tbd', 'unknown', 'all'] as const;

export type LaunchFilterRange = (typeof LAUNCH_FILTER_RANGE_OPTIONS)[number];
export type LaunchFilterRegion = (typeof LAUNCH_FILTER_REGION_OPTIONS)[number];
export type LaunchFilterSort = (typeof LAUNCH_FILTER_SORT_OPTIONS)[number];
export type LaunchFilterStatus = (typeof LAUNCH_FILTER_STATUS_OPTIONS)[number];

export type LaunchFilterValue = {
  range?: LaunchFilterRange;
  sort?: LaunchFilterSort;
  region?: LaunchFilterRegion;
  location?: string;
  state?: string;
  pad?: string;
  provider?: string;
  status?: LaunchFilterStatus;
};

export type LaunchFilterOptions = {
  providers: string[];
  locations: string[];
  states: string[];
  pads: string[];
  statuses: string[];
};

export const DEFAULT_LAUNCH_FILTERS: LaunchFilterValue = {
  range: 'year',
  sort: 'soonest',
  region: 'us'
};

function readAllowedValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function normalizeLaunchFilterValue(value: unknown): LaunchFilterValue {
  const source = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const next: LaunchFilterValue = {};

  const range = readAllowedValue(source.range, LAUNCH_FILTER_RANGE_OPTIONS);
  const region = readAllowedValue(source.region, LAUNCH_FILTER_REGION_OPTIONS);
  const sort = readAllowedValue(source.sort, LAUNCH_FILTER_SORT_OPTIONS);
  const status = readAllowedValue(source.status, LAUNCH_FILTER_STATUS_OPTIONS);
  const location = typeof source.location === 'string' ? source.location.trim() : '';
  const state = typeof source.state === 'string' ? source.state.trim() : '';
  const pad = typeof source.pad === 'string' ? source.pad.trim() : '';
  const provider = typeof source.provider === 'string' ? source.provider.trim() : '';

  if (range) next.range = range;
  if (region) next.region = region;
  if (sort) next.sort = sort;
  if (status) next.status = status;
  if (location) next.location = location;
  if (state) next.state = state;
  if (pad) next.pad = pad;
  if (provider) next.provider = provider;

  return next;
}

export function areLaunchFilterValuesEqual(a: LaunchFilterValue, b: LaunchFilterValue) {
  return (
    (a.range ?? undefined) === (b.range ?? undefined) &&
    (a.region ?? undefined) === (b.region ?? undefined) &&
    (a.sort ?? undefined) === (b.sort ?? undefined) &&
    (a.status ?? undefined) === (b.status ?? undefined) &&
    (a.location ?? undefined) === (b.location ?? undefined) &&
    (a.state ?? undefined) === (b.state ?? undefined) &&
    (a.pad ?? undefined) === (b.pad ?? undefined) &&
    (a.provider ?? undefined) === (b.provider ?? undefined)
  );
}

export function countActiveLaunchFilters(filters: LaunchFilterValue) {
  let count = 0;
  if ((filters.range ?? DEFAULT_LAUNCH_FILTERS.range) !== DEFAULT_LAUNCH_FILTERS.range) count += 1;
  if ((filters.region ?? DEFAULT_LAUNCH_FILTERS.region) !== DEFAULT_LAUNCH_FILTERS.region) count += 1;
  if ((filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort) !== DEFAULT_LAUNCH_FILTERS.sort) count += 1;
  if (filters.location) count += 1;
  if (filters.state) count += 1;
  if (filters.provider) count += 1;
  if (filters.pad) count += 1;
  if (filters.status && filters.status !== 'all') count += 1;
  return count;
}

export function formatLaunchFilterLocationOptionLabel(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return value;
  const idx = trimmed.indexOf(',');
  if (idx <= 0) return trimmed;
  return trimmed.slice(0, idx).trim();
}

export function formatLaunchFilterStatusLabel(value: string) {
  if (value === 'tbd') return 'TBD';
  if (value === 'go') return 'Go';
  if (value === 'hold') return 'Hold';
  if (value === 'scrubbed') return 'Scrubbed';
  if (value === 'unknown') return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
