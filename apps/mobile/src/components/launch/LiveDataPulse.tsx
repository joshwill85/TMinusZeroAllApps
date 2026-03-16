import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type LiveDataPulseProps = {
  children: React.ReactNode;
  variant?: 'glow' | 'dot' | 'both';
  color?: 'success' | 'primary' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

/**
 * Animated pulse effect for live data on mobile
 * Uses Reanimated withRepeat for infinite pulsing animation
 */
export function LiveDataPulse({
  children,
  variant = 'both',
  color = 'success',
  size = 'md',
}: LiveDataPulseProps) {
  const { theme } = useMobileBootstrap();
  const opacity = Animated.useSharedValue(ANIMATION_CONSTANTS.LIVE_GLOW_MIN_OPACITY);
  const scale = Animated.useSharedValue(ANIMATION_CONSTANTS.LIVE_DOT_SCALE_MIN);

  const colors = {
    success: {
      glow: 'rgba(52, 211, 153, 0.6)',
      dot: 'rgb(52, 211, 153)',
      glowMin: 'rgba(52, 211, 153, 0.3)',
    },
    primary: {
      glow: 'rgba(34, 211, 238, 0.6)',
      dot: 'rgb(34, 211, 238)',
      glowMin: 'rgba(34, 211, 238, 0.3)',
    },
    warning: {
      glow: 'rgba(251, 191, 36, 0.6)',
      dot: 'rgb(251, 191, 36)',
      glowMin: 'rgba(251, 191, 36, 0.3)',
    },
    danger: {
      glow: 'rgba(251, 113, 133, 0.6)',
      dot: 'rgb(251, 113, 133)',
      glowMin: 'rgba(251, 113, 133, 0.3)',
    },
  };

  const dotSizes = {
    sm: 8,
    md: 12,
    lg: 16,
  };

  const glowPadding = {
    sm: 4,
    md: 8,
    lg: 12,
  };

  const colorScheme = colors[color];
  const showGlow = variant === 'glow' || variant === 'both';
  const showDot = variant === 'dot' || variant === 'both';

  // Start pulse animation on mount
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(ANIMATION_CONSTANTS.LIVE_GLOW_OPACITY, {
        duration: ANIMATION_CONSTANTS.LIVE_PULSE_DURATION,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );

    scale.value = withRepeat(
      withTiming(ANIMATION_CONSTANTS.LIVE_DOT_SCALE_MAX, {
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const glowStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: opacity.value,
    };
  });

  const dotStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });

  return (
    <View style={{ position: 'relative' }}>
      {/* Pulsing glow background */}
      {showGlow && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              inset: -glowPadding[size],
              borderRadius: 12,
              backgroundColor: colorScheme.glowMin,
            },
            glowStyle,
          ]}
          pointerEvents="none"
        />
      )}

      {/* Content */}
      <View style={{ position: 'relative' }}>{children}</View>

      {/* Animated dot indicator */}
      {showDot && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: -4,
              right: -4,
              width: dotSizes[size],
              height: dotSizes[size],
              borderRadius: dotSizes[size] / 2,
              backgroundColor: colorScheme.dot,
              shadowColor: colorScheme.dot,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.6,
              shadowRadius: 4,
              elevation: 4,
            },
            dotStyle,
          ]}
        />
      )}
    </View>
  );
}

/**
 * Live badge with pulse effect
 */
export function LiveBadge({ label = 'LIVE' }: { label?: string }) {
  const { theme } = useMobileBootstrap();

  return (
    <LiveDataPulse variant="both" color="danger" size="sm">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: 'rgba(251, 113, 133, 0.2)',
          borderWidth: 1,
          borderColor: 'rgba(251, 113, 133, 0.4)',
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: 'rgb(251, 113, 133)',
          }}
        />
        <Text
          style={{
            color: '#ff9aab',
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
      </View>
    </LiveDataPulse>
  );
}

/**
 * Countdown display with pulse effect
 */
export function LiveCountdown({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <LiveDataPulse variant="glow" color="primary" size="lg">
      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 36,
            fontWeight: '700',
            color: theme.foreground,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </Text>
        <Text
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: theme.muted,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
            marginTop: 4,
          }}
        >
          {label}
        </Text>
      </View>
    </LiveDataPulse>
  );
}

/**
 * Status indicator with pulse
 */
export function LiveStatus({
  status,
  color = 'success',
  size = 'md',
}: {
  status: string;
  color?: 'success' | 'primary' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const textSizes = {
    sm: 11,
    md: 13,
    lg: 15,
  };

  return (
    <LiveDataPulse variant="dot" color={color} size={size}>
      <Text
        style={{
          fontSize: textSizes[size],
          fontWeight: '700',
        }}
      >
        {status}
      </Text>
    </LiveDataPulse>
  );
}
