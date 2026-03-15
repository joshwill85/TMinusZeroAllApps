import { Text, View } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function ScreenHeader({ eyebrow, title, description }: ScreenHeaderProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: theme.accent,
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 1.1,
          textTransform: 'uppercase'
        }}
      >
        {eyebrow}
      </Text>
      <Text style={{ color: theme.foreground, fontSize: 30, fontWeight: '800', lineHeight: 36 }}>
        {title}
      </Text>
      <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 23 }}>{description}</Text>
    </View>
  );
}
