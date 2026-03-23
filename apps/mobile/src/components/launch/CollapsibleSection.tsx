import type { ReactNode } from 'react';
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  measure,
  useAnimatedRef,
  runOnUI,
} from 'react-native-reanimated';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type CollapsibleSectionProps = {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  icon?: ReactNode;
};

/**
 * Collapsible section with smooth height animation
 * Uses Reanimated measure() worklet for accurate content height
 */
export function CollapsibleSection({
  title,
  description,
  children,
  defaultExpanded = true,
  icon,
}: CollapsibleSectionProps) {
  const { theme } = useMobileBootstrap();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const height = useSharedValue<number | 'auto'>(defaultExpanded ? 'auto' : 0);
  const rotation = useSharedValue(defaultExpanded ? 180 : 0);
  const contentRef = useAnimatedRef<Animated.View>();

  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    // Rotate arrow
    rotation.value = withTiming(newExpanded ? 180 : 0, {
      duration: ANIMATION_CONSTANTS.COLLAPSE_ANIMATION_DURATION,
    });

    if (newExpanded) {
      // Expanding: measure content height
      runOnUI(() => {
        'worklet';
        const measurement = measure(contentRef);
        if (measurement) {
          height.value = withTiming(measurement.height, {
            duration: ANIMATION_CONSTANTS.COLLAPSE_ANIMATION_DURATION,
          });
        }
      })();
    } else {
      // Collapsing
      height.value = withTiming(0, {
        duration: ANIMATION_CONSTANTS.COLLAPSE_ANIMATION_DURATION,
      });
    }
  };

  const contentStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      height: typeof height.value === 'number' ? height.value : 'auto',
      overflow: 'hidden',
    };
  });

  const arrowStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  return (
    <View
      style={{
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(11, 16, 35, 0.84)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Pressable
        onPress={toggleExpanded}
        style={{
          padding: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {icon && <View>{icon}</View>}
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                color: theme.foreground,
              }}
            >
              {title}
            </Text>
          </View>
          {description && (
            <Text
              style={{
                marginTop: 6,
                fontSize: 13,
                color: theme.muted,
              }}
            >
              {description}
            </Text>
          )}
        </View>

        {/* Arrow indicator */}
        <Animated.Text
          style={[
            {
              fontSize: 16,
              color: theme.muted,
              marginLeft: 12,
            },
            arrowStyle,
          ]}
        >
          ▼
        </Animated.Text>
      </Pressable>

      {/* Content */}
      <Animated.View style={contentStyle}>
        <Animated.View ref={contentRef} style={{ padding: 20, paddingTop: 0 }}>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * Simpler collapsible card for nested sections
 */
export function CollapsibleCard({
  title,
  children,
  defaultExpanded = false,
}: {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  const { theme } = useMobileBootstrap();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const height = useSharedValue<number | 'auto'>(defaultExpanded ? 'auto' : 0);
  const rotation = useSharedValue(defaultExpanded ? 180 : 0);
  const contentRef = useAnimatedRef<Animated.View>();

  const toggleExpanded = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);

    rotation.value = withTiming(newExpanded ? 180 : 0, { duration: 200 });

    if (newExpanded) {
      runOnUI(() => {
        'worklet';
        const measurement = measure(contentRef);
        if (measurement) {
          height.value = withTiming(measurement.height, { duration: 200 });
        }
      })();
    } else {
      height.value = withTiming(0, { duration: 200 });
    }
  };

  const contentStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      height: typeof height.value === 'number' ? height.value : 'auto',
      overflow: 'hidden',
    };
  });

  const arrowStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={toggleExpanded}
        style={{
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontSize: 16,
            fontWeight: '700',
            color: theme.foreground,
          }}
        >
          {title}
        </Text>
        <Animated.Text style={[{ fontSize: 14, color: theme.muted }, arrowStyle]}>
          ▼
        </Animated.Text>
      </Pressable>

      <Animated.View style={contentStyle}>
        <Animated.View ref={contentRef} style={{ padding: 16, paddingTop: 0 }}>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
