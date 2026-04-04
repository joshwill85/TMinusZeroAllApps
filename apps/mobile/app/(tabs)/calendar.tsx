import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import type { LaunchFeedV1, WatchlistRuleV1 } from '@tminuszero/api-client';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  buildCalendarMonthDays,
  buildCountdownSnapshot,
  formatLaunchCountdownClock,
  getCalendarMonthBounds,
  getMobileViewerTier,
  groupItemsByLocalDate,
  toLocalDateKey
} from '@tminuszero/domain';
import { buildLaunchHref } from '@tminuszero/navigation';
import {
  useCalendarFeedsQuery,
  useCreateCalendarFeedMutation,
  useDeleteCalendarFeedMutation,
  useFilterPresetsQuery,
  useLaunchFeedPageQuery,
  useRotateCalendarFeedMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchCalendarSheet } from '@/src/components/LaunchCalendarSheet';
import { LaunchShareIconButton } from '@/src/components/LaunchShareIconButton';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { getPublicSiteUrl } from '@/src/config/api';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';
import { shareLaunch } from '@/src/utils/launchShare';
import {
  formatWatchlistRuleCaption,
  formatWatchlistRuleLabel,
  resolvePrimaryWatchlist
} from '@/src/watchlists/usePrimaryWatchlist';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const EMPTY_GRID_SLOT_LABEL = 'Open';

type CalendarFollowRule = WatchlistRuleV1 & {
  ruleType: 'launch' | 'provider' | 'pad';
};

type CalendarLaunchItem = LaunchFeedV1['launches'][number];

function isCalendarFollowRule(rule: WatchlistRuleV1): rule is CalendarFollowRule {
  return rule.ruleType === 'launch' || rule.ruleType === 'provider' || rule.ruleType === 'pad';
}

export default function CalendarScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const { showToast } = useMobileToast();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const canUseLaunchCalendar = entitlementsQuery.data?.capabilities.canUseLaunchCalendar === true;
  const canUseRecurringCalendarFeeds = entitlementsQuery.data?.capabilities.canUseRecurringCalendarFeeds === true;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const refreshIntervalMs = (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200) * 1000;
  const calendarFeedsQuery = useCalendarFeedsQuery({ enabled: canUseRecurringCalendarFeeds });
  const filterPresetsQuery = useFilterPresetsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const createCalendarFeedMutation = useCreateCalendarFeedMutation();
  const deleteCalendarFeedMutation = useDeleteCalendarFeedMutation();
  const rotateCalendarFeedMutation = useRotateCalendarFeedMutation();
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const monthKey = useMemo(() => formatMonthKey(month), [month]);
  const monthBounds = useMemo(() => getCalendarMonthBounds(month), [month]);
  const calendarQuery = useLaunchFeedPageQuery(
    {
      scope: feedScope,
      from: monthBounds.from.toISOString(),
      to: monthBounds.to.toISOString(),
      sort: 'soonest',
      region: 'all',
      limit: 1000
    },
    {
      enabled: canUseLaunchCalendar,
      staleTimeMs: refreshIntervalMs
    }
  );
  const calendarDays = useMemo(() => buildCalendarMonthDays(month), [month]);
  const launches = useMemo(() => calendarQuery.data?.launches ?? [], [calendarQuery.data?.launches]);
  const groupedLaunches = useMemo(() => groupItemsByLocalDate(launches, (launch) => launch.net), [launches]);
  const launchDayKeys = useMemo(() => [...groupedLaunches.keys()].sort(), [groupedLaunches]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingSelectedDay, setPendingSelectedDay] = useState<string | null>(null);
  const [calendarSheetLaunch, setCalendarSheetLaunch] = useState<LaunchCalendarLaunch | null>(null);
  const [didInitializeSelection, setDidInitializeSelection] = useState(false);
  const selectedLaunches = selectedDay ? groupedLaunches.get(selectedDay) ?? [] : [];
  const launchDayCount = groupedLaunches.size;
  const nextLaunch = launches[0] ?? null;
  const hasMonthLaunches = launches.length > 0;
  const calendarFeeds = useMemo(() => calendarFeedsQuery.data?.feeds ?? [], [calendarFeedsQuery.data?.feeds]);
  const filterPresets = filterPresetsQuery.data?.presets ?? [];
  const primaryWatchlist = useMemo(
    () => resolvePrimaryWatchlist(watchlistsQuery.data?.watchlists ?? []),
    [watchlistsQuery.data?.watchlists]
  );
  const followRules = useMemo(
    () => (primaryWatchlist?.rules ?? []).filter(isCalendarFollowRule),
    [primaryWatchlist?.rules]
  );
  const localTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time', []);
  const todayKey = toLocalDateKey(new Date());
  const nearestLaunchDay = useMemo(() => getNearestLaunchDayKey(launchDayKeys, selectedDay), [launchDayKeys, selectedDay]);

  const allLaunchesFeed = useMemo(
    () => calendarFeeds.find((feed) => feed.sourceKind === 'all_launches') ?? null,
    [calendarFeeds]
  );

  useEffect(() => {
    setSelectedDay(null);
    setDidInitializeSelection(false);
  }, [monthKey]);

  useEffect(() => {
    if (didInitializeSelection || calendarQuery.isPending || calendarQuery.isError) {
      return;
    }

    if (pendingSelectedDay && pendingSelectedDay.startsWith(monthKey)) {
      setSelectedDay(pendingSelectedDay);
      setPendingSelectedDay(null);
      setDidInitializeSelection(true);
      return;
    }

    const currentTodayKey = toLocalDateKey(new Date());
    const todayInMonth = currentTodayKey && currentTodayKey.startsWith(monthKey) ? currentTodayKey : null;
    const firstLaunchDay = launchDayKeys[0] ?? null;
    const initialSelectedDay =
      (todayInMonth && groupedLaunches.has(todayInMonth) ? todayInMonth : null) ||
      firstLaunchDay ||
      todayInMonth ||
      `${monthKey}-01`;

    setSelectedDay(initialSelectedDay);
    setDidInitializeSelection(true);
  }, [
    calendarQuery.isError,
    calendarQuery.isPending,
    didInitializeSelection,
    groupedLaunches,
    launchDayKeys,
    monthKey,
    pendingSelectedDay
  ]);

  function buildCalendarFeedUrl(token: string) {
    return `${getPublicSiteUrl()}/api/calendar/${encodeURIComponent(token)}.ics`;
  }

  function findFeedForPreset(presetId: string) {
    return calendarFeeds.find((feed) => feed.sourceKind === 'preset' && feed.presetId === presetId) ?? null;
  }

  function findFeedForFollow(ruleType: string, ruleValue: string) {
    return (
      calendarFeeds.find(
        (feed) =>
          feed.sourceKind === 'follow' &&
          feed.followRuleType === ruleType &&
          String(feed.followRuleValue || '').trim().toLowerCase() === String(ruleValue || '').trim().toLowerCase()
      ) ?? null
    );
  }

  function openSelectedDay(dayKey: string) {
    const parsedDay = parseDayKey(dayKey);
    if (!parsedDay) {
      return;
    }

    const nextMonth = new Date(parsedDay.getFullYear(), parsedDay.getMonth(), 1);
    if (formatMonthKey(nextMonth) !== monthKey) {
      setPendingSelectedDay(dayKey);
      setMonth(nextMonth);
      return;
    }

    setSelectedDay(dayKey);
    setDidInitializeSelection(true);
  }

  function navigateMonth(offset: number) {
    setPendingSelectedDay(null);
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  }

  function jumpToToday() {
    if (!todayKey) {
      return;
    }

    openSelectedDay(todayKey);
  }

  function navigateDay(offset: number) {
    const nextDayKey = shiftDayKey(selectedDay || `${monthKey}-01`, offset);
    if (!nextDayKey) {
      return;
    }

    openSelectedDay(nextDayKey);
  }

  async function shareFeedUrl(token: string) {
    const url = buildCalendarFeedUrl(token);
    await Share.share({
      message: url,
      url
    });
  }

  async function ensureAndShareAllLaunchesFeed() {
    try {
      const existing = allLaunchesFeed;
      if (existing) {
        await shareFeedUrl(existing.token);
        return;
      }

      const payload = await createCalendarFeedMutation.mutateAsync({
        name: 'All launches',
        sourceKind: 'all_launches',
        filters: {
          range: 'all',
          region: 'all',
          sort: 'soonest'
        }
      });
      await shareFeedUrl(payload.feed.token);
      showToast({ message: 'Created a dynamic All launches calendar feed.', tone: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : 'Unable to create or share that calendar feed.',
        tone: 'warning'
      });
    }
  }

  async function ensureAndSharePresetFeed(presetId: string, presetName: string) {
    try {
      const existing = findFeedForPreset(presetId);
      if (existing) {
        await shareFeedUrl(existing.token);
        return;
      }

      const payload = await createCalendarFeedMutation.mutateAsync({
        name: presetName,
        sourceKind: 'preset',
        presetId
      });
      await shareFeedUrl(payload.feed.token);
      showToast({ message: `Created a dynamic feed for ${presetName}.`, tone: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Unable to create or share ${presetName}.`,
        tone: 'warning'
      });
    }
  }

  async function ensureAndShareFollowFeed(ruleType: 'launch' | 'provider' | 'pad', ruleValue: string, label: string) {
    try {
      const existing = findFeedForFollow(ruleType, ruleValue);
      if (existing) {
        await shareFeedUrl(existing.token);
        return;
      }

      const payload = await createCalendarFeedMutation.mutateAsync({
        name: label,
        sourceKind: 'follow',
        followRuleType: ruleType,
        followRuleValue: ruleValue
      });
      await shareFeedUrl(payload.feed.token);
      showToast({ message: `Created a dynamic feed for ${label}.`, tone: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Unable to create or share ${label}.`,
        tone: 'warning'
      });
    }
  }

  return (
    <>
      <AppScreen testID="calendar-screen">
        <ScreenHeader
          eyebrow={tier === 'premium' ? 'Premium calendar' : 'Launch calendar'}
          title={`${formatMonthLabel(month)} Launch Calendar`}
          description={
            tier === 'premium'
              ? 'Browse launch dates, tap into the day’s schedule, and use Premium exports on top of one-off calendar adds.'
              : 'Browse launch dates, tap into the day’s schedule, and add individual launches to your calendar.'
          }
        />

        {!entitlementsQuery.isPending && !entitlementsQuery.isError ? (
          <ViewerTierCard tier={tier} isAuthed={isAuthed} featureKey="launch_calendar" testID="calendar-tier-card" />
        ) : null}

        {entitlementsQuery.isPending ? (
          <LoadingStateCard title="Loading calendar access" body="Checking your current membership." />
        ) : entitlementsQuery.isError ? (
          <ErrorStateCard title="Calendar unavailable" body={entitlementsQuery.error.message} />
        ) : !canUseLaunchCalendar ? null : calendarQuery.isPending ? (
          <LoadingStateCard title="Loading launches" body="Fetching this month’s launch calendar." />
        ) : calendarQuery.isError ? (
          <ErrorStateCard title="Calendar unavailable" body={calendarQuery.error.message} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MonthButton label="Prev month" onPress={() => navigateMonth(-1)} />
              <MonthButton label="Jump to today" onPress={jumpToToday} primary disabled={!todayKey} />
              <MonthButton label="Next month" onPress={() => navigateMonth(1)} />
            </View>

            <SectionCard
              testID="calendar-month-summary"
              title="Month summary"
              description={
                hasMonthLaunches
                  ? `${launches.length} launch${launches.length === 1 ? '' : 'es'} across ${launchDayCount} active day${launchDayCount === 1 ? '' : 's'}.`
                  : 'No launches are currently scheduled for this month.'
              }
            >
              <View style={{ gap: 8 }}>
                {nextLaunch ? (
                  <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                    Next launch: {nextLaunch.name} on {formatLaunchTiming(nextLaunch.net, nextLaunch.netPrecision)}.
                  </Text>
                ) : (
                  <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                    Check another month to browse the next scheduled missions.
                  </Text>
                )}
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>Times are shown in {localTimeZone}.</Text>
              </View>
            </SectionCard>

            {launchDayKeys.length > 0 ? (
              <SectionCard title="Launch dates" description="Jump straight to the dates that already have scheduled launches.">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
                  {launchDayKeys.map((dayKey) => (
                    <LaunchDateChip
                      key={dayKey}
                      dayKey={dayKey}
                      count={groupedLaunches.get(dayKey)?.length ?? 0}
                      selected={selectedDay === dayKey}
                      onPress={() => openSelectedDay(dayKey)}
                    />
                  ))}
                </ScrollView>
              </SectionCard>
            ) : null}

            <SectionCard title="Month view" description="Tap a day to reveal launch cards below. Dots mark scheduled launches.">
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {WEEKDAY_LABELS.map((label) => (
                    <Text
                      key={label}
                      style={{
                        width: '13%',
                        color: theme.muted,
                        fontSize: 11,
                        fontWeight: '700',
                        textAlign: 'center',
                        textTransform: 'uppercase'
                      }}
                    >
                      {label}
                    </Text>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {calendarDays.map((day) => {
                    const dayLaunches = groupedLaunches.get(day.key) ?? [];
                    const isSelected = selectedDay === day.key;
                    const isToday = todayKey === day.key;
                    return (
                      <Pressable
                        key={day.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatSelectedDay(day.key)}${dayLaunches.length ? `, ${dayLaunches.length} launch${dayLaunches.length === 1 ? '' : 'es'}` : ', no launches'}`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => openSelectedDay(day.key)}
                        style={({ pressed }) => ({
                          width: '13.2%',
                          minHeight: 86,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: isSelected ? 'rgba(34, 211, 238, 0.32)' : isToday ? 'rgba(34, 211, 238, 0.24)' : theme.stroke,
                          backgroundColor: isSelected
                            ? 'rgba(34, 211, 238, 0.12)'
                            : pressed
                              ? 'rgba(255, 255, 255, 0.06)'
                              : 'rgba(255, 255, 255, 0.03)',
                          paddingHorizontal: 7,
                          paddingVertical: 8,
                          justifyContent: 'space-between'
                        })}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <Text style={{ color: day.isCurrentMonth ? theme.foreground : theme.muted, fontSize: 12, fontWeight: '700' }}>
                            {day.date.getDate()}
                          </Text>
                          {isToday ? <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: theme.accent }} /> : null}
                        </View>

                        <View style={{ gap: 6 }}>
                          <CalendarDayDots count={dayLaunches.length} />
                          <Text style={{ color: dayLaunches.length ? theme.accent : theme.muted, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
                            {dayLaunches.length ? `${dayLaunches.length} launch${dayLaunches.length === 1 ? '' : 'es'}` : day.isCurrentMonth ? EMPTY_GRID_SLOT_LABEL : 'Month'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </SectionCard>

            <SectionCard
              testID="calendar-selected-day"
              title={selectedDay ? formatSelectedDay(selectedDay) : 'Selected day'}
              description={
                hasMonthLaunches
                  ? `${selectedLaunches.length} launch${selectedLaunches.length === 1 ? '' : 'es'} scheduled.`
                  : 'No launches are currently scheduled this month.'
              }
            >
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <InlineActionButton label="Previous day" onPress={() => navigateDay(-1)} />
                <InlineActionButton label="Next day" onPress={() => navigateDay(1)} />
                {nearestLaunchDay && selectedLaunches.length === 0 && nearestLaunchDay !== selectedDay ? (
                  <InlineActionButton label={`Jump to ${formatCompactDay(nearestLaunchDay)}`} onPress={() => openSelectedDay(nearestLaunchDay)} primary />
                ) : null}
              </View>

              {!hasMonthLaunches ? (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>No launches scheduled this month.</Text>
              ) : selectedLaunches.length === 0 ? (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                  No launches on this date. Keep stepping through past and future dates or jump to the nearest scheduled day.
                </Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {selectedLaunches.map((launch) => (
                    <CalendarLaunchCard
                      key={launch.id}
                      launch={launch}
                      onOpenDetails={() => {
                        router.push(buildLaunchHref(launch.id) as Href);
                      }}
                      onAddToCalendar={() => {
                        setCalendarSheetLaunch({
                          id: launch.id,
                          name: launch.name,
                          provider: launch.provider,
                          vehicle: launch.vehicle,
                          net: launch.net,
                          netPrecision: launch.netPrecision,
                          windowEnd: launch.windowEnd ?? null,
                          pad: {
                            name: launch.pad.name,
                            state: launch.pad.state
                          }
                        });
                      }}
                    />
                  ))}
                </View>
              )}
            </SectionCard>

            <SectionCard
              title="Premium calendar feeds"
              description="Export dynamic feeds for all launches, saved presets, or individual follows. New matching launches appear automatically in subscribed calendars."
            >
              {canUseRecurringCalendarFeeds ? (
                <View style={{ gap: 12 }}>
                  {calendarFeedsQuery.isPending ? (
                    <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>Loading recurring calendar feeds…</Text>
                  ) : calendarFeedsQuery.isError ? (
                    <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{calendarFeedsQuery.error.message}</Text>
                  ) : (
                    <>
                      <CalendarFeedSourceRow
                        title="All launches"
                        caption="One dynamic feed for every launch worldwide."
                        actionLabel={allLaunchesFeed ? 'Share feed' : 'Create feed'}
                        onPress={() => {
                          void ensureAndShareAllLaunchesFeed();
                        }}
                        disabled={createCalendarFeedMutation.isPending}
                      />

                      {filterPresets.length > 0 ? (
                        <View style={{ gap: 8 }}>
                          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Saved presets</Text>
                          {filterPresets.map((preset) => (
                            <CalendarFeedSourceRow
                              key={preset.id}
                              title={preset.name}
                              caption={findFeedForPreset(preset.id) ? 'Existing dynamic feed ready to share.' : 'Create a dynamic feed from this saved preset.'}
                              actionLabel={findFeedForPreset(preset.id) ? 'Share feed' : 'Create feed'}
                              onPress={() => {
                                void ensureAndSharePresetFeed(preset.id, preset.name);
                              }}
                              disabled={createCalendarFeedMutation.isPending}
                            />
                          ))}
                        </View>
                      ) : null}

                      {followRules.length > 0 ? (
                        <View style={{ gap: 8 }}>
                          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Following</Text>
                          {followRules.map((rule) => (
                            <CalendarFeedSourceRow
                              key={rule.id}
                              title={formatWatchlistRuleLabel(rule)}
                              caption={formatWatchlistRuleCaption(rule)}
                              actionLabel={findFeedForFollow(rule.ruleType, rule.ruleValue) ? 'Share feed' : 'Create feed'}
                              onPress={() => {
                                void ensureAndShareFollowFeed(rule.ruleType, rule.ruleValue, formatWatchlistRuleLabel(rule));
                              }}
                              disabled={createCalendarFeedMutation.isPending}
                            />
                          ))}
                        </View>
                      ) : null}

                      {calendarFeeds.length > 0 ? (
                        <View style={{ gap: 8 }}>
                          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>Existing feeds</Text>
                          {calendarFeeds.map((feed) => (
                            <View
                              key={feed.id}
                              style={{
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: theme.stroke,
                                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                padding: 14,
                                gap: 10
                              }}
                            >
                              <View style={{ gap: 4 }}>
                                <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{feed.name}</Text>
                                <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                                  {feed.sourceKind === 'preset'
                                    ? 'Preset-based dynamic feed'
                                    : feed.sourceKind === 'follow'
                                      ? 'Follow-based dynamic feed'
                                      : 'All launches dynamic feed'}
                                </Text>
                              </View>
                              <View style={{ flexDirection: 'row', gap: 10 }}>
                                <CalendarRowButton
                                  label="Share"
                                  onPress={() => {
                                    void shareFeedUrl(feed.token);
                                  }}
                                  primary
                                />
                                <CalendarRowButton
                                  label={rotateCalendarFeedMutation.isPending ? 'Rotating…' : 'Rotate'}
                                  onPress={() => {
                                    void (async () => {
                                      try {
                                        const payload = await rotateCalendarFeedMutation.mutateAsync(feed.id);
                                        await shareFeedUrl(payload.feed.token);
                                        showToast({ message: `Rotated ${feed.name}.`, tone: 'success' });
                                      } catch (error) {
                                        showToast({
                                          message: error instanceof Error ? error.message : `Unable to rotate ${feed.name}.`,
                                          tone: 'warning'
                                        });
                                      }
                                    })();
                                  }}
                                />
                                <CalendarRowButton
                                  label={deleteCalendarFeedMutation.isPending ? 'Deleting…' : 'Delete'}
                                  onPress={() => {
                                    void (async () => {
                                      try {
                                        await deleteCalendarFeedMutation.mutateAsync(feed.id);
                                        showToast({ message: `Deleted ${feed.name}.`, tone: 'info' });
                                      } catch (error) {
                                        showToast({
                                          message: error instanceof Error ? error.message : `Unable to delete ${feed.name}.`,
                                          tone: 'warning'
                                        });
                                      }
                                    })();
                                  }}
                                />
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              ) : (
                <ViewerTierCard
                  tier="anon"
                  isAuthed={isAuthed}
                  featureKey="recurring_calendar_feeds"
                  onPress={() => {
                    router.push('/profile');
                  }}
                />
              )}
            </SectionCard>
          </>
        )}
      </AppScreen>

      <LaunchCalendarSheet launch={calendarSheetLaunch} open={calendarSheetLaunch != null} onClose={() => setCalendarSheetLaunch(null)} />
    </>
  );
}

function MonthButton({
  label,
  onPress,
  primary = false,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: primary ? 'rgba(34, 211, 238, 0.24)' : theme.stroke,
        backgroundColor: primary ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 12,
        opacity: disabled ? 0.5 : pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: primary ? theme.accent : theme.foreground, fontSize: 13, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function LaunchDateChip({
  dayKey,
  count,
  selected,
  onPress
}: {
  dayKey: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 108,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: selected ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
        backgroundColor: selected ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 4
      })}
    >
      <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>{formatCompactDay(dayKey)}</Text>
      <Text style={{ color: count ? theme.accent : theme.muted, fontSize: 11, fontWeight: '700' }}>
        {count} launch{count === 1 ? '' : 'es'}
      </Text>
    </Pressable>
  );
}

function CalendarDayDots({ count }: { count: number }) {
  const { theme } = useMobileBootstrap();
  const dots = Math.min(Math.max(count, 0), 3);

  return (
    <View style={{ minHeight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {dots > 0
        ? Array.from({ length: dots }).map((_, index) => (
            <View key={index} style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: theme.accent }} />
          ))
        : null}
    </View>
  );
}

function CalendarLaunchCard({
  launch,
  onOpenDetails,
  onAddToCalendar
}: {
  launch: CalendarLaunchItem;
  onOpenDetails: () => void;
  onAddToCalendar: () => void;
}) {
  const { theme } = useMobileBootstrap();
  const countdownLabel = buildLaunchCountdownLabel(launch.net, launch.netPrecision);
  const locationLabel = launch.pad.locationName || launch.pad.name;
  const windowLabel = buildWindowLabel(launch.net, launch.windowEnd ?? null);
  const statusLabel = String(launch.statusText || launch.status || 'Unknown').trim();

  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        padding: 14,
        gap: 12
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{launch.name}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            {launch.provider} • {launch.vehicle}
          </Text>
        </View>
        <CalendarStatusPill status={launch.status} label={statusLabel} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <CalendarInfoPill label={formatLaunchTiming(launch.net, launch.netPrecision)} emphasis />
        {countdownLabel ? <CalendarInfoPill label={countdownLabel} /> : null}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.muted, fontSize: 13 }}>{locationLabel}</Text>
        {windowLabel ? <Text style={{ color: theme.muted, fontSize: 13 }}>{windowLabel}</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CalendarRowButton label="Details" onPress={onOpenDetails} primary />
        <CalendarRowButton label="Add" onPress={onAddToCalendar} />
        <LaunchShareIconButton
          onPress={() => {
            void shareLaunch({
              id: launch.id,
              name: launch.name,
              net: launch.net,
              provider: launch.provider,
              vehicle: launch.vehicle,
              statusText: launch.statusText,
              status: launch.status,
              padLabel: launch.pad.shortCode || launch.pad.name,
              padLocation: launch.pad.locationName || launch.pad.state
            });
          }}
          size={40}
          iconColor={theme.foreground}
          borderColor={theme.stroke}
          backgroundColor="rgba(255, 255, 255, 0.03)"
          pressedBackgroundColor="rgba(255, 255, 255, 0.08)"
        />
      </View>
    </View>
  );
}

function CalendarInfoPill({ label, emphasis = false }: { label: string; emphasis?: boolean }) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: emphasis ? 'rgba(34, 211, 238, 0.2)' : theme.stroke,
        backgroundColor: emphasis ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: emphasis ? theme.accent : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function CalendarStatusPill({
  status,
  label
}: {
  status: CalendarLaunchItem['status'];
  label: string;
}) {
  const { theme } = useMobileBootstrap();
  const tone = getStatusTone(status, theme.accent);

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tone.border,
        backgroundColor: tone.background,
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: tone.text, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function CalendarFeedSourceRow({
  title,
  caption,
  actionLabel,
  onPress,
  disabled = false
}: {
  title: string;
  caption: string;
  actionLabel: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        padding: 14,
        gap: 10
      }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{caption}</Text>
      </View>
      <CalendarRowButton label={actionLabel} onPress={onPress} primary disabled={disabled} />
    </View>
  );
}

function InlineActionButton({
  label,
  onPress,
  primary = false
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: primary ? 'rgba(34, 211, 238, 0.22)' : theme.stroke,
        backgroundColor: primary ? 'rgba(34, 211, 238, 0.08)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: primary ? theme.accent : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function CalendarRowButton({
  label,
  onPress,
  primary = false,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: primary ? 'rgba(34, 211, 238, 0.24)' : theme.stroke,
        backgroundColor: primary ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 11,
        opacity: disabled ? 0.5 : pressed ? 0.88 : 1
      })}
    >
      <Text style={{ color: primary ? theme.accent : theme.foreground, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
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

function parseDayKey(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function shiftDayKey(dayKey: string, offset: number) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) {
    return null;
  }

  parsed.setDate(parsed.getDate() + offset);
  return toLocalDateKey(parsed);
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

function formatSelectedDay(dayKey: string) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) {
    return dayKey;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  });
}

function formatLaunchTiming(net: string, netPrecision: string) {
  const date = new Date(net);
  if (Number.isNaN(date.getTime())) return 'NET TBD';
  if (netPrecision === 'day' || netPrecision === 'month' || netPrecision === 'tbd') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function buildLaunchCountdownLabel(net: string, netPrecision: string) {
  if (netPrecision === 'day' || netPrecision === 'month' || netPrecision === 'tbd') {
    return null;
  }

  const snapshot = buildCountdownSnapshot(net);
  if (!snapshot) {
    return null;
  }

  return formatLaunchCountdownClock(snapshot.totalMs);
}

function buildWindowLabel(net: string, windowEnd: string | null) {
  if (!windowEnd || windowEnd === net) {
    return null;
  }

  return `Window closes ${formatLaunchTiming(windowEnd, 'minute')}`;
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

function getStatusTone(status: CalendarLaunchItem['status'], accent: string) {
  switch (status) {
    case 'go':
      return {
        text: '#7ff0bc',
        background: 'rgba(52, 211, 153, 0.16)',
        border: 'rgba(52, 211, 153, 0.24)'
      };
    case 'hold':
      return {
        text: '#ffd36e',
        background: 'rgba(251, 191, 36, 0.16)',
        border: 'rgba(251, 191, 36, 0.24)'
      };
    case 'scrubbed':
      return {
        text: '#ff9aab',
        background: 'rgba(251, 113, 133, 0.16)',
        border: 'rgba(251, 113, 133, 0.24)'
      };
    default:
      return {
        text: accent,
        background: 'rgba(34, 211, 238, 0.1)',
        border: 'rgba(34, 211, 238, 0.2)'
      };
  }
}
