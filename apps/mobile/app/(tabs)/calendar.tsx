import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { buildCalendarMonthDays, getCalendarMonthBounds, groupItemsByLocalDate, toLocalDateKey } from '@tminuszero/domain';
import { buildLaunchHref } from '@tminuszero/navigation';
import { useLaunchFeedPageQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchCalendarSheet } from '@/src/components/LaunchCalendarSheet';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';

export default function CalendarScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const tier = entitlementsQuery.data?.tier ?? 'anon';
  const canUseLaunchCalendar = entitlementsQuery.data?.capabilities.canUseLaunchCalendar === true;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const refreshIntervalMs = (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200) * 1000;
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarSheetLaunch, setCalendarSheetLaunch] = useState<LaunchCalendarLaunch | null>(null);

  useEffect(() => {
    const todayKey = toLocalDateKey(new Date());
    setSelectedDay(todayKey && todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`);
  }, [monthKey]);

  const selectedLaunches = selectedDay ? groupedLaunches.get(selectedDay) ?? [] : [];

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
          <ViewerTierCard tier={tier} featureKey="launch_calendar" testID="calendar-tier-card" />
        ) : null}

        {entitlementsQuery.isPending ? (
          <LoadingStateCard title="Loading calendar access" body="Checking your current membership." />
        ) : entitlementsQuery.isError ? (
          <ErrorStateCard title="Calendar unavailable" body={entitlementsQuery.error.message} />
        ) : !entitlementsQuery.data.isAuthed ? null : !canUseLaunchCalendar ? null : calendarQuery.isPending ? (
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

function CalendarRowButton({
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
        flex: 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: primary ? 'rgba(34, 211, 238, 0.24)' : theme.stroke,
        backgroundColor: primary ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 11,
        opacity: pressed ? 0.88 : 1
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
