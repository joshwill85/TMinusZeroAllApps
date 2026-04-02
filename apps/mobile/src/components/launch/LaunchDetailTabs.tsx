import React from 'react';
import { Text, Pressable, ScrollView, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { MobileTheme } from '@tminuszero/design-tokens';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import type { LaunchTab, TabDefinition } from '@tminuszero/launch-detail-ui';

type LaunchDetailTabsProps = {
  tabs: TabDefinition[];
  activeTab: LaunchTab;
  onTabChange: (tab: LaunchTab) => void;
  showBadge?: boolean;
};

/**
 * Tab navigation for launch details
 * Horizontal scrollable pills with active indicator
 */
export function LaunchDetailTabs({
  tabs,
  activeTab,
  onTabChange,
  showBadge,
}: LaunchDetailTabsProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.stroke,
        backgroundColor: 'rgba(7, 9, 19, 0.95)',
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={activeTab === tab.id}
            showBadge={tab.id === 'live' && showBadge}
            onPress={() => onTabChange(tab.id)}
            theme={theme}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TabPill({
  tab,
  isActive,
  showBadge,
  onPress,
  theme,
}: {
  tab: TabDefinition;
  isActive: boolean;
  showBadge?: boolean;
  onPress: () => void;
  theme: MobileTheme;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ scale: scale.value }],
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.95, {
            damping: ANIMATION_CONSTANTS.SPRING_DAMPING,
            stiffness: ANIMATION_CONSTANTS.SPRING_STIFFNESS,
          });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, {
            damping: ANIMATION_CONSTANTS.SPRING_DAMPING,
            stiffness: ANIMATION_CONSTANTS.SPRING_STIFFNESS,
          });
        }}
        onPress={onPress}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: isActive ? theme.accent : theme.stroke,
          backgroundColor: isActive
            ? 'rgba(34, 211, 238, 0.1)'
            : 'rgba(255, 255, 255, 0.03)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {tab.icon && (
          <Text style={{ fontSize: 13 }}>{tab.icon}</Text>
        )}
        <Text
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: isActive ? theme.accent : theme.muted,
          }}
        >
          {tab.label}
        </Text>
        {showBadge && (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#ef4444',
            }}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Tab panel wrapper with fade animation
 */
export function LaunchDetailTabPanel({
  children,
  isActive,
}: {
  children: React.ReactNode;
  isActive: boolean;
}) {
  const opacity = useSharedValue(isActive ? 1 : 0);

  React.useEffect(() => {
    opacity.value = withTiming(isActive ? 1 : 0, {
      duration: 200,
    });
  }, [isActive, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: opacity.value,
    };
  });

  if (!isActive) {
    return null;
  }

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
