import { Pressable, View, type Insets } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type LaunchShareIconButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  hitSlop?: number | Insets;
  size?: number;
  iconColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  pressedBackgroundColor?: string;
};

export function LaunchShareIconButton({
  onPress,
  accessibilityLabel = 'Share launch',
  hitSlop = 8,
  size = 40,
  iconColor,
  borderColor,
  backgroundColor,
  pressedBackgroundColor
}: LaunchShareIconButtonProps) {
  const { theme } = useMobileBootstrap();
  const resolvedIconColor = iconColor ?? theme.foreground;
  const resolvedBorderColor = borderColor ?? theme.stroke;
  const resolvedBackgroundColor = backgroundColor ?? 'rgba(255, 255, 255, 0.03)';
  const resolvedPressedBackgroundColor = pressedBackgroundColor ?? 'rgba(255, 255, 255, 0.08)';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.max(12, Math.floor(size / 3)),
        borderWidth: 1,
        borderColor: resolvedBorderColor,
        backgroundColor: pressed ? resolvedPressedBackgroundColor : resolvedBackgroundColor
      })}
    >
      <ShareGlyph color={resolvedIconColor} />
    </Pressable>
  );
}

export function ShareGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View
        style={{
          position: 'absolute',
          left: 3,
          bottom: 2,
          width: 11,
          height: 10,
          borderWidth: 1.6,
          borderTopWidth: 0,
          borderColor: color,
          borderRadius: 3
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 8,
          top: 1,
          width: 1.8,
          height: 10,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 5,
          top: 1.5,
          width: 6,
          height: 6,
          borderTopWidth: 1.8,
          borderRightWidth: 1.8,
          borderColor: color,
          transform: [{ rotate: '-45deg' }]
        }}
      />
    </View>
  );
}
