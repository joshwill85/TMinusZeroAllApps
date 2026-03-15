import { Image, Linking, Pressable, Text, View } from 'react-native';
import type { LaunchFeedItemV1 } from '@tminuszero/contracts';
import { buildCountdownSnapshot } from '@tminuszero/domain';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatTimestamp } from '@/src/utils/format';

type WebParityLaunchCardProps = {
  launch: LaunchFeedItemV1;
  isNext?: boolean;
  testID?: string;
  onOpenDetails: () => void;
  onOpenProvider?: () => void;
  onOpenPad?: () => void;
  isWatched?: boolean;
  watchDisabled?: boolean;
  onToggleWatch?: () => void;
  isProviderFollowed?: boolean;
  providerFollowDisabled?: boolean;
  onToggleFollowProvider?: () => void;
  isPadFollowed?: boolean;
  padFollowDisabled?: boolean;
  onToggleFollowPad?: () => void;
};

type StatusTone = {
  borderColor: string;
  fillColor: string;
  pillBackground: string;
  pillText: string;
  pillBorder: string;
};

const STATUS_TONES: Record<LaunchFeedItemV1['status'], StatusTone> = {
  go: {
    borderColor: 'rgba(52, 211, 153, 0.28)',
    fillColor: 'rgba(52, 211, 153, 0.92)',
    pillBackground: 'rgba(52, 211, 153, 0.16)',
    pillText: '#7ff0bc',
    pillBorder: 'rgba(52, 211, 153, 0.24)'
  },
  hold: {
    borderColor: 'rgba(251, 191, 36, 0.28)',
    fillColor: 'rgba(251, 191, 36, 0.92)',
    pillBackground: 'rgba(251, 191, 36, 0.16)',
    pillText: '#ffd36e',
    pillBorder: 'rgba(251, 191, 36, 0.24)'
  },
  scrubbed: {
    borderColor: 'rgba(251, 113, 133, 0.28)',
    fillColor: 'rgba(251, 113, 133, 0.92)',
    pillBackground: 'rgba(251, 113, 133, 0.16)',
    pillText: '#ff9aab',
    pillBorder: 'rgba(251, 113, 133, 0.24)'
  },
  tbd: {
    borderColor: 'rgba(234, 240, 255, 0.12)',
    fillColor: 'rgba(127, 139, 176, 0.92)',
    pillBackground: 'rgba(127, 139, 176, 0.14)',
    pillText: '#b9c6e8',
    pillBorder: 'rgba(234, 240, 255, 0.12)'
  },
  unknown: {
    borderColor: 'rgba(234, 240, 255, 0.12)',
    fillColor: 'rgba(127, 139, 176, 0.92)',
    pillBackground: 'rgba(127, 139, 176, 0.14)',
    pillText: '#b9c6e8',
    pillBorder: 'rgba(234, 240, 255, 0.12)'
  }
};

export function WebParityLaunchCard({
  launch,
  isNext = false,
  testID,
  onOpenDetails,
  onOpenProvider,
  onOpenPad,
  isWatched = false,
  watchDisabled = false,
  onToggleWatch,
  isProviderFollowed = false,
  providerFollowDisabled = false,
  onToggleFollowProvider,
  isPadFollowed = false,
  padFollowDisabled = false,
  onToggleFollowPad
}: WebParityLaunchCardProps) {
  const { theme } = useMobileBootstrap();
  const statusTone = STATUS_TONES[launch.status] ?? STATUS_TONES.unknown;
  const countdownDisplay = buildCountdownDisplay(launch.net);
  const orbitLabel = buildOrbitLabel(launch);
  const providerLabel = String(launch.provider || 'Launch').trim().toUpperCase();
  const providerLogoUrl = typeof launch.providerLogoUrl === 'string' ? launch.providerLogoUrl.trim() : '';
  const backgroundImageUrl = launch.image?.thumbnail || launch.image?.full || null;
  const coverageUrl = buildCoverageUrl(launch);
  const activeEvent = launch.currentEvent ?? launch.nextEvent;
  const activeEventTag = launch.currentEvent ? 'Current event' : activeEvent ? 'Next event' : null;
  const activeEventLabel = activeEvent?.date ? formatTimestamp(activeEvent.date) : null;
  const firstStageBooster = normalizeKnownValue(launch.firstStageBooster);
  const vehicleLabel = buildVehicleLabel(launch);
  const showVehicle = shouldShowVehicle(launch);
  const padLabel = buildPadLabel(launch);
  const padMeta = buildPadMeta(launch);
  const weatherSummary = buildWeatherSummary(launch.weatherConcerns);
  const windowSummary = buildWindowSummary(launch.windowStart ?? launch.net, launch.windowEnd ?? launch.windowStart ?? launch.net);
  const timeLabel = launch.netPrecision === 'day' || launch.netPrecision === 'tbd' ? 'NET window' : 'Liftoff';

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onOpenDetails}
      style={({ pressed }) => ({
        position: 'relative',
        overflow: 'hidden',
        gap: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: statusTone.borderColor,
        backgroundColor: 'rgba(11, 16, 35, 0.82)',
        paddingHorizontal: 18,
        paddingVertical: 18,
        shadowColor: '#000000',
        shadowOpacity: 0.34,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
        elevation: 10,
        transform: [{ scale: pressed ? 0.988 : 1 }]
      })}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: 'rgba(7, 9, 19, 0.16)'
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: 'rgba(234, 240, 255, 0.12)'
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: 4,
          height: isNext ? '100%' : '62%',
          backgroundColor: statusTone.fillColor
        }}
      />
      {backgroundImageUrl ? (
        <Image
          source={{ uri: backgroundImageUrl }}
          resizeMode="cover"
          style={{
            position: 'absolute',
            right: -28,
            top: -20,
            bottom: -20,
            width: '72%',
            opacity: launch.status === 'scrubbed' ? 0.16 : 0.24
          }}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -90,
          right: -70,
          width: 220,
          height: 220,
          borderRadius: 220,
          backgroundColor: 'rgba(34, 211, 238, 0.08)'
        }}
      />

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {providerLogoUrl ? (
              <Pressable onPress={onOpenProvider} disabled={!onOpenProvider}>
                <Image source={{ uri: providerLogoUrl }} resizeMode="contain" style={{ width: 132, height: 34 }} />
              </Pressable>
            ) : (
              <Pressable
                onPress={onOpenProvider}
                disabled={!onOpenProvider}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  backgroundColor: pressed ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.05)',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  opacity: onOpenProvider ? 1 : 0.94
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.muted,
                    fontSize: 11,
                    fontWeight: '800',
                    letterSpacing: 1.3,
                    textTransform: 'uppercase'
                  }}
                >
                  {providerLabel}
                </Text>
              </Pressable>
            )}
            {launch.featured ? (
              <BadgePill label="Featured" textColor={theme.muted} backgroundColor="rgba(255, 255, 255, 0.05)" borderColor="rgba(255, 255, 255, 0.1)" />
            ) : null}
            {isNext ? <BadgePill label="Next launch" textColor={theme.accent} backgroundColor="rgba(34, 211, 238, 0.08)" borderColor="rgba(34, 211, 238, 0.18)" /> : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StatusPill label={buildStatusLabel(launch)} tone={statusTone} />
            {launch.weatherIconUrl ? (
              <View
                style={{
                  height: 40,
                  width: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)'
                }}
              >
                <Image source={{ uri: launch.weatherIconUrl }} resizeMode="contain" style={{ width: 24, height: 24 }} />
              </View>
            ) : weatherSummary ? (
              <BadgePill label="Weather" textColor={theme.muted} backgroundColor="rgba(255, 255, 255, 0.04)" borderColor="rgba(255, 255, 255, 0.08)" />
            ) : null}
          </View>
        </View>

        <Text style={{ color: theme.foreground, fontSize: 20, fontWeight: '800', lineHeight: 25 }}>{launch.name}</Text>

        <View style={{ gap: 5 }}>
          {showVehicle ? (
            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
              {vehicleLabel}
            </Text>
          ) : null}
          {firstStageBooster ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#556080', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                First-stage booster:
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>{firstStageBooster}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={onOpenPad}
              disabled={!onOpenPad}
              style={({ pressed }) => ({
                opacity: onOpenPad ? (pressed ? 0.78 : 1) : 1
              })}
            >
              <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                {padLabel}
              </Text>
            </Pressable>
            {padMeta ? <Text style={{ color: '#556080', fontSize: 12 }}>{padMeta}</Text> : null}
          </View>
        </View>
      </View>

      {(activeEventTag && activeEvent) || launch.changeSummary ? (
        <View style={{ gap: 8 }}>
          {activeEventTag && activeEvent ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <BadgePill
                label={activeEventTag}
                textColor={theme.muted}
                backgroundColor="rgba(255, 255, 255, 0.04)"
                borderColor="rgba(255, 255, 255, 0.08)"
                compact
              />
              <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>{activeEvent.name}</Text>
              {activeEventLabel ? <Text style={{ color: theme.muted, fontSize: 12 }}>{activeEventLabel}</Text> : null}
            </View>
          ) : null}
          {launch.changeSummary ? (
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Update: {launch.changeSummary}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>{timeLabel}</Text>
          <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>{formatTimestamp(launch.net)}</Text>
          {weatherSummary ? (
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }} numberOfLines={2}>
              {weatherSummary}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            maxWidth: '48%',
            minWidth: 122,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.06)',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            paddingHorizontal: 12,
            paddingVertical: 10
          }}
        >
          <Text
            style={{
              color: theme.foreground,
              fontSize: 24,
              fontWeight: '300',
              letterSpacing: 0.4,
              lineHeight: 27,
              textAlign: 'right',
              fontVariant: ['tabular-nums']
            }}
          >
            {countdownDisplay}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CardActionButton
          label={launch.webcastLive ? 'Watch live' : coverageUrl ? (launch.status === 'scrubbed' ? 'Replay' : 'Watch') : 'Coverage'}
          disabled={!coverageUrl}
          onPress={() => {
            if (!coverageUrl) return;
            void Linking.openURL(coverageUrl);
          }}
          variant="primary"
        />
        <CardActionButton label={launch.status === 'scrubbed' ? 'Report' : 'Details'} onPress={onOpenDetails} variant="secondary" />
      </View>

      {onToggleWatch || onToggleFollowProvider || onToggleFollowPad ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {onToggleWatch ? (
            <FollowChip
              label={isWatched ? 'In My Launches' : 'My Launches'}
              active={isWatched}
              disabled={watchDisabled}
              onPress={onToggleWatch}
            />
          ) : null}
          {onToggleFollowProvider ? (
            <FollowChip
              label={isProviderFollowed ? 'Following provider' : 'Follow provider'}
              active={isProviderFollowed}
              disabled={providerFollowDisabled}
              onPress={onToggleFollowProvider}
            />
          ) : null}
          {onToggleFollowPad ? (
            <FollowChip
              label={isPadFollowed ? `Following ${padLabel}` : `Follow ${padLabel}`}
              active={isPadFollowed}
              disabled={padFollowDisabled}
              onPress={onToggleFollowPad}
            />
          ) : null}
        </View>
      ) : null}

      <View
        style={{
          gap: 12,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255, 255, 255, 0.05)',
          paddingTop: 12
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DataCell label="Orbit" value={orbitLabel} />
        </View>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' }}>
              NET window
            </Text>
            <StatusTag label={windowSummary.statusLabel} tone={windowSummary.tone} />
          </View>
          <View
            style={{
              height: 6,
              overflow: 'hidden',
              borderRadius: 999,
              backgroundColor: 'rgba(255, 255, 255, 0.06)'
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${windowSummary.progressPct}%`,
                borderRadius: 999,
                backgroundColor: windowSummary.fillColor
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' }}>
                NET start
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700', lineHeight: 19, fontVariant: ['tabular-nums'] }}>
                {windowSummary.startLabel}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' }}>
                NET end
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700', lineHeight: 19, fontVariant: ['tabular-nums'] }}>
                {windowSummary.endLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function CardActionButton({
  label,
  onPress,
  disabled = false,
  variant
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: variant === 'primary' ? 1.15 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: variant === 'primary' ? 'rgba(34, 211, 238, 0.28)' : 'rgba(234, 240, 255, 0.12)',
        backgroundColor:
          variant === 'primary'
            ? pressed
              ? 'rgba(34, 211, 238, 0.16)'
              : 'rgba(34, 211, 238, 0.12)'
            : pressed
              ? 'rgba(255, 255, 255, 0.07)'
              : 'rgba(255, 255, 255, 0.04)',
        paddingHorizontal: 14,
        paddingVertical: 11,
        opacity: disabled ? 0.45 : 1
      })}
    >
      <Text
        style={{
          color: variant === 'primary' ? '#6fe8ff' : '#eaf0ff',
          fontSize: 13,
          fontWeight: '700'
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BadgePill({
  label,
  textColor,
  backgroundColor,
  borderColor,
  compact = false
}: {
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: compact ? 4 : 6
      }}
    >
      <Text style={{ color: textColor, fontSize: compact ? 9 : 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}

function FollowChip({
  label,
  active,
  disabled = false,
  onPress
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : 'rgba(234, 240, 255, 0.12)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.04)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tone.pillBorder,
        backgroundColor: tone.pillBackground,
        paddingHorizontal: 10,
        paddingVertical: 7
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: tone.fillColor }} />
      <Text style={{ color: tone.pillText, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.06)',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 10
      }}
    >
      <Text style={{ color: '#7f8bb0', fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ marginTop: 4, color: '#eaf0ff', fontSize: 13, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function StatusTag({
  label,
  tone
}: {
  label: string;
  tone: 'info' | 'success' | 'warning' | 'neutral';
}) {
  const styles =
    tone === 'success'
      ? { text: '#7ff0bc', bg: 'rgba(52, 211, 153, 0.16)', border: 'rgba(52, 211, 153, 0.24)' }
      : tone === 'warning'
        ? { text: '#ffd36e', bg: 'rgba(251, 191, 36, 0.16)', border: 'rgba(251, 191, 36, 0.24)' }
        : tone === 'info'
          ? { text: '#6fe8ff', bg: 'rgba(34, 211, 238, 0.12)', border: 'rgba(34, 211, 238, 0.22)' }
          : { text: '#b9c6e8', bg: 'rgba(255, 255, 255, 0.05)', border: 'rgba(255, 255, 255, 0.12)' };

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: styles.border,
        backgroundColor: styles.bg,
        paddingHorizontal: 8,
        paddingVertical: 4
      }}
    >
      <Text style={{ color: styles.text, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function buildStatusLabel(launch: LaunchFeedItemV1) {
  if (launch.status === 'go') {
    return launch.netPrecision === 'day' || launch.netPrecision === 'tbd' ? 'Awaiting NET' : 'T-minus running';
  }
  if (launch.status === 'hold') return 'Hold';
  if (launch.status === 'scrubbed') return 'Scrubbed';
  if (launch.status === 'tbd') return 'Awaiting NET';
  return launch.statusText || 'Mission status';
}

function buildCoverageUrl(launch: LaunchFeedItemV1) {
  const direct = typeof launch.videoUrl === 'string' ? launch.videoUrl.trim() : '';
  if (direct) return direct;
  const stream = launch.launchVidUrls?.find((item) => typeof item?.url === 'string' && item.url.trim().length > 0)?.url?.trim();
  if (stream) return stream;
  const info = launch.launchInfoUrls?.find((item) => typeof item?.url === 'string' && item.url.trim().length > 0)?.url?.trim();
  return info || null;
}

function buildWeatherSummary(weatherConcerns: LaunchFeedItemV1['weatherConcerns']) {
  if (!Array.isArray(weatherConcerns) || weatherConcerns.length === 0) {
    return null;
  }
  const labels = weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean);
  return labels.slice(0, 2).join(' • ') || null;
}

function buildOrbitLabel(launch: LaunchFeedItemV1) {
  return launch.mission?.orbit || launch.payloads?.find((item) => item?.orbit)?.orbit || launch.mission?.type || 'TBD';
}

function buildPadLabel(launch: LaunchFeedItemV1) {
  const locationName = normalizeKnownValue(launch.pad.locationName);
  const padName = normalizeKnownValue(launch.pad.name);
  const shortCode = normalizeKnownValue(launch.pad.shortCode);
  return locationName || padName || shortCode || 'Pad';
}

function buildPadMeta(launch: LaunchFeedItemV1) {
  const locationName = normalizeKnownValue(launch.pad.locationName);
  if (locationName) {
    return null;
  }

  const state = normalizeKnownValue(launch.pad.state);
  if (!state || state === 'NA') {
    return null;
  }

  return state;
}

function buildVehicleLabel(launch: LaunchFeedItemV1) {
  return launch.rocket?.fullName || launch.vehicle;
}

function shouldShowVehicle(launch: LaunchFeedItemV1) {
  const vehicleKey = normalizeKey(buildVehicleLabel(launch));
  const nameKey = normalizeKey(launch.name);
  if (!vehicleKey || !nameKey) return true;
  return !(nameKey.includes(vehicleKey) || vehicleKey.includes(nameKey));
}

function buildWindowSummary(startValue: string | undefined, endValue: string | undefined) {
  const startMs = safeParseDate(startValue);
  const endMs = safeParseDate(endValue);
  const nowMs = Date.now();
  const startLabel = formatTimestamp(startValue ?? null);
  const endLabel = formatTimestamp(endValue ?? null);

  if (startMs == null || endMs == null || endMs <= startMs) {
    return {
      startLabel,
      endLabel,
      statusLabel: 'TBD',
      tone: 'neutral' as const,
      progressPct: 0,
      fillColor: 'rgba(234, 240, 255, 0.18)'
    };
  }

  if (nowMs < startMs) {
    return {
      startLabel,
      endLabel,
      statusLabel: 'Upcoming',
      tone: 'info' as const,
      progressPct: 18,
      fillColor: 'rgba(34, 211, 238, 0.78)'
    };
  }

  if (nowMs <= endMs) {
    return {
      startLabel,
      endLabel,
      statusLabel: 'Open',
      tone: 'success' as const,
      progressPct: clampNumber(((nowMs - startMs) / (endMs - startMs)) * 100, 8, 100),
      fillColor: 'rgba(52, 211, 153, 0.82)'
    };
  }

  return {
    startLabel,
    endLabel,
    statusLabel: 'Closed',
    tone: 'warning' as const,
    progressPct: 100,
    fillColor: 'rgba(251, 191, 36, 0.78)'
  };
}

function buildCountdownDisplay(net: string | null | undefined) {
  const snapshot = buildCountdownSnapshot(net ?? null);
  if (!snapshot) return 'NET TBD';

  const prefix = snapshot.isPast ? 'T+' : 'T-';
  const totalSeconds = Math.max(0, Math.floor(Math.abs(snapshot.totalMs) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${prefix}${days}d ${padNumber(hours)}:${padNumber(minutes)}`;
  }
  if (hours > 0) {
    return `${prefix}${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`;
  }
  return `${prefix}${padNumber(minutes)}:${padNumber(seconds)}`;
}

function normalizeKnownValue(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'unknown') return null;
  return normalized;
}

function normalizeKey(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function safeParseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function padNumber(value: number) {
  return String(Math.max(0, value)).padStart(2, '0');
}
