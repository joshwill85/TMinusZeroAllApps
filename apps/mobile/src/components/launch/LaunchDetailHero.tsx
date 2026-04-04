import React from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { HeroContentSurface, HeroImageProtection } from '@/src/components/launch/HeroProtection';

type LaunchDetailHeroProps = {
  backgroundImage: string | null;
  launchName: string;
  provider: string | null;
  vehicle: string | null;
  status: string | null;
  statusTone?: 'default' | 'success' | 'warning' | 'danger';
  tier: string | null;
  webcastLive: boolean;
  countdown: string | null;
  netTime: string | null;
  location: string | null;
  scrollY: SharedValue<number>;
  actionButtons: React.ReactNode;
};

/**
 * Hero section for tab-based launch details
 * Shows essential launch info above the tabs
 */
export function LaunchDetailHero({
  backgroundImage,
  launchName,
  provider,
  vehicle,
  status,
  statusTone = 'default',
  tier,
  webcastLive,
  countdown,
  netTime,
  location,
  scrollY,
  actionButtons,
}: LaunchDetailHeroProps) {
  const { theme } = useMobileBootstrap();

  // Background parallax animation
  const imageStyle = useAnimatedStyle(() => {
    'worklet';
    const parallaxOffset = scrollY.value * ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED;
    const scale = interpolate(
      scrollY.value,
      [0, 300],
      [ANIMATION_CONSTANTS.PARALLAX_MIN_SCALE, ANIMATION_CONSTANTS.PARALLAX_MAX_SCALE],
      Extrapolate.CLAMP
    );
    return {
      transform: [{ translateY: parallaxOffset }, { scale }],
    };
  });

  // Content fade animation
  const contentStyle = useAnimatedStyle(() => {
    'worklet';
    const opacity = interpolate(
      scrollY.value,
      [0, 200, 300],
      [1, 0.5, 0],
      Extrapolate.CLAMP
    );
    return { opacity };
  });

  const statusColors = {
    default: { bg: 'rgba(34, 211, 238, 0.1)', border: 'rgba(34, 211, 238, 0.4)', text: theme.accent },
    success: { bg: 'rgba(52, 211, 153, 0.1)', border: 'rgba(52, 211, 153, 0.4)', text: '#7ff0bc' },
    warning: { bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.4)', text: '#fcd34d' },
    danger: { bg: 'rgba(251, 113, 133, 0.1)', border: 'rgba(251, 113, 133, 0.4)', text: '#ff9aab' },
  };

  const statusColor = statusColors[statusTone];

  return (
    <View
      style={{
        height: 400,
        overflow: 'hidden',
        backgroundColor: 'rgba(11, 16, 35, 0.84)',
      }}
    >
      {/* Background Image */}
      {backgroundImage && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: -100,
              left: -50,
              right: -50,
              height: 600,
            },
            imageStyle,
          ]}
        >
          <Image
            source={{ uri: backgroundImage }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        </Animated.View>
      )}

      <HeroImageProtection />

      {/* Content */}
      <Animated.View
        style={[
          {
            flex: 1,
            padding: 20,
            paddingBottom: 24,
            justifyContent: 'space-between',
          },
          contentStyle,
        ]}
      >
        {/* Top: Badges */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {status && (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: statusColor.bg,
                  borderWidth: 1,
                  borderColor: statusColor.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: statusColor.text,
                    textTransform: 'uppercase',
                  }}
                >
                  {status}
                </Text>
              </View>
            )}
            {tier && (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderWidth: 1,
                  borderColor: theme.stroke,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: theme.muted,
                    textTransform: 'uppercase',
                  }}
                >
                  {tier}
                </Text>
              </View>
            )}
            {webcastLive && (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#ef4444',
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: '#fca5a5',
                    textTransform: 'uppercase',
                  }}
                >
                  LIVE
                </Text>
              </View>
            )}
          </View>
          {actionButtons ? <View style={{ marginLeft: 'auto' }}>{actionButtons}</View> : null}
        </View>

        <HeroContentSurface style={{ gap: 16 }}>
          {/* Middle: Launch Info */}
          <View style={{ gap: 8 }}>
            {provider && (
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: theme.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {provider}
              </Text>
            )}
            <Text
              style={{
                fontSize: 24,
                fontWeight: '800',
                color: theme.foreground,
                lineHeight: 30,
              }}
            >
              {launchName}
            </Text>
            {vehicle && (
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: theme.accent,
                }}
              >
                {vehicle}
              </Text>
            )}
          </View>

          {/* Bottom: Countdown & Location */}
          <View style={{ gap: 12 }}>
            {countdown && (
              <View>
                <Text
                  style={{
                    fontSize: 32,
                    fontWeight: '800',
                    color: theme.foreground,
                    letterSpacing: -1,
                  }}
                >
                  {countdown}
                </Text>
              </View>
            )}
            <View style={{ gap: 6 }}>
              {netTime && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>🕐</Text>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: theme.muted,
                    }}
                  >
                    {netTime}
                  </Text>
                </View>
              )}
              {location && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>🌍</Text>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: theme.muted,
                    }}
                  >
                    {location}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </HeroContentSurface>
      </Animated.View>
    </View>
  );
}
