import { Text, Pressable, ScrollView } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolate,
  withSpring,
} from 'react-native-reanimated';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export type NavSection = {
  id: string;
  label: string;
  offsetY: number;
};

type StickyNavPillsProps = {
  sections: NavSection[];
  scrollY: SharedValue<number>;
  activeSection: string | null;
  onSectionPress: (sectionId: string, offsetY: number) => void;
  offsetTop?: number;
};

type MobileTheme = ReturnType<typeof useMobileBootstrap>['theme'];

/**
 * Sticky section navigation for mobile
 * Appears after scroll threshold with slide-in animation
 */
export function StickyNavPills({
  sections,
  scrollY,
  activeSection,
  onSectionPress,
  offsetTop = 80,
}: StickyNavPillsProps) {
  const { theme } = useMobileBootstrap();

  // Sticky nav slide-in animation
  const containerStyle = useAnimatedStyle(() => {
    'worklet';

    // Slide down from above viewport
    const translateY = interpolate(
      scrollY.value,
      [0, ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD],
      [-60, 0],
      Extrapolate.CLAMP
    );

    // Fade in
    const opacity = interpolate(
      scrollY.value,
      [
        ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD - 50,
        ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD,
      ],
      [0, 1],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ translateY }],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: offsetTop,
          left: 0,
          right: 0,
          zIndex: ANIMATION_CONSTANTS.STICKY_NAV_Z_INDEX,
          backgroundColor: 'rgba(7, 9, 19, 0.92)',
          borderBottomWidth: 1,
          borderBottomColor: theme.stroke,
          paddingVertical: 12,
        },
        containerStyle,
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      >
        {sections.map((section) => (
          <NavPill
            key={section.id}
            section={section}
            isActive={activeSection === section.id}
            onPress={() => onSectionPress(section.id, section.offsetY)}
            theme={theme}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

function NavPill({
  section,
  isActive,
  onPress,
  theme,
}: {
  section: NavSection;
  isActive: boolean;
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
        }}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: isActive ? theme.accent : theme.muted,
          }}
        >
          {section.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Minimal variant without sticky behavior
 */
export function SectionNav({
  sections,
  activeSection,
  onSectionPress,
}: {
  sections: { id: string; label: string }[];
  activeSection: string | null;
  onSectionPress: (id: string) => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {sections.map((section) => (
        <Pressable
          key={section.id}
          onPress={() => onSectionPress(section.id)}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: activeSection === section.id ? theme.accent : theme.stroke,
            backgroundColor: activeSection === section.id
              ? 'rgba(34, 211, 238, 0.1)'
              : 'rgba(255, 255, 255, 0.03)',
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: activeSection === section.id ? theme.accent : theme.muted,
            }}
          >
            {section.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
