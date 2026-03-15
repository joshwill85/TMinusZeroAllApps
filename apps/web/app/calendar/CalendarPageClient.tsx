'use client';

import type { LaunchFeedV1 } from '@tminuszero/api-client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { buildCalendarMonthDays, getCalendarMonthBounds, groupItemsByLocalDate, toLocalDateKey } from '@tminuszero/domain';
import { buildAuthHref, buildUpgradeHref } from '@tminuszero/navigation';
import clsx from 'clsx';
import { AddToCalendarButton } from '@/components/AddToCalendarButton';
import { useLaunchFeedPageQuery, useViewerEntitlementsQuery } from '@/lib/api/queries';
import type { LaunchStatus } from '@/lib/types/launch';
import { formatDateOnly, formatNetLabel, isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref, buildProviderHref } from '@/lib/utils/launchLinks';
import { resolveProviderLogoUrl } from '@/lib/utils/providerLogo';

const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/;
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

export function CalendarPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const viewer = entitlementsQuery.data ?? null;
  const month = useMemo(() => parseMonthParam(searchParams.get('month')), [searchParams]);
  const statusFilter = parseStatusParam(searchParams.get('status'));
  const regionFilter = parseRegionParam(searchParams.get('region'));
  const providerFilter = String(searchParams.get('provider') || '').trim();
  const monthBounds = useMemo(() => getCalendarMonthBounds(month), [month]);
  const monthKey = useMemo(() => month.toISOString().slice(0, 7), [month]);
  const localTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const canUseRecurringCalendarFeeds = viewer?.capabilities.canUseRecurringCalendarFeeds === true;

  const monthQuery = useLaunchFeedPageQuery(
    {
      scope: 'live',
      from: monthBounds.from.toISOString(),
      to: monthBounds.to.toISOString(),
      sort: 'soonest',
      region: 'all',
      limit: 1000
    },
    {
      enabled: viewer?.capabilities.canUseLaunchCalendar === true
    }
  );

  const allMonthLaunches = useMemo(() => monthQuery.data?.launches ?? [], [monthQuery.data?.launches]);
  const providerOptions = useMemo(
    () =>
      [...new Set(allMonthLaunches.map((launch) => launch.provider.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right)),
    [allMonthLaunches]
  );

  const filteredLaunches = useMemo(
    () =>
      allMonthLaunches.filter((launch) => {
        if (statusFilter !== 'all' && launch.status !== statusFilter) return false;
        if (providerFilter && launch.provider !== providerFilter) return false;
        if (regionFilter === 'all') return true;
        const countryCode = String(launch.pad.countryCode || '').trim().toUpperCase();
        const isUs = US_COUNTRY_CODES.has(countryCode);
        return regionFilter === 'us' ? isUs : !isUs;
      }),
    [allMonthLaunches, providerFilter, regionFilter, statusFilter]
  );

  const launchesByDay = useMemo(
    () => groupItemsByLocalDate(filteredLaunches, (launch) => launch.net),
    [filteredLaunches]
  );
  const calendarDays = useMemo(() => buildCalendarMonthDays(month), [month]);
  const selectedLaunches = selectedDay ? launchesByDay.get(selectedDay) ?? [] : [];
  const exportHref = useMemo(() => buildCalendarExportHref(monthBounds, { providerFilter, regionFilter, statusFilter }), [monthBounds, providerFilter, regionFilter, statusFilter]);
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  }, [pathname, searchParams]);

  useEffect(() => {
    const todayKey = toLocalDateKey(new Date());
    const inCurrentMonth = todayKey?.startsWith(monthKey);
    setSelectedDay(inCurrentMonth ? todayKey : `${monthKey}-01`);
  }, [monthKey]);

  if (entitlementsQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="rounded-3xl border border-stroke bg-surface-1 p-6 text-sm text-text3">Loading launch calendar…</div>
      </div>
    );
  }

  if (!viewer?.capabilities.canUseLaunchCalendar) {
    const signInHref = buildAuthHref('sign-in', { returnTo, intent: 'upgrade' });
    const signUpHref = buildAuthHref('sign-up', { returnTo });

    return (
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="rounded-3xl border border-stroke bg-surface-1 p-6 shadow-glow">
          <div className="text-xs uppercase tracking-[0.14em] text-text3">Free account</div>
          <h1 className="mt-2 text-3xl font-semibold text-text1">Launch calendar</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text2">
            Sign in to browse the monthly launch calendar, open launch detail, and add one launch at a time to your calendar.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={signInHref} className="btn rounded-xl px-4 py-2 text-sm">
              Sign in
            </Link>
            <Link href={signUpHref} className="btn-secondary rounded-xl px-4 py-2 text-sm">
              Create free account
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
            {canUseRecurringCalendarFeeds ? 'Premium calendar' : 'Launch calendar'}
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-text1">
            {month.toLocaleString('default', { month: 'long' })} {month.getFullYear()}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text2">
            {canUseRecurringCalendarFeeds
              ? 'Read the monthly launch schedule at a glance, add individual launches, and export premium calendar feeds.'
              : 'Read the monthly launch schedule at a glance, open any mission, and add individual launches to your calendar.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUseRecurringCalendarFeeds ? (
            <>
              <a href={exportHref} className="btn-secondary rounded-xl px-4 py-2 text-sm">
                Export month (.ics)
              </a>
              <Link href="/account/integrations" className="btn-secondary rounded-xl px-4 py-2 text-sm">
                Live feeds
              </Link>
            </>
          ) : (
            <Link href={buildUpgradeHref({ returnTo })} className="btn-secondary rounded-xl px-4 py-2 text-sm">
              Premium feeds
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 rounded-3xl border border-stroke bg-surface-1 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-2 text-sm"
                onClick={() => updateCalendarQuery(router, pathname, searchParams, { month: shiftMonth(month, -1) })}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-2 text-sm"
                onClick={() => updateCalendarQuery(router, pathname, searchParams, { month: shiftMonth(month, 1) })}
              >
                Next →
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                aria-label="Filter launch region"
                className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                value={regionFilter}
                onChange={(event) => updateCalendarQuery(router, pathname, searchParams, { region: event.target.value })}
              >
                {REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter launch status"
                className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                value={statusFilter}
                onChange={(event) => updateCalendarQuery(router, pathname, searchParams, { status: event.target.value })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter launch provider"
                className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1"
                value={providerFilter}
                onChange={(event) => updateCalendarQuery(router, pathname, searchParams, { provider: event.target.value })}
              >
                <option value="">All providers</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {monthQuery.isPending ? <div className="mt-4 text-sm text-text3">Loading launches…</div> : null}
          {monthQuery.isError ? (
            <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
              Unable to load the launch calendar.
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto pb-2">
            <div className="grid min-w-[620px] grid-cols-7 gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                <div key={label} className="text-center text-xs uppercase tracking-[0.08em] text-text3">
                  {label}
                </div>
              ))}
              {calendarDays.map((day) => {
                const items = launchesByDay.get(day.key) ?? [];
                const isSelected = selectedDay === day.key;
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => setSelectedDay(day.key)}
                    className={clsx(
                      'flex h-[112px] min-h-[112px] flex-col rounded-2xl border px-3 py-3 text-left transition',
                      day.isCurrentMonth ? 'text-text1' : 'text-text3',
                      isSelected ? 'border-primary bg-primary/10' : 'border-stroke bg-surface-0/70 hover:border-primary/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{day.date.getDate()}</span>
                      {items.length > 0 ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">{items.length}</span>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-1 overflow-hidden">
                      {items.slice(0, 3).map((launch) => (
                        <div key={launch.id} className="truncate text-xs text-text2">
                          {launch.provider}
                        </div>
                      ))}
                      {items.length > 3 ? <div className="text-[11px] text-text3">+{items.length - 3} more</div> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-0/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Selected day</div>
              <div className="mt-1 text-lg font-semibold text-text1">
                {selectedDay ? formatSelectedDay(selectedDay, localTimeZone) : 'Select a day'}
              </div>
            </div>
            <div className="text-xs text-text3">{formatLaunchCountLabel(selectedLaunches.length)}</div>
          </div>

          <div className="mt-4 space-y-3">
            {selectedLaunches.length === 0 ? (
              <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text3">No launches on this date.</div>
            ) : (
              selectedLaunches.map((launch) => (
                <CalendarAgendaCard key={launch.id} launch={launch} localTimeZone={localTimeZone} />
              ))
            )}
          </div>

          {monthQuery.data?.hasMore ? (
            <p className="mt-4 text-xs text-text3">Showing the first 1000 launches returned for this month.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CalendarAgendaCard({ launch, localTimeZone }: { launch: CalendarLaunch; localTimeZone: string }) {
  const providerHref = buildProviderHref(launch.provider);

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-3">
      <div className="flex items-start gap-3">
        <ProviderLogo provider={launch.provider} logoUrl={resolveProviderLogoUrl(launch)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={buildLaunchHref(launch)} className="block truncate text-sm font-semibold text-text1 hover:text-primary">
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
              <div className="mt-1 text-xs text-text3">
                {isDateOnlyNet(launch.net, launch.netPrecision, localTimeZone)
                  ? formatDateOnly(launch.net, localTimeZone)
                  : formatNetLabel(launch.net, localTimeZone)}{' '}
                • {launch.pad.locationName || launch.pad.name}
              </div>
            </div>
            <AddToCalendarButton launch={launch} variant="icon" isAuthed />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderLogo({ provider, logoUrl }: { provider: string; logoUrl?: string }) {
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
          <span className="text-[10px] font-semibold text-text2">{initial}</span>
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
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }

  return new Date(year, monthIndex, 1);
}

function parseStatusParam(value: string | null): LaunchStatus | 'all' {
  return STATUS_OPTIONS.some((option) => option.value === value) ? (value as LaunchStatus | 'all') : 'all';
}

function parseRegionParam(value: string | null): (typeof REGION_OPTIONS)[number]['value'] {
  return REGION_OPTIONS.some((option) => option.value === value) ? (value as (typeof REGION_OPTIONS)[number]['value']) : 'all';
}

function shiftMonth(value: Date, delta: number) {
  const shifted = new Date(value.getFullYear(), value.getMonth() + delta, 1);
  return shifted.toISOString().slice(0, 7);
}

function updateCalendarQuery(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  updates: Record<string, string | null | undefined>
) {
  const next = new URLSearchParams(searchParams.toString());
  Object.entries(updates).forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === 'all') {
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
  options: { providerFilter: string; regionFilter: string; statusFilter: LaunchStatus | 'all' }
) {
  const params = new URLSearchParams({
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    limit: '1000'
  });

  if (options.providerFilter) params.set('provider', options.providerFilter);
  if (options.regionFilter !== 'all') params.set('region', options.regionFilter);
  if (options.statusFilter !== 'all') params.set('status', options.statusFilter);

  return `/api/launches/ics?${params.toString()}`;
}

function formatSelectedDay(dayKey: string, localTimeZone: string) {
  return formatDateOnly(`${dayKey}T12:00:00`, localTimeZone);
}

function formatLaunchCountLabel(count: number) {
  return `${count} launch${count === 1 ? '' : 'es'}`;
}
