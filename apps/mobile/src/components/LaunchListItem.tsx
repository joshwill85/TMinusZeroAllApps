import type { ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type LaunchListItemProps = PressableProps & {
  title: string;
  subtitle: string;
  meta?: string;
  trailing?: ReactNode;
};

export function LaunchListItem({ title, subtitle, meta, trailing, ...pressableProps }: LaunchListItemProps) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      {...pressableProps}
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed ? theme.background : theme.surface,
        padding: 16
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text>
          {meta ? <Text style={{ color: theme.accent, fontSize: 13 }}>{meta}</Text> : null}
        </View>
        {trailing}
      </View>
    </Pressable>
  );
}
