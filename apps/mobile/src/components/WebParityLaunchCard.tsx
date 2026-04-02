import type { ReactNode } from 'react';
import { Image, Linking, Pressable, Share, Text, View, type DimensionValue } from 'react-native';
import { buildCountdownSnapshot } from '@tminuszero/domain';
import { buildLaunchHref } from '@tminuszero/navigation';
import { getPublicSiteUrl } from '@/src/config/api';
import type { FeedLaunchCardData } from '@/src/feed/feedCardData';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatTimestamp } from '@/src/utils/format';

type WebParityLaunchCardProps = {
  launch: FeedLaunchCardData;
  isNext?: boolean;
  testID?: string;
  showDeferredMedia?: boolean;
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
  followMenuLabel?: string;
  followMenuCount?: number;
  followMenuCapacityLabel?: string;
  followMenuActive?: boolean;
  followMenuDisabled?: boolean;
  notificationsActive?: boolean;
  onOpenFollowMenu?: () => void;
  onOpenAr?: () => void;
};

type StatusTone = {
  borderColor: string;
  fillColor: string;
  pillBackground: string;
  pillText: string;
  pillBorder: string;
};

const STATUS_TONES: Record<FeedLaunchCardData['status'], StatusTone> = {
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
  showDeferredMedia = true,
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
  onToggleFollowPad,
  followMenuLabel,
  followMenuCount = 0,
  followMenuCapacityLabel,
  followMenuActive = false,
  followMenuDisabled = false,
  notificationsActive = false,
  onOpenFollowMenu,
  onOpenAr
}: WebParityLaunchCardProps) {
  const { theme } = useMobileBootstrap();
  const statusTone = STATUS_TONES[launch.status] ?? STATUS_TONES.unknown;
  const countdownDisplay = buildCountdownDisplay(launch.net);
  const orbitLabel = buildOrbitLabel(launch);
  const providerLabel = String(launch.provider || 'Launch').trim().toUpperCase();
  const providerLogoUrl = typeof launch.providerLogoUrl === 'string' ? launch.providerLogoUrl.trim() : '';
  const backgroundImageUrl = showDeferredMedia ? launch.image?.thumbnail || launch.image?.full || null : null;
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
  const shareUrl = `${getPublicSiteUrl()}${buildLaunchHref(launch.id)}`;

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
            {showDeferredMedia && providerLogoUrl ? (
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
          </View>

          <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            <StatusPill label={buildStatusLabel(launch)} tone={statusTone} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ flex: 1, color: theme.foreground, fontSize: 20, fontWeight: '800', lineHeight: 25 }}>{launch.name}</Text>
          <View
            pointerEvents="none"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 10,
              paddingVertical: 6
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }}>Open</Text>
            <ChevronGlyph color={theme.muted} />
          </View>
        </View>

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
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
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

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 2
        }}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: 1 }}>
          {coverageUrl ? (
            <CardIconButton
              label={launch.webcastLive ? 'Watch live' : launch.status === 'scrubbed' ? 'Replay coverage' : 'Watch coverage'}
              active={launch.webcastLive}
              onPress={() => {
                void Linking.openURL(coverageUrl);
              }}
            >
              <PlayGlyph color={launch.webcastLive ? theme.accent : theme.foreground} active={launch.webcastLive} />
            </CardIconButton>
          ) : null}
          <CardIconButton
            label="Share launch"
            onPress={() => {
              void Share.share({
                message: `${launch.name}\n${shareUrl}`,
                url: shareUrl
              });
            }}
          >
            <ShareGlyph color={theme.foreground} />
          </CardIconButton>
          {onOpenAr ? (
            <CardIconButton label="Open AR trajectory" onPress={onOpenAr}>
              <ArGlyph color={theme.foreground} />
            </CardIconButton>
          ) : null}
        </View>

        {onOpenFollowMenu ? (
          <PrimaryFollowButton
            label={followMenuLabel || 'Follow'}
            active={followMenuActive}
            disabled={followMenuDisabled}
            count={followMenuCount}
            capacityLabel={followMenuCapacityLabel}
            notificationsActive={notificationsActive}
            onPress={onOpenFollowMenu}
          />
        ) : onToggleWatch || onToggleFollowProvider || onToggleFollowPad ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {onToggleWatch ? (
            <FollowChip
              label={isWatched ? 'Following launch' : 'Follow launch'}
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
      </View>

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

function CardIconButton({
  label,
  active = false,
  onPress,
  children
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? `${theme.accent}66` : 'rgba(234, 240, 255, 0.1)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)'
      })}
    >
      {children}
    </Pressable>
  );
}

function PrimaryFollowButton({
  label,
  active,
  disabled = false,
  count,
  capacityLabel,
  notificationsActive,
  onPress
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  count: number;
  capacityLabel?: string;
  notificationsActive: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? `${theme.accent}80` : 'rgba(234, 240, 255, 0.14)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.14)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.04)',
        paddingLeft: 14,
        paddingRight: 12,
        paddingVertical: 10,
        opacity: disabled ? 0.45 : 1
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? `${theme.accent}80` : 'rgba(234, 240, 255, 0.14)',
          backgroundColor: active ? 'rgba(34, 211, 238, 0.16)' : 'rgba(255, 255, 255, 0.03)'
        }}
      >
        {active ? <CheckGlyph color={theme.accent} /> : <PlusGlyph color={theme.foreground} />}
      </View>
      <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 13, fontWeight: '800' }}>{label}</Text>
      {capacityLabel ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            backgroundColor: active ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            paddingHorizontal: 7
          }}
        >
          <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '800' }}>{capacityLabel}</Text>
        </View>
      ) : count > 0 ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            backgroundColor: active ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            paddingHorizontal: 7
          }}
        >
          <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '800' }}>{count}</Text>
        </View>
      ) : null}
      {notificationsActive ? <NotificationDot color={theme.accent} /> : null}
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

function PlayGlyph({ color, active = false }: { color: string; active?: boolean }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 5,
          borderBottomWidth: 5,
          borderLeftWidth: 8,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
          marginLeft: 2
        }}
      />
      {active ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 4,
            height: 4,
            borderRadius: 999,
            backgroundColor: color
          }}
        />
      ) : null}
    </View>
  );
}

function ShareGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View
        style={{
          position: 'absolute',
          left: 3,
          bottom: 2,
          width: 11,
          height: 10,
          borderWidth: 1.6,
          borderTopWidth: 0,
          borderColor: color,
          borderRadius: 3
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 8,
          top: 1,
          width: 1.8,
          height: 10,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 5,
          top: 1.5,
          width: 6,
          height: 6,
          borderTopWidth: 1.8,
          borderRightWidth: 1.8,
          borderColor: color,
          transform: [{ rotate: '-45deg' }]
        }}
      />
    </View>
  );
}

function ArGlyph({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 22 }}>
      <Text style={{ color, fontSize: 20, lineHeight: 20, fontWeight: '900', letterSpacing: 1.1 }}>AR</Text>
    </View>
  );
}

function ChevronGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderTopWidth: 1.6,
        borderRightWidth: 1.6,
        borderColor: color,
        transform: [{ rotate: '45deg' }]
      }}
    />
  );
}

function PlusGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 10, height: 1.8, borderRadius: 999, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: 1.8, height: 10, borderRadius: 999, backgroundColor: color }} />
    </View>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 9,
        height: 5,
        borderLeftWidth: 1.8,
        borderBottomWidth: 1.8,
        borderColor: color,
        transform: [{ rotate: '-45deg' }]
      }}
    />
  );
}

function NotificationDot({ color }: { color: string }) {
  return <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color }} />;
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

export function WebParityLaunchCardSkeleton({ testID }: { testID?: string }) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        overflow: 'hidden',
        gap: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(11, 16, 35, 0.82)',
        paddingHorizontal: 18,
        paddingVertical: 18
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <SkeletonBlock width="36%" height={16} />
        <SkeletonBlock width={82} height={28} rounded />
      </View>
      <SkeletonBlock width="82%" height={26} />
      <View style={{ gap: 8 }}>
        <SkeletonBlock width="46%" height={12} />
        <SkeletonBlock width="60%" height={12} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBlock width="34%" height={11} />
          <SkeletonBlock width="72%" height={18} />
          <SkeletonBlock width="58%" height={12} />
        </View>
        <SkeletonBlock width={124} height={52} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <SkeletonBlock width="52%" height={44} />
        <SkeletonBlock width="44%" height={44} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <SkeletonBlock width={86} height={34} rounded />
        <SkeletonBlock width={86} height={34} rounded />
        <SkeletonBlock width={78} height={34} rounded />
      </View>
    </View>
  );
}

function SkeletonBlock({
  width,
  height,
  rounded = false
}: {
  width: DimensionValue;
  height: number;
  rounded?: boolean;
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: rounded ? 999 : 10,
        backgroundColor: 'rgba(255, 255, 255, 0.08)'
      }}
    />
  );
}

function buildStatusLabel(launch: FeedLaunchCardData) {
  if (launch.status === 'go') {
    return launch.netPrecision === 'day' || launch.netPrecision === 'tbd' ? 'Awaiting NET' : 'T-minus running';
  }
  if (launch.status === 'hold') return 'Hold';
  if (launch.status === 'scrubbed') return 'Scrubbed';
  if (launch.status === 'tbd') return 'Awaiting NET';
  return launch.statusText || 'Mission status';
}

function buildCoverageUrl(launch: FeedLaunchCardData) {
  const direct = typeof launch.videoUrl === 'string' ? launch.videoUrl.trim() : '';
  if (direct) return direct;
  const stream = launch.launchVidUrls?.find((item) => typeof item?.url === 'string' && item.url.trim().length > 0)?.url?.trim();
  if (stream) return stream;
  const info = launch.launchInfoUrls?.find((item) => typeof item?.url === 'string' && item.url.trim().length > 0)?.url?.trim();
  return info || null;
}

function buildWeatherSummary(weatherConcerns: FeedLaunchCardData['weatherConcerns']) {
  if (!Array.isArray(weatherConcerns) || weatherConcerns.length === 0) {
    return null;
  }
  const labels = weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean);
  return labels.slice(0, 2).join(' • ') || null;
}

function buildOrbitLabel(launch: FeedLaunchCardData) {
  return launch.mission?.orbit || launch.payloads?.find((item) => item?.orbit)?.orbit || launch.mission?.type || 'TBD';
}

function buildPadLabel(launch: FeedLaunchCardData) {
  const locationName = normalizeKnownValue(launch.pad.locationName);
  const padName = normalizeKnownValue(launch.pad.name);
  const shortCode = normalizeKnownValue(launch.pad.shortCode);
  return locationName || padName || shortCode || 'Pad';
}

function buildPadMeta(launch: FeedLaunchCardData) {
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

function buildVehicleLabel(launch: FeedLaunchCardData) {
  return launch.rocket?.fullName || launch.vehicle;
}

function shouldShowVehicle(launch: FeedLaunchCardData) {
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
