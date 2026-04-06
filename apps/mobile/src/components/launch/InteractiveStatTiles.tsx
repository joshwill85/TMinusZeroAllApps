import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

const TILE_SPRING_CONFIG = {
  damping: ANIMATION_CONSTANTS.SPRING_DAMPING,
  stiffness: ANIMATION_CONSTANTS.SPRING_STIFFNESS,
  mass: ANIMATION_CONSTANTS.SPRING_MASS
} as const;

export type StatTile = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  onPress?: () => void;
};

type InteractiveStatTilesProps = {
  tiles: StatTile[];
};

/**
 * Interactive stat tiles with stagger animations for mobile
 * Uses Reanimated spring physics for smooth 60fps animations
 */
export function InteractiveStatTiles({ tiles }: InteractiveStatTilesProps) {
  return (
    <View style={{ gap: 12 }}>
      {tiles.map((tile, index) => (
        <StatTileCard key={tile.id} tile={tile} index={index} />
      ))}
    </View>
  );
}

function StatTileCard({ tile, index }: { tile: StatTile; index: number }) {
  const { theme } = useMobileBootstrap();
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);
  const pressed = useSharedValue(false);

  // Enter animation on mount
  useEffect(() => {
    opacity.value = withDelay(
      index * ANIMATION_CONSTANTS.TILE_STAGGER_DELAY,
      withSpring(1, TILE_SPRING_CONFIG)
    );
    scale.value = withDelay(
      index * ANIMATION_CONSTANTS.TILE_STAGGER_DELAY,
      withSpring(1, TILE_SPRING_CONFIG)
    );
  }, [index, opacity, scale]);

  // Animated style with press interaction
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';

    const targetScale = pressed.value
      ? ANIMATION_CONSTANTS.TILE_SCALE_MIN
      : 1;

    return {
      opacity: opacity.value,
      transform: [{ scale: withSpring(targetScale, TILE_SPRING_CONFIG) }],
    };
  });

  const toneColors = {
    default: {
      border: theme.stroke,
      bg: 'rgba(11, 16, 35, 0.84)',
    },
    primary: {
      border: 'rgba(34, 211, 238, 0.2)',
      bg: 'rgba(34, 211, 238, 0.05)',
    },
    success: {
      border: 'rgba(52, 211, 153, 0.2)',
      bg: 'rgba(52, 211, 153, 0.05)',
    },
    warning: {
      border: 'rgba(251, 191, 36, 0.2)',
      bg: 'rgba(251, 191, 36, 0.05)',
    },
    danger: {
      border: 'rgba(251, 113, 133, 0.2)',
      bg: 'rgba(251, 113, 133, 0.05)',
    },
  };

  const colors = toneColors[tile.tone || 'default'];

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        disabled={!tile.onPress}
        onPress={tile.onPress}
        onPressIn={() => {
          pressed.value = true;
        }}
        onPressOut={() => {
          pressed.value = false;
        }}
        style={{
          borderRadius: 24,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bg,
          padding: 20,
        }}
      >
        {/* Icon and Label Row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: theme.muted,
              textTransform: 'uppercase',
              letterSpacing: 1.2,
            }}
          >
            {tile.label}
          </Text>
          {tile.icon && <View>{tile.icon}</View>}
        </View>

        {/* Value */}
        <Text
          style={{
            fontSize: 27,
            fontWeight: '700',
            color: theme.foreground,
            marginBottom: 8,
            fontVariant: ['tabular-nums'],
          }}
        >
          {tile.value}
        </Text>

        {/* Description */}
        {tile.description && (
          <Text
            style={{
              fontSize: 13,
              color: theme.muted,
              lineHeight: 20,
            }}
          >
            {tile.description}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Compact variant for horizontal layouts
 */
export function CompactStatTiles({ tiles }: { tiles: StatTile[] }) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {tiles.map((tile, index) => (
        <Animated.View
          key={tile.id}
          entering={FadeIn.duration(200).delay(index * 50)}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(11, 16, 35, 0.84)',
            }}
          >
            {tile.icon && <View>{tile.icon}</View>}
            <View>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: theme.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {tile.label}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '700',
                  color: theme.foreground,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {tile.value}
              </Text>
            </View>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}
