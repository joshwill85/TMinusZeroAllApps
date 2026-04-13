'use client';

import type { LaunchFeedV1, WatchlistV1 } from '@tminuszero/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  areCalendarLaunchFilterValuesEqual,
  buildCalendarMonthDays,
  buildCountdownSnapshot,
  buildFeedPresetFiltersFromCalendarFilters,
  countActiveCalendarLaunchFilters,
  DEFAULT_CALENDAR_LAUNCH_FILTERS,
  formatLaunchFilterStatusLabel,
  formatLaunchCountdownClock,
  getCalendarDayTemporalState,
  getCalendarMonthBounds,
  groupItemsByLocalDate,
  normalizeCalendarLaunchFilterValue,
  toLocalDateKey
} from '@tminuszero/domain';
import { buildAuthHref, buildUpgradeHref } from '@tminuszero/navigation';
import clsx from 'clsx';
import { AddToCalendarButton } from '@/components/AddToCalendarButton';
import {
  CalendarDayTile,
  CalendarStateLegend
} from '@/components/CalendarDayTile';
import { CalendarMonthYearPicker } from '@/components/CalendarMonthYearPicker';
import {
  useCreateFilterPresetMutation,
  useCreateWatchlistMutation,
  useFilterPresetsQuery,
  useLaunchFeedPageQuery,
  useUpdateFilterPresetMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/lib/api/queries';
import type { LaunchStatus } from '@/lib/types/launch';
import { useSafePathname } from '@/lib/client/useSafePathname';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';
import { formatDateOnly, formatNetLabel, isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref, buildProviderHref } from '@/lib/utils/launchLinks';
import { resolveProviderLogoUrl } from '@/lib/utils/providerLogo';
import {
  buildWatchlistCreateErrorMessage,
  isWatchlistCreateLimitError
} from '@/lib/watchlists/errorMessages';

const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/;
const WEEKDAY_LABELS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat'
] as const;
const STATUS_OPTIONS: Array<{ value: LaunchStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'go', label: 'Go' },
  { value: 'hold', label: 'Hold' },
  { value: 'scrubbed', label: 'Scrubbed' },
  { value: 'tbd', label: 'TBD' },
  { value: 'unknown', label: 'Unknown' }
];
const REGION_OPTIONS = [
  { value: 'all', label: 'All regions' },
  { value: 'us', label: 'US only' },
  { value: 'non-us', label: 'Non-US only' }
] as const;
const US_COUNTRY_CODES = new Set(['US', 'USA']);

type CalendarLaunch = LaunchFeedV1['launches'][number];
type CalendarPreset = {
  id: string;
  name: string;
  filters: ReturnType<typeof normalizeCalendarLaunchFilterValue>;
  isDefault: boolean;
};

export function CalendarPageClient() {
  const router = useRouter();
  const pathname = useSafePathname();
  const searchParams = useSafeSearchParams();
  const calendarPathname = pathname ?? '/calendar';
  const calendarSearchParams = useMemo(
    () => searchParams ?? new URLSearchParams(),
    [searchParams]
  );
  const entitlementsQuery = useViewerEntitlementsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const filterPresetsQuery = useFilterPresetsQuery();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createFilterPresetMutation = useCreateFilterPresetMutation();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const viewer = entitlementsQuery.data ?? null;
  const month = useMemo(
    () => parseMonthParam(calendarSearchParams.get('month')),
    [calendarSearchParams]
  );
  const calendarMode = parseCalendarModeParam(calendarSearchParams.get('mode'));
  const statusFilter = parseStatusParam(calendarSearchParams.get('status'));
  const regionFilter = parseRegionParam(calendarSearchParams.get('region'));
  const providerFilter = String(
    calendarSearchParams.get('provider') || ''
  ).trim();
  const stateFilter = String(calendarSearchParams.get('state') || '').trim();
  const locationFilter = String(
    calendarSearchParams.get('location') || ''
  ).trim();
  const padFilter = String(calendarSearchParams.get('pad') || '').trim();
  const monthBounds = useMemo(() => getCalendarMonthBounds(month), [month]);
  const monthKey = useMemo(() => formatMonthKey(month), [month]);
  const localTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    []
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [watchlistCreateError, setWatchlistCreateError] = useState<
    string | null
  >(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingSelectedDay, setPendingSelectedDay] = useState<string | null>(
    null
  );
  const didRequestMyWatchlistRef = useRef(false);
  const didApplyDefaultPresetRef = useRef(false);
  const canUseRecurringCalendarFeeds =
    viewer?.capabilities.canUseRecurringCalendarFeeds === true;
  const canUseSavedItems = viewer?.capabilities.canUseSavedItems === true;
  const canManageFilterPresets =
    viewer?.capabilities.canManageFilterPresets === true;
  const calendarScope = viewer?.capabilities.canUseLiveFeed ? 'live' : 'public';
  const watchlists = useMemo(
    () => watchlistsQuery.data?.watchlists ?? [],
    [watchlistsQuery.data?.watchlists]
  );
  const selectedWatchlist = useMemo(
    () => resolvePrimaryCalendarWatchlist(watchlists),
    [watchlists]
  );
  const myWatchlistId = selectedWatchlist?.id
    ? String(selectedWatchlist.id)
    : null;
  const isFollowingCalendar = calendarMode === 'following';
  const watchlistsLoading =
    canUseSavedItems &&
    (watchlistsQuery.isPending || createWatchlistMutation.isPending);
  const watchlistsError =
    watchlistCreateError ??
    (canUseSavedItems && watchlistsQuery.isError
      ? watchlistsQuery.error instanceof Error
        ? watchlistsQuery.error.message
        : 'Unable to load My Launches.'
      : null);
  const refetchWatchlists = watchlistsQuery.refetch;
  const calendarFilters = useMemo(
    () =>
      normalizeCalendarLaunchFilterValue({
        region: regionFilter,
        status: statusFilter,
        provider: providerFilter || undefined,
        state: stateFilter || undefined,
        location: locationFilter || undefined,
        pad: padFilter || undefined
      }),
    [
      locationFilter,
      padFilter,
      providerFilter,
      regionFilter,
      stateFilter,
      statusFilter
    ]
  );
  const activeFilterCount = countActiveCalendarLaunchFilters(calendarFilters);

  const monthQuery = useLaunchFeedPageQuery(
    {
      scope: isFollowingCalendar ? 'watchlist' : calendarScope,
      watchlistId: isFollowingCalendar ? myWatchlistId : null,
      from: monthBounds.from.toISOString(),
      to: monthBounds.to.toISOString(),
      sort: 'soonest',
      region: 'all',
      limit: 1000
    },
    {
      enabled:
        viewer?.capabilities.canUseLaunchCalendar === true &&
        (!isFollowingCalendar || Boolean(myWatchlistId))
    }
  );

  const allMonthLaunches = useMemo(
    () => monthQuery.data?.launches ?? [],
    [monthQuery.data?.launches]
  );
  const filterOptions = useMemo(
    () => buildCalendarFilterOptions(allMonthLaunches),
    [allMonthLaunches]
  );
  const presetList = useMemo<CalendarPreset[]>(
    () =>
      (!canManageFilterPresets ? [] : (filterPresetsQuery.data?.presets ?? []))
        .map((preset) => {
          const id = String(preset.id || '').trim();
          if (!id) return null;
          return {
            id,
            name: String(preset.name || '').trim() || 'Saved view',
            filters: normalizeCalendarLaunchFilterValue(preset.filters),
            isDefault: preset.isDefault === true
          };
        })
        .filter((preset): preset is CalendarPreset => preset != null),
    [canManageFilterPresets, filterPresetsQuery.data?.presets]
  );
  const activePreset = useMemo(
    () =>
      presetList.find((preset) =>
        areCalendarLaunchFilterValuesEqual(calendarFilters, preset.filters)
      ) ?? null,
    [calendarFilters, presetList]
  );
  const followRuleCount = selectedWatchlist?.rules?.length ?? 0;
  const calendarLoading =
    monthQuery.isPending ||
    (isFollowingCalendar && watchlistsLoading && !myWatchlistId);
  const calendarErrorMessage =
    isFollowingCalendar && watchlistsError && !myWatchlistId
      ? watchlistsError
      : monthQuery.isError
        ? 'Unable to load the launch calendar.'
        : null;

  const filteredLaunches = useMemo(
    () =>
      allMonthLaunches.filter((launch) =>
        launchMatchesCalendarFilters(launch, calendarFilters)
      ),
    [allMonthLaunches, calendarFilters]
  );

  const launchesByDay = useMemo(
    () => groupItemsByLocalDate(filteredLaunches, (launch) => launch.net),
    [filteredLaunches]
  );
  const launchDayKeys = useMemo(
    () => [...launchesByDay.keys()].sort(),
    [launchesByDay]
  );
  const calendarDays = useMemo(() => buildCalendarMonthDays(month), [month]);
  const selectedLaunches = selectedDay
    ? (launchesByDay.get(selectedDay) ?? [])
    : [];
  const hasMonthLaunches = filteredLaunches.length > 0;
  const nearestLaunchDay = useMemo(
    () => getNearestLaunchDayKey(launchDayKeys, selectedDay),
    [launchDayKeys, selectedDay]
  );
  const exportHref = useMemo(
    () =>
      isFollowingCalendar || locationFilter || padFilter
        ? null
        : buildCalendarExportHref(monthBounds, {
            providerFilter,
            regionFilter,
            stateFilter,
            statusFilter
          }),
    [
      isFollowingCalendar,
      locationFilter,
      monthBounds,
      padFilter,
      providerFilter,
      regionFilter,
      stateFilter,
      statusFilter
    ]
  );
  const returnTo = useMemo(() => {
    const query = calendarSearchParams.toString();
    return `${calendarPathname}${query ? `?${query}` : ''}`;
  }, [calendarPathname, calendarSearchParams]);
  const hasExplicitCalendarParams = useMemo(
    () =>
      ['mode', 'region', 'status', 'provider', 'state', 'location', 'pad'].some(
        (key) => calendarSearchParams.get(key) != null
      ),
    [calendarSearchParams]
  );
  const emptyCalendarMessage = useMemo(
    () =>
      buildCalendarEmptyStateMessage({
        calendarMode,
        activeFilterCount,
        monthLaunchCount: allMonthLaunches.length,
        followRuleCount
      }),
    [activeFilterCount, allMonthLaunches.length, calendarMode, followRuleCount]
  );

  useEffect(() => {
    if (!canUseSavedItems) {
      didRequestMyWatchlistRef.current = false;
      setWatchlistCreateError(null);
      return;
    }

    if (!watchlistsQuery.isSuccess) {
      return;
    }

    if (selectedWatchlist) {
      didRequestMyWatchlistRef.current = false;
      setWatchlistCreateError(null);
      return;
    }

    if (didRequestMyWatchlistRef.current || createWatchlistMutation.isPending) {
      return;
    }

    didRequestMyWatchlistRef.current = true;
    setWatchlistCreateError(null);
    void createWatchlistMutation.mutateAsync({}).catch(async (error) => {
      if (isWatchlistCreateLimitError(error)) {
        const refreshed = await refetchWatchlists();
        const recoveredWatchlist = resolvePrimaryCalendarWatchlist(
          refreshed.data?.watchlists ?? []
        );
        if (recoveredWatchlist?.id) {
          setWatchlistCreateError(null);
          return;
        }
      }

      didRequestMyWatchlistRef.current = false;
      setWatchlistCreateError(buildWatchlistCreateErrorMessage(error));
    });
  }, [
    canUseSavedItems,
    createWatchlistMutation,
    refetchWatchlists,
    selectedWatchlist,
    watchlistsQuery.isSuccess
  ]);

  useEffect(() => {
    const sanitized = sanitizeCalendarFilters(calendarFilters, filterOptions);
    if (areCalendarLaunchFilterValuesEqual(calendarFilters, sanitized)) {
      const valuesMatchExactly =
        (calendarFilters.location ?? '') === (sanitized.location ?? '') &&
        (calendarFilters.state ?? '') === (sanitized.state ?? '') &&
        (calendarFilters.pad ?? '') === (sanitized.pad ?? '') &&
        (calendarFilters.provider ?? '') === (sanitized.provider ?? '') &&
        (calendarFilters.status ?? '') === (sanitized.status ?? '') &&
        (calendarFilters.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region) ===
          (sanitized.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region);
      if (valuesMatchExactly) {
        return;
      }
    }

    updateCalendarQuery(router, calendarPathname, calendarSearchParams, {
      region: sanitized.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region,
      status: sanitized.status ?? null,
      provider: sanitized.provider ?? null,
      state: sanitized.state ?? null,
      location: sanitized.location ?? null,
      pad: sanitized.pad ?? null
    });
  }, [
    calendarFilters,
    calendarPathname,
    calendarSearchParams,
    filterOptions,
    router
  ]);

  useEffect(() => {
    if (!canManageFilterPresets || hasExplicitCalendarParams) {
      didApplyDefaultPresetRef.current = false;
      return;
    }

    if (didApplyDefaultPresetRef.current) {
      return;
    }

    const defaultPreset = presetList.find((preset) => preset.isDefault) ?? null;
    if (!defaultPreset) {
      didApplyDefaultPresetRef.current = true;
      return;
    }

    didApplyDefaultPresetRef.current = true;
    updateCalendarQuery(router, calendarPathname, calendarSearchParams, {
      region:
        defaultPreset.filters.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region,
      status: defaultPreset.filters.status ?? null,
      provider: defaultPreset.filters.provider ?? null,
      state: defaultPreset.filters.state ?? null,
      location: defaultPreset.filters.location ?? null,
      pad: defaultPreset.filters.pad ?? null
    });
  }, [
    calendarPathname,
    calendarSearchParams,
    canManageFilterPresets,
    hasExplicitCalendarParams,
    presetList,
    router
  ]);

  useEffect(() => {
    if (calendarLoading || calendarErrorMessage) {
      return;
    }

    if (pendingSelectedDay && pendingSelectedDay.startsWith(monthKey)) {
      if (selectedDay !== pendingSelectedDay) {
        setSelectedDay(pendingSelectedDay);
      }
      setPendingSelectedDay(null);
      return;
    }

    const todayKey = toLocalDateKey(new Date());
    const todayInMonth =
      todayKey && todayKey.startsWith(monthKey) ? todayKey : null;
    const nextSelectedDay =
      (selectedDay && launchesByDay.has(selectedDay) ? selectedDay : null) ||
      getNearestLaunchDayKey(
        launchDayKeys,
        selectedDay || todayInMonth || `${monthKey}-01`
      ) ||
      (todayInMonth && launchesByDay.has(todayInMonth) ? todayInMonth : null) ||
      launchDayKeys[0] ||
      todayInMonth ||
      `${monthKey}-01`;

    if (selectedDay !== nextSelectedDay) {
      setSelectedDay(nextSelectedDay);
    }
  }, [
    calendarErrorMessage,
    calendarLoading,
    launchDayKeys,
    launchesByDay,
    monthKey,
    pendingSelectedDay,
    selectedDay
  ]);

  function openUpgrade() {
    router.push(
      viewer?.isAuthed
        ? buildUpgradeHref({ returnTo })
        : buildAuthHref('sign-in', {
            returnTo,
            intent: 'upgrade'
          })
    );
  }

  async function handleSavePreset() {
    if (!canManageFilterPresets) return;

    const suggested =
      activePreset?.name || `Calendar view ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Saved view name', suggested)?.trim();
    if (!name) return;

    try {
      await createFilterPresetMutation.mutateAsync({
        name,
        filters: buildFeedPresetFiltersFromCalendarFilters(calendarFilters),
        isDefault: false
      });
    } catch {
      return;
    }
  }

  async function handleSetDefaultPreset() {
    if (!canManageFilterPresets || !activePreset?.id) return;

    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: activePreset.id,
        payload: { isDefault: true }
      });
    } catch {
      return;
    }
  }

  function applyPreset(preset: CalendarPreset) {
    updateCalendarQuery(router, calendarPathname, calendarSearchParams, {
      region: preset.filters.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region,
      status: preset.filters.status ?? null,
      provider: preset.filters.provider ?? null,
      state: preset.filters.state ?? null,
      location: preset.filters.location ?? null,
      pad: preset.filters.pad ?? null
    });
  }

  function resetCalendarFilters() {
    updateCalendarQuery(router, calendarPathname, calendarSearchParams, {
      region: DEFAULT_CALENDAR_LAUNCH_FILTERS.region,
      status: null,
      provider: null,
      state: null,
      location: null,
      pad: null
    });
  }

  function openSelectedDay(dayKey: string) {
    const parsedDay = parseDayKey(dayKey);
    if (!parsedDay) {
      return;
    }

    const nextMonthKey = formatMonthKey(
      new Date(parsedDay.getFullYear(), parsedDay.getMonth(), 1)
    );
    if (nextMonthKey !== monthKey) {
      setPendingSelectedDay(dayKey);
      updateCalendarQuery(router, calendarPathname, calendarSearchParams, {
        month: nextMonthKey
      });
      return;
    }

    setSelectedDay(dayKey);
  }

  function navigateDay(offset: number) {
    const nextDayKey = shiftDayKey(selectedDay || `${monthKey}-01`, offset);
    if (!nextDayKey) {
      return;
    }

    openSelectedDay(nextDayKey);
  }

  if (entitlementsQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="rounded-3xl border border-stroke bg-surface-1 p-6 text-sm text-text3">
          Loading launch calendar…
        </div>
      </div>
    );
  }

  if (!viewer?.capabilities.canUseLaunchCalendar) {
    const signInHref = buildAuthHref('sign-in', {
      returnTo,
      intent: 'upgrade'
    });
    const upgradeHref = buildUpgradeHref({ returnTo });

    return (
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="rounded-3xl border border-stroke bg-surface-1 p-6 shadow-glow">
          <div className="text-xs uppercase tracking-[0.14em] text-text3">
            Premium
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-text1">
            Launch calendar
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text2">
            This build requires Premium for the full monthly launch calendar.
            Individual launch pages still let you add one launch at a time to
            your calendar.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={signInHref}
              className="btn rounded-xl px-4 py-2 text-sm"
            >
              Sign in
            </Link>
            <Link
              href={upgradeHref}
              className="btn-secondary rounded-xl px-4 py-2 text-sm"
            >
              Upgrade to Premium
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-text3">
            Launch calendar
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-text1">
            {formatMonthLabel(month)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text2">
            {canUseRecurringCalendarFeeds
              ? 'Read the monthly schedule at a glance, tap into any date, and export recurring calendar feeds.'
              : 'Read the monthly schedule at a glance, tap into any date, and add launches to your calendar.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUseRecurringCalendarFeeds ? (
            <>
              {exportHref ? (
                <a
                  href={exportHref}
                  className="btn-secondary rounded-xl px-4 py-2 text-sm"
                >
                  Export month (.ics)
                </a>
              ) : null}
              <Link
                href="/account/integrations"
                className="btn-secondary rounded-xl px-4 py-2 text-sm"
              >
                Live feeds
              </Link>
            </>
          ) : (
            <Link
              href={buildUpgradeHref({ returnTo })}
              className="btn-secondary rounded-xl px-4 py-2 text-sm"
            >
              Premium feeds
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-stroke bg-surface-1 p-4 md:p-5">
        <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={clsx(
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  !isFollowingCalendar
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-stroke bg-surface-0 text-text1 hover:border-primary/50'
                )}
                onClick={() =>
                  updateCalendarQuery(
                    router,
                    calendarPathname,
                    calendarSearchParams,
                    {
                      mode: null
                    }
                  )
                }
              >
                For You
              </button>
              <button
                type="button"
                className={clsx(
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  isFollowingCalendar
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-stroke bg-surface-0 text-text1 hover:border-primary/50',
                  (!canUseSavedItems || watchlistsLoading) &&
                    'cursor-not-allowed opacity-60'
                )}
                onClick={() => {
                  if (!canUseSavedItems) {
                    openUpgrade();
                    return;
                  }
                  updateCalendarQuery(
                    router,
                    calendarPathname,
                    calendarSearchParams,
                    {
                      mode: 'following'
                    }
                  );
                }}
                disabled={!canUseSavedItems || watchlistsLoading}
              >
                Following
              </button>
              <button
                type="button"
                className={clsx(
                  'rounded-full border px-4 py-2 text-sm font-semibold transition',
                  filtersOpen || activeFilterCount > 0
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-stroke bg-surface-0 text-text1 hover:border-primary/50'
                )}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                {activeFilterCount > 0
                  ? `Filters (${activeFilterCount})`
                  : 'Filters'}
              </button>
            </div>

            <p className="text-sm text-text3">
              {canUseSavedItems
                ? isFollowingCalendar
                  ? followRuleCount > 0
                    ? 'Following shows launch days that match the launches, providers, and pads you follow.'
                    : 'Following is empty. Follow a launch, provider, or pad to populate this calendar.'
                  : 'For You shows launch days matching your current calendar filters.'
                : 'Following is a Premium calendar driven by the launches, providers, and pads you follow.'}
            </p>

            {watchlistsError ? (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                {watchlistsError}
              </div>
            ) : null}

            {activeFilterCount > 0 ? (
              <div className="rounded-2xl border border-stroke bg-surface-0/55 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">
                      Active filters
                    </div>
                    <div className="mt-1 text-sm text-text2">
                      {activePreset
                        ? `${activePreset.name} · ${activeFilterCount} active`
                        : `${activeFilterCount} active`}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {buildCalendarFilterChips(calendarFilters).map(
                        (label) => (
                          <span
                            key={label}
                            className="rounded-full border border-stroke bg-surface-0 px-2.5 py-1 text-xs font-semibold text-text1"
                          >
                            {label}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary rounded-lg px-3 py-2 text-sm"
                    onClick={resetCalendarFilters}
                  >
                    Default view
                  </button>
                </div>
              </div>
            ) : null}

            {filtersOpen ? (
              <div className="rounded-2xl border border-stroke bg-surface-0/55 p-4">
                <div className="flex flex-col gap-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">
                      Saved views
                    </div>
                    {canManageFilterPresets ? (
                      <>
                        {presetList.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {presetList.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className={clsx(
                                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                                  activePreset?.id === preset.id
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-stroke bg-surface-0 text-text1 hover:border-primary/50'
                                )}
                                onClick={() => applyPreset(preset)}
                              >
                                {preset.name}
                                {preset.isDefault ? ' · default' : ''}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-text2">
                            Apply the same saved views you use in feed. Calendar
                            ignores feed-only time settings here.
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-secondary rounded-lg px-3 py-2 text-sm"
                            onClick={() => void handleSavePreset()}
                          >
                            Save current view
                          </button>
                          <button
                            type="button"
                            className="btn-secondary rounded-lg px-3 py-2 text-sm"
                            onClick={() => void handleSetDefaultPreset()}
                            disabled={
                              !activePreset?.id ||
                              activePreset.isDefault ||
                              updateFilterPresetMutation.isPending
                            }
                          >
                            {activePreset?.isDefault
                              ? 'Default view'
                              : 'Set default'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-3">
                        <button
                          type="button"
                          className="btn-secondary rounded-lg px-3 py-2 text-sm"
                          onClick={openUpgrade}
                        >
                          Premium saved views
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">
                      Launches
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <select
                        aria-label="Filter launch status"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={statusFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              status: event.target.value
                            }
                          )
                        }
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">
                      Location
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <select
                        aria-label="Filter launch region"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={regionFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              region: event.target.value
                            }
                          )
                        }
                      >
                        {REGION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter launch state"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={stateFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              state: event.target.value
                            }
                          )
                        }
                      >
                        <option value="">All states</option>
                        {filterOptions.states.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter launch site"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={locationFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              location: event.target.value
                            }
                          )
                        }
                      >
                        <option value="">All launch sites</option>
                        {filterOptions.locations.map((location) => (
                          <option key={location} value={location}>
                            {location}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">
                      Mission
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <select
                        aria-label="Filter launch provider"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={providerFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              provider: event.target.value
                            }
                          )
                        }
                      >
                        <option value="">All providers</option>
                        {filterOptions.providers.map((provider) => (
                          <option key={provider} value={provider}>
                            {provider}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter launch pad"
                        className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                        value={padFilter}
                        onChange={(event) =>
                          updateCalendarQuery(
                            router,
                            calendarPathname,
                            calendarSearchParams,
                            {
                              pad: event.target.value
                            }
                          )
                        }
                      >
                        <option value="">All pads</option>
                        {filterOptions.pads.map((pad) => (
                          <option key={pad} value={pad}>
                            {pad}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <p className="text-sm text-text3">
                    Calendar stays locked to the selected month. Saved views
                    ignore feed-only time settings here.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary rounded-lg px-3 py-2 text-sm"
                      onClick={resetCalendarFilters}
                    >
                      Default view
                    </button>
                    <button
                      type="button"
                      className="btn-secondary rounded-lg px-3 py-2 text-sm"
                      onClick={() => setFiltersOpen(false)}
                    >
                      Hide filters
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {calendarLoading ? (
        <div className="mt-4 rounded-3xl border border-stroke bg-surface-1 p-6 text-sm text-text3">
          {isFollowingCalendar
            ? 'Preparing your followed launch calendar…'
            : 'Loading launches…'}
        </div>
      ) : calendarErrorMessage ? (
        <div className="mt-4 rounded-3xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">
          {calendarErrorMessage}
        </div>
      ) : (
        <div className="mt-4 rounded-3xl border border-stroke bg-surface-1 p-4 md:p-5">
          <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CalendarMonthYearPicker
                  value={month}
                  embedded
                  onChange={(nextMonth) =>
                    updateCalendarQuery(
                      router,
                      calendarPathname,
                      calendarSearchParams,
                      {
                        month: formatMonthKey(nextMonth)
                      }
                    )
                  }
                />
                <CalendarStateLegend />
              </div>

              <div className="border-t border-stroke/70 pt-4">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">
                  Days with launches
                </div>
                <div className="mt-4 overflow-x-auto pb-2">
                  <div className="grid min-w-[680px] grid-cols-7 gap-3">
                    {WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        className="text-center text-xs uppercase tracking-[0.08em] text-text3"
                      >
                        {label}
                      </div>
                    ))}
                    {calendarDays.map((day) => {
                      const items = launchesByDay.get(day.key) ?? [];
                      return (
                        <CalendarDayTile
                          key={day.key}
                          dayKey={day.key}
                          dayNumber={day.date.getDate()}
                          launchCount={items.length}
                          isCurrentMonth={day.isCurrentMonth}
                          isSelected={selectedDay === day.key}
                          ariaLabel={buildCalendarDayLabel(
                            day.key,
                            items.length,
                            localTimeZone
                          )}
                          onClick={() => openSelectedDay(day.key)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-stroke bg-surface-0/45 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">
                  Month summary
                </div>
                <div className="mt-1 text-lg font-semibold text-text1">
                  {filteredLaunches.length} launch
                  {filteredLaunches.length === 1 ? '' : 'es'} across{' '}
                  {launchDayKeys.length} active day
                  {launchDayKeys.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="text-sm text-text3">
                Times shown in {localTimeZone}
              </div>
            </div>
            <div className="mt-3 text-sm text-text2">
              {filteredLaunches[0]
                ? `Next launch: ${filteredLaunches[0].name} on ${formatLaunchTiming(filteredLaunches[0], localTimeZone)}.`
                : emptyCalendarMessage}
            </div>
          </div>

          {launchDayKeys.length > 0 ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">
                Launch dates
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {launchDayKeys.map((dayKey) => (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => openSelectedDay(dayKey)}
                    className={clsx(
                      'shrink-0 rounded-2xl border px-4 py-3 text-left transition',
                      selectedDay === dayKey
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-stroke bg-surface-0 text-text1 hover:border-primary/50'
                    )}
                  >
                    <div className="text-sm font-semibold">
                      {formatCompactDay(dayKey)}
                    </div>
                    <div className="mt-1 text-xs text-text3">
                      {launchesByDay.get(dayKey)?.length ?? 0} launch
                      {(launchesByDay.get(dayKey)?.length ?? 0) === 1
                        ? ''
                        : 'es'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {!calendarLoading && !calendarErrorMessage ? (
        <div className="mt-4 rounded-3xl border border-stroke bg-surface-1 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">
                Selected day
              </div>
              <div className="mt-1 text-xl font-semibold text-text1">
                {selectedDay
                  ? formatSelectedDay(selectedDay, localTimeZone)
                  : 'Select a day'}
              </div>
              <div className="mt-1 text-sm text-text3">
                {hasMonthLaunches
                  ? formatLaunchCountLabel(selectedLaunches.length)
                  : emptyCalendarMessage}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-2 text-sm"
                onClick={() => navigateDay(-1)}
              >
                Previous day
              </button>
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-2 text-sm"
                onClick={() => navigateDay(1)}
              >
                Next day
              </button>
              {nearestLaunchDay &&
              selectedLaunches.length === 0 &&
              nearestLaunchDay !== selectedDay ? (
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-3 py-2 text-sm"
                  onClick={() => openSelectedDay(nearestLaunchDay)}
                >
                  Jump to {formatCompactDay(nearestLaunchDay)}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {!hasMonthLaunches ? (
              <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4 text-sm text-text3">
                {emptyCalendarMessage}
              </div>
            ) : selectedLaunches.length === 0 ? (
              <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4 text-sm text-text3">
                No launches on this date. Keep stepping through past and future
                dates or jump to the nearest scheduled day.
              </div>
            ) : (
              selectedLaunches.map((launch) => (
                <CalendarAgendaCard
                  key={launch.id}
                  launch={launch}
                  localTimeZone={localTimeZone}
                />
              ))
            )}
          </div>

          {monthQuery.data?.hasMore ? (
            <p className="mt-4 text-xs text-text3">
              Showing the first 1000 launches returned for this month.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalendarAgendaCard({
  launch,
  localTimeZone
}: {
  launch: CalendarLaunch;
  localTimeZone: string;
}) {
  const providerHref = buildProviderHref(launch.provider);
  const countdownLabel = buildLaunchCountdownLabel(
    launch.net,
    launch.netPrecision
  );
  const statusTone = getStatusTone(launch.status);
  const windowLabel = buildWindowLabel(
    launch.net,
    launch.windowEnd ?? null,
    localTimeZone
  );

  return (
    <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <ProviderLogo
            provider={launch.provider}
            logoUrl={resolveProviderLogoUrl(launch)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={buildLaunchHref(launch)}
                  className="block truncate text-base font-semibold text-text1 hover:text-primary"
                >
                  {launch.name}
                </Link>
                <div className="mt-1 text-xs text-text3">
                  {providerHref ? (
                    <Link href={providerHref} className="hover:text-text1">
                      {launch.provider}
                    </Link>
                  ) : (
                    launch.provider
                  )}{' '}
                  • {launch.vehicle}
                </div>
              </div>
              <span
                className={clsx(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
                  statusTone.border,
                  statusTone.background,
                  statusTone.text
                )}
              >
                {launch.statusText || launch.status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <InlinePill
                label={formatLaunchTiming(launch, localTimeZone)}
                emphasis
              />
              {countdownLabel ? <InlinePill label={countdownLabel} /> : null}
            </div>

            <div className="mt-3 text-sm text-text2">
              {launch.pad.locationName || launch.pad.name}
            </div>
            {windowLabel ? (
              <div className="mt-1 text-sm text-text3">{windowLabel}</div>
            ) : null}
          </div>
        </div>
        <AddToCalendarButton launch={launch} variant="icon" isAuthed />
      </div>
    </div>
  );
}

function InlinePill({
  label,
  emphasis = false
}: {
  label: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={clsx(
        'rounded-full border px-2.5 py-1 text-xs font-semibold',
        emphasis
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-stroke bg-surface-1 text-text1'
      )}
    >
      {label}
    </span>
  );
}

function ProviderLogo({
  provider,
  logoUrl
}: {
  provider: string;
  logoUrl?: string;
}) {
  const initial = (provider || '?').trim().slice(0, 1).toUpperCase() || '?';

  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.55),rgba(124,92,255,0.28))] opacity-80 blur-[2px]"
      />
      <span className="relative flex h-full w-full items-center justify-center rounded-full border border-white/20 bg-[rgba(7,9,19,0.85)] shadow-[0_0_10px_rgba(34,211,238,0.3)]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-[86%] w-[86%] object-contain drop-shadow-[0_0_2px_rgba(255,255,255,0.6)]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="text-[10px] font-semibold text-text2">
            {initial}
          </span>
        )}
      </span>
    </span>
  );
}

function parseMonthParam(value: string | null) {
  if (!value || !MONTH_PARAM_PATTERN.test(value)) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }

  const match = value.match(MONTH_PARAM_PATTERN);
  const year = Number(match?.[1]);
  const monthIndex = Number(match?.[2]) - 1;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(monthIndex) ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }

  return new Date(year, monthIndex, 1);
}

function parseDayKey(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseStatusParam(value: string | null): LaunchStatus | 'all' {
  return STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as LaunchStatus | 'all')
    : 'all';
}

function parseCalendarModeParam(value: string | null): 'for-you' | 'following' {
  return value === 'following' ? 'following' : 'for-you';
}

function parseRegionParam(
  value: string | null
): (typeof REGION_OPTIONS)[number]['value'] {
  return REGION_OPTIONS.some((option) => option.value === value)
    ? (value as (typeof REGION_OPTIONS)[number]['value'])
    : (DEFAULT_CALENDAR_LAUNCH_FILTERS.region ?? 'us');
}

function formatMonthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}

function shiftDayKey(dayKey: string, delta: number) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) {
    return null;
  }

  parsed.setDate(parsed.getDate() + delta);
  return toLocalDateKey(parsed);
}

function updateCalendarQuery(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSafeSearchParams>,
  updates: Record<string, string | null | undefined>
) {
  const next = new URLSearchParams(searchParams.toString());
  Object.entries(updates).forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (key === 'mode') {
      if (!normalized || normalized === 'for-you') {
        next.delete(key);
      } else {
        next.set(key, normalized);
      }
      return;
    }

    if (key === 'region') {
      if (
        !normalized ||
        normalized === (DEFAULT_CALENDAR_LAUNCH_FILTERS.region ?? 'us')
      ) {
        next.delete(key);
      } else {
        next.set(key, normalized);
      }
      return;
    }

    if (key === 'status') {
      if (!normalized || normalized === 'all') {
        next.delete(key);
      } else {
        next.set(key, normalized);
      }
      return;
    }

    if (!normalized) {
      next.delete(key);
      return;
    }

    next.set(key, normalized);
  });

  const query = next.toString();
  router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
}

function buildCalendarExportHref(
  bounds: { from: Date; to: Date },
  options: {
    providerFilter: string;
    regionFilter: string;
    stateFilter: string;
    statusFilter: LaunchStatus | 'all';
  }
) {
  const params = new URLSearchParams({
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    limit: '1000'
  });

  if (options.providerFilter) params.set('provider', options.providerFilter);
  if (options.regionFilter !== DEFAULT_CALENDAR_LAUNCH_FILTERS.region)
    params.set('region', options.regionFilter);
  if (options.stateFilter) params.set('state', options.stateFilter);
  if (options.statusFilter !== 'all')
    params.set('status', options.statusFilter);

  return `/api/launches/ics?${params.toString()}`;
}

function resolvePrimaryCalendarWatchlist(watchlists: WatchlistV1[]) {
  return (
    watchlists.find(
      (watchlist) =>
        String(watchlist.name || '')
          .trim()
          .toLowerCase() === 'my launches'
    ) ??
    watchlists[0] ??
    null
  );
}

function buildCalendarFilterOptions(launches: CalendarLaunch[]) {
  return {
    providers: sortStrings(launches.map((launch) => launch.provider)),
    locations: sortStrings(
      launches.map((launch) => launch.pad.locationName || launch.pad.name)
    ),
    states: sortStrings(launches.map((launch) => launch.pad.state)),
    pads: sortStrings(launches.map((launch) => launch.pad.name)),
    statuses: sortStrings(launches.map((launch) => launch.status))
  };
}

function sortStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values.map((value) => String(value || '').trim()).filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right));
}

function sanitizeCalendarFilters(
  filters: ReturnType<typeof normalizeCalendarLaunchFilterValue>,
  filterOptions: ReturnType<typeof buildCalendarFilterOptions>
) {
  const normalized = normalizeCalendarLaunchFilterValue(filters);
  const next = { ...normalized };
  let changed = false;

  if (next.location && !filterOptions.locations.includes(next.location)) {
    next.location = undefined;
    changed = true;
  }
  if (next.state && !filterOptions.states.includes(next.state)) {
    next.state = undefined;
    changed = true;
  }
  if (next.pad && !filterOptions.pads.includes(next.pad)) {
    next.pad = undefined;
    changed = true;
  }
  if (next.provider && !filterOptions.providers.includes(next.provider)) {
    next.provider = undefined;
    changed = true;
  }
  if (next.status && !filterOptions.statuses.includes(next.status)) {
    next.status = undefined;
    changed = true;
  }

  return changed ? next : normalized;
}

function launchMatchesCalendarFilters(
  launch: CalendarLaunch,
  filters: ReturnType<typeof normalizeCalendarLaunchFilterValue>
) {
  const normalized = normalizeCalendarLaunchFilterValue(filters);
  const region = normalized.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region;
  const launchLocation = launch.pad.locationName || launch.pad.name;

  if (normalized.status && launch.status !== normalized.status) {
    return false;
  }
  if (normalized.provider && launch.provider !== normalized.provider) {
    return false;
  }
  if (normalized.location && launchLocation !== normalized.location) {
    return false;
  }
  if (normalized.state && launch.pad.state !== normalized.state) {
    return false;
  }
  if (normalized.pad && launch.pad.name !== normalized.pad) {
    return false;
  }
  if (region === 'all') {
    return true;
  }

  const countryCode = String(launch.pad.countryCode || '')
    .trim()
    .toUpperCase();
  const isUs = US_COUNTRY_CODES.has(countryCode);
  return region === 'us' ? isUs : !isUs;
}

function buildCalendarFilterChips(
  filters: ReturnType<typeof normalizeCalendarLaunchFilterValue>
) {
  const normalized = normalizeCalendarLaunchFilterValue(filters);
  const labels: string[] = [];

  if (
    (normalized.region ?? DEFAULT_CALENDAR_LAUNCH_FILTERS.region) !==
    DEFAULT_CALENDAR_LAUNCH_FILTERS.region
  ) {
    labels.push(
      normalized.region === 'all'
        ? 'All locations'
        : normalized.region === 'non-us'
          ? 'Non-US'
          : 'US only'
    );
  }
  if (normalized.status)
    labels.push(formatLaunchFilterStatusLabel(normalized.status));
  if (normalized.state) labels.push(normalized.state);
  if (normalized.location) labels.push(normalized.location);
  if (normalized.provider) labels.push(normalized.provider);
  if (normalized.pad) labels.push(normalized.pad);

  return labels;
}

function buildCalendarEmptyStateMessage({
  calendarMode,
  activeFilterCount,
  monthLaunchCount,
  followRuleCount
}: {
  calendarMode: 'for-you' | 'following';
  activeFilterCount: number;
  monthLaunchCount: number;
  followRuleCount: number;
}) {
  if (calendarMode === 'following') {
    if (followRuleCount === 0) {
      return 'Following is empty. Follow a launch, provider, or pad to populate this calendar.';
    }
    if (activeFilterCount > 0 && monthLaunchCount > 0) {
      return 'No matches in Following for this filter set.';
    }
    return 'No followed launches are scheduled for this month.';
  }

  if (activeFilterCount > 0 && monthLaunchCount > 0) {
    return 'No matches in For You for this filter set.';
  }

  return 'No launches are currently scheduled for this month.';
}

function formatCompactDay(dayKey: string) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) {
    return dayKey;
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatSelectedDay(dayKey: string, localTimeZone: string) {
  return formatDateOnly(`${dayKey}T12:00:00`, localTimeZone);
}

function formatLaunchCountLabel(count: number) {
  return `${count} launch${count === 1 ? '' : 'es'}`;
}

function buildCalendarDayLabel(
  dayKey: string,
  count: number,
  localTimeZone: string
) {
  const labels = [formatSelectedDay(dayKey, localTimeZone)];
  const dayState = getCalendarDayTemporalState(dayKey);

  if (dayState === 'today') {
    labels.push('today');
  } else if (dayState === 'past') {
    labels.push(count > 0 ? 'past launches' : 'past date');
  } else if (dayState === 'future') {
    labels.push(count > 0 ? 'upcoming launches' : 'future date');
  }

  labels.push(count > 0 ? formatLaunchCountLabel(count) : 'no launches');
  return labels.join(' • ');
}

function formatLaunchTiming(launch: CalendarLaunch, localTimeZone: string) {
  return isDateOnlyNet(launch.net, launch.netPrecision, localTimeZone)
    ? formatDateOnly(launch.net, localTimeZone)
    : formatNetLabel(launch.net, localTimeZone);
}

function buildLaunchCountdownLabel(net: string, netPrecision: string) {
  if (
    netPrecision === 'day' ||
    netPrecision === 'month' ||
    netPrecision === 'tbd'
  ) {
    return null;
  }

  const snapshot = buildCountdownSnapshot(net);
  return snapshot ? formatLaunchCountdownClock(snapshot.totalMs) : null;
}

function buildWindowLabel(
  net: string,
  windowEnd: string | null,
  localTimeZone: string
) {
  if (!windowEnd || windowEnd === net) {
    return null;
  }

  return `Window closes ${formatNetLabel(windowEnd, localTimeZone)}`;
}

function getNearestLaunchDayKey(dayKeys: string[], selectedDay: string | null) {
  if (!dayKeys.length) {
    return null;
  }

  const reference = parseDayKey(selectedDay || dayKeys[0]);
  if (!reference) {
    return dayKeys[0];
  }

  const referenceMs = reference.getTime();
  return dayKeys.reduce((closest, candidate) => {
    const candidateDate = parseDayKey(candidate);
    const closestDate = parseDayKey(closest);
    if (!candidateDate || !closestDate) {
      return closest;
    }

    const candidateDistance = Math.abs(candidateDate.getTime() - referenceMs);
    const closestDistance = Math.abs(closestDate.getTime() - referenceMs);
    return candidateDistance < closestDistance ? candidate : closest;
  }, dayKeys[0]);
}

function getStatusTone(status: CalendarLaunch['status']) {
  switch (status) {
    case 'go':
      return {
        text: 'text-emerald-300',
        background: 'bg-emerald-500/10',
        border: 'border-emerald-500/20'
      };
    case 'hold':
      return {
        text: 'text-amber-300',
        background: 'bg-amber-500/10',
        border: 'border-amber-500/20'
      };
    case 'scrubbed':
      return {
        text: 'text-rose-300',
        background: 'bg-rose-500/10',
        border: 'border-rose-500/20'
      };
    default:
      return {
        text: 'text-primary',
        background: 'bg-primary/10',
        border: 'border-primary/20'
      };
  }
}
