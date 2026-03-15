import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import {
  MOBILE_DOCK_BOTTOM_OFFSET,
  MOBILE_DOCK_CONTENT_GAP,
  MOBILE_DOCK_HEIGHT,
  shouldShowCustomerDock
} from '@/src/components/mobileShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type AppScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  testID?: string;
};

export function AppScreen({
  children,
  scroll = true,
  keyboardShouldPersistTaps = 'never',
  testID
}: AppScreenProps) {
  const { theme } = useMobileBootstrap();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const showDock = shouldShowCustomerDock(segments);
  const contentBottomPadding = showDock
    ? insets.bottom + MOBILE_DOCK_HEIGHT + MOBILE_DOCK_BOTTOM_OFFSET + MOBILE_DOCK_CONTENT_GAP
    : Math.max(insets.bottom + 24, 40);
  const contentStyle = {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: contentBottomPadding
  } as const;

  if (!scroll) {
    return (
      <View
        testID={testID}
        style={{
          flex: 1,
          backgroundColor: theme.background,
          ...contentStyle
        }}
      >
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      {children}
    </ScrollView>
  );
}
