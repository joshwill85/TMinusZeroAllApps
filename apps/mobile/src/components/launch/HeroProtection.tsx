import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

const HERO_PANEL_BACKGROUND = 'rgba(7, 9, 19, 0.58)';
const HERO_PANEL_BORDER = 'rgba(234, 240, 255, 0.1)';

const HERO_PANEL_SHADOW: ViewStyle = {
  shadowColor: '#000000',
  shadowOpacity: 0.2,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};

export function HeroImageProtection() {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        inset: 0,
      }}
    >
      <View
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(4, 7, 16, 0.1)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: '62%',
          backgroundColor: 'rgba(7, 9, 19, 0.12)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '42%',
          backgroundColor: 'rgba(7, 9, 19, 0.16)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          width: '78%',
          bottom: 0,
          height: '46%',
          borderTopRightRadius: 40,
          backgroundColor: 'rgba(7, 9, 19, 0.3)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: -40,
          right: -20,
          width: 220,
          height: 220,
          borderRadius: 999,
          backgroundColor: 'rgba(34, 211, 238, 0.08)',
        }}
      />
    </View>
  );
}

export function HeroContentSurface({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View
      style={[
        {
          borderRadius: 28,
          borderWidth: 1,
          borderColor: HERO_PANEL_BORDER,
          backgroundColor: HERO_PANEL_BACKGROUND,
          padding: 18,
        },
        HERO_PANEL_SHADOW,
        style,
      ]}
    >
      {children}
    </View>
  );
}
