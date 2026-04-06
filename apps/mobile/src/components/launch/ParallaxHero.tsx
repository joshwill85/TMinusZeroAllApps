import type { ReactNode } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { HeroContentSurface, HeroImageProtection } from '@/src/components/launch/HeroProtection';

type ParallaxHeroProps = {
  backgroundImage: string | null;
  title: string;
  subtitle: string;
  scrollY: SharedValue<number>;
  status?: string;
  statusTone?: 'default' | 'success' | 'warning' | 'danger';
  children?: ReactNode;
};

/**
 * Parallax hero section for mobile launch details
 * Uses Reanimated worklets for 60fps native animations
 */
export function ParallaxHero({
  backgroundImage,
  title,
  subtitle,
  scrollY,
  status,
  statusTone = 'default',
  children,
}: ParallaxHeroProps) {
  const { theme } = useMobileBootstrap();

  // Background parallax animation (runs on UI thread)
  const imageStyle = useAnimatedStyle(() => {
    'worklet';

    // Parallax offset: background moves slower than scroll
    const parallaxOffset = scrollY.value * ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED;

    // Scale effect: subtle zoom as user scrolls
    const scale = interpolate(
      scrollY.value,
      [0, 300],
      [ANIMATION_CONSTANTS.PARALLAX_MIN_SCALE, ANIMATION_CONSTANTS.PARALLAX_MAX_SCALE],
      Extrapolate.CLAMP
    );

    return {
      transform: [
        { translateY: parallaxOffset },
        { scale },
      ],
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
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(11, 16, 35, 0.84)',
      }}
    >
      {/* Parallax Background Image */}
      {backgroundImage && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: -100,
              left: 0,
              right: 0,
              height: 600,
            },
            imageStyle,
          ]}
        >
          <Image
            source={{ uri: backgroundImage }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        </Animated.View>
      )}

      <HeroImageProtection />

      {/* Content Container */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            bottom: 24,
            left: 24,
            right: 24,
          },
          contentStyle,
        ]}
      >
        <HeroContentSurface>
          {/* Status Badge */}
          {status && (
            <View style={{ marginTop: 4, marginBottom: 12 }}>
              <View
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: statusColor.border,
                  backgroundColor: statusColor.bg,
                }}
              >
                <Text
                  style={{
                    color: statusColor.text,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {status}
                </Text>
              </View>
            </View>
          )}

          {/* Title */}
          <Text
            style={{
              fontSize: 33,
              fontWeight: '800',
              color: theme.foreground,
              lineHeight: 38,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>

          {/* Subtitle */}
          <Text
            style={{
              fontSize: 15,
              color: theme.muted,
              lineHeight: 22,
              maxWidth: '90%',
            }}
          >
            {subtitle}
          </Text>

          {/* Optional children */}
          {children && <View style={{ marginTop: 16 }}>{children}</View>}
        </HeroContentSurface>
      </Animated.View>

      {/* Decorative accent line */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: theme.accent,
          opacity: 0.6,
        }}
        pointerEvents="none"
      />
    </View>
  );
}

/**
 * Static hero fallback for reduced motion
 */
export function StaticHero({
  backgroundImage,
  title,
  subtitle,
  status,
  statusTone = 'default',
  children,
}: Omit<ParallaxHeroProps, 'scrollY'>) {
  const { theme } = useMobileBootstrap();

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
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(11, 16, 35, 0.84)',
      }}
    >
      {/* Static Background */}
      {backgroundImage && (
        <View style={{ position: 'absolute', inset: 0 }}>
          <Image
            source={{ uri: backgroundImage }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        </View>
      )}

      <HeroImageProtection />

      {/* Content */}
      <View
        style={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          right: 24,
        }}
      >
        <HeroContentSurface>
          {status && (
            <View style={{ marginTop: 4, marginBottom: 12 }}>
              <View
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: statusColor.border,
                  backgroundColor: statusColor.bg,
                }}
              >
                <Text
                  style={{
                    color: statusColor.text,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {status}
                </Text>
              </View>
            </View>
          )}

          <Text
            style={{
              fontSize: 33,
              fontWeight: '800',
              color: theme.foreground,
              lineHeight: 38,
              marginBottom: 8,
            }}
          >
            {title}
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: theme.muted,
              lineHeight: 22,
              maxWidth: '90%',
            }}
          >
            {subtitle}
          </Text>

          {children && <View style={{ marginTop: 16 }}>{children}</View>}
        </HeroContentSurface>
      </View>
    </View>
  );
}
