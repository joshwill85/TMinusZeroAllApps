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

export type CalendarLaunchFilterValue = Pick<
  LaunchFilterValue,
  'region' | 'location' | 'state' | 'pad' | 'provider' | 'status'
>;

export const DEFAULT_LAUNCH_FILTERS: LaunchFilterValue = {
  range: 'year',
  sort: 'soonest',
  region: 'us'
};

export const DEFAULT_LAUNCH_FILTER_HELP_TEXT =
  'Default view keeps Next 12 months and US only selected.';

export const DEFAULT_CALENDAR_LAUNCH_FILTERS: CalendarLaunchFilterValue = {
  region: DEFAULT_LAUNCH_FILTERS.region
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

export function normalizeCalendarLaunchFilterValue(
  value: unknown
): CalendarLaunchFilterValue {
  const normalized = normalizeLaunchFilterValue(value);
  const next: CalendarLaunchFilterValue = {};

  if (normalized.region) next.region = normalized.region;
  if (normalized.location) next.location = normalized.location;
  if (normalized.state) next.state = normalized.state;
  if (normalized.pad) next.pad = normalized.pad;
  if (normalized.provider) next.provider = normalized.provider;
  if (normalized.status && normalized.status !== 'all') {
    next.status = normalized.status;
  }

  return next;
}

export function areCalendarLaunchFilterValuesEqual(
  a: CalendarLaunchFilterValue | LaunchFilterValue,
  b: CalendarLaunchFilterValue | LaunchFilterValue
) {
  const left = normalizeCalendarLaunchFilterValue(a);
  const right = normalizeCalendarLaunchFilterValue(b);

  return (
    (left.region ?? DEFAULT_LAUNCH_FILTERS.region) ===
      (right.region ?? DEFAULT_LAUNCH_FILTERS.region) &&
    (left.location ?? undefined) === (right.location ?? undefined) &&
    (left.state ?? undefined) === (right.state ?? undefined) &&
    (left.pad ?? undefined) === (right.pad ?? undefined) &&
    (left.provider ?? undefined) === (right.provider ?? undefined) &&
    (left.status ?? undefined) === (right.status ?? undefined)
  );
}

export function countActiveCalendarLaunchFilters(
  filters: CalendarLaunchFilterValue | LaunchFilterValue
) {
  const normalized = normalizeCalendarLaunchFilterValue(filters);
  let count = 0;

  if (
    (normalized.region ?? DEFAULT_LAUNCH_FILTERS.region) !==
    DEFAULT_LAUNCH_FILTERS.region
  ) {
    count += 1;
  }
  if (normalized.location) count += 1;
  if (normalized.state) count += 1;
  if (normalized.pad) count += 1;
  if (normalized.provider) count += 1;
  if (normalized.status) count += 1;

  return count;
}

export function buildFeedPresetFiltersFromCalendarFilters(
  filters: CalendarLaunchFilterValue | LaunchFilterValue
): LaunchFilterValue {
  const normalized = normalizeCalendarLaunchFilterValue(filters);

  return {
    range: DEFAULT_LAUNCH_FILTERS.range,
    sort: DEFAULT_LAUNCH_FILTERS.sort,
    region: normalized.region ?? DEFAULT_LAUNCH_FILTERS.region,
    ...(normalized.location ? { location: normalized.location } : {}),
    ...(normalized.state ? { state: normalized.state } : {}),
    ...(normalized.pad ? { pad: normalized.pad } : {}),
    ...(normalized.provider ? { provider: normalized.provider } : {}),
    ...(normalized.status ? { status: normalized.status } : {})
  };
}

export function mergeFeedPresetFiltersWithCalendarFilters(
  existingFilters: unknown,
  filters: CalendarLaunchFilterValue | LaunchFilterValue
): LaunchFilterValue {
  const existing = normalizeLaunchFilterValue(existingFilters);
  const normalized = normalizeCalendarLaunchFilterValue(filters);

  return {
    range: existing.range ?? DEFAULT_LAUNCH_FILTERS.range,
    sort: existing.sort ?? DEFAULT_LAUNCH_FILTERS.sort,
    region:
      normalized.region ??
      existing.region ??
      DEFAULT_LAUNCH_FILTERS.region,
    ...(normalized.location ? { location: normalized.location } : {}),
    ...(normalized.state ? { state: normalized.state } : {}),
    ...(normalized.pad ? { pad: normalized.pad } : {}),
    ...(normalized.provider ? { provider: normalized.provider } : {}),
    ...(normalized.status ? { status: normalized.status } : {})
  };
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
