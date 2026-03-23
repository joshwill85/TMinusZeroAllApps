import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import type { WatchlistRuleV1 } from '@tminuszero/api-client';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { buildCalendarMonthDays, getCalendarMonthBounds, getMobileViewerTier, groupItemsByLocalDate, toLocalDateKey } from '@tminuszero/domain';
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
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { getPublicSiteUrl } from '@/src/config/api';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';
import {
  formatWatchlistRuleCaption,
  formatWatchlistRuleLabel,
  resolvePrimaryWatchlist
} from '@/src/watchlists/usePrimaryWatchlist';

type CalendarFollowRule = WatchlistRuleV1 & {
  ruleType: 'launch' | 'provider' | 'pad';
};

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
  const monthKey = useMemo(() => month.toISOString().slice(0, 7), [month]);
  const monthBounds = useMemo(() => getCalendarMonthBounds(month), [month]);
  const calendarQuery = useLaunchFeedPageQuery(
    {
      scope: feedScope,
      from: monthBounds.from.toISOString(),
      to: monthBounds.to.toISOString(),
      sort: 'soonest',
      region: 'us',
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarSheetLaunch, setCalendarSheetLaunch] = useState<LaunchCalendarLaunch | null>(null);

  useEffect(() => {
    const todayKey = toLocalDateKey(new Date());
    setSelectedDay(todayKey && todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`);
  }, [monthKey]);

  const selectedLaunches = selectedDay ? groupedLaunches.get(selectedDay) ?? [] : [];
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

  const allLaunchesFeed = useMemo(
    () => calendarFeeds.find((feed) => feed.sourceKind === 'all_launches') ?? null,
    [calendarFeeds]
  );

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
          title={`${month.toLocaleString('default', { month: 'long' })} Launch Calendar`}
          description={
            tier === 'premium'
              ? 'Browse this month’s schedule, open launch detail, and use Premium exports on top of one-off calendar adds.'
              : 'Browse this month’s schedule, open launch detail, and add individual launches to your calendar.'
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
              <MonthButton
                label="Prev"
                onPress={() => {
                  setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
                }}
              />
              <MonthButton
                label="Next"
                onPress={() => {
                  setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
                }}
              />
            </View>

            <SectionCard title="Month view" description="Tap any day to read that date’s schedule.">
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
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
                    return (
                      <Pressable
                        key={day.key}
                        onPress={() => setSelectedDay(day.key)}
                        style={({ pressed }) => ({
                          width: '13.2%',
                          minHeight: 72,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: isSelected ? 'rgba(34, 211, 238, 0.32)' : theme.stroke,
                          backgroundColor: isSelected
                            ? 'rgba(34, 211, 238, 0.12)'
                            : pressed
                              ? 'rgba(255, 255, 255, 0.06)'
                              : 'rgba(255, 255, 255, 0.03)',
                          paddingHorizontal: 6,
                          paddingVertical: 8,
                          justifyContent: 'space-between'
                        })}
                      >
                        <Text style={{ color: day.isCurrentMonth ? theme.foreground : theme.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
                          {day.date.getDate()}
                        </Text>
                        {dayLaunches.length > 0 ? (
                          <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{dayLaunches.length}</Text>
                        ) : (
                          <View />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </SectionCard>

            <SectionCard
              title={selectedDay ? formatSelectedDay(selectedDay) : 'Selected day'}
              description={`${selectedLaunches.length} launch${selectedLaunches.length === 1 ? '' : 'es'} scheduled.`}
            >
              {selectedLaunches.length === 0 ? (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>No launches on this date.</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {selectedLaunches.map((launch) => (
                    <View
                      key={launch.id}
                      style={{
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 10
                      }}
                    >
                      <View style={{ gap: 4 }}>
                        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{launch.name}</Text>
                        <Text style={{ color: theme.muted, fontSize: 13 }}>
                          {launch.provider} • {launch.vehicle}
                        </Text>
                        <Text style={{ color: theme.muted, fontSize: 13 }}>
                          {formatLaunchTiming(launch.net, launch.netPrecision)} • {launch.pad.locationName || launch.pad.name}
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <CalendarRowButton
                          label="Details"
                          onPress={() => {
                            router.push(buildLaunchHref(launch.id) as Href);
                          }}
                          primary
                        />
                        <CalendarRowButton
                          label="Add"
                          onPress={() => {
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
                      </View>
                    </View>
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

function MonthButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 12
      })}
    >
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
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

function formatSelectedDay(dayKey: string) {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, {
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
