import type { ReactNode } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

type AppScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
};

export function AppScreen({
  children,
  scroll = true,
  keyboardShouldPersistTaps = 'never'
}: AppScreenProps) {
  const { theme } = useMobileBootstrap();
  const contentStyle = {
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 20
  } as const;

  if (!scroll) {
    return (
      <View
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
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      {children}
    </ScrollView>
  );
}
