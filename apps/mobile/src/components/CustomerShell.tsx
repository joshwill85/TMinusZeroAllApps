import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type HeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  testID?: string;
};

type PanelProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  testID?: string;
};

type BadgeProps = {
  label: string;
  tone?: 'default' | 'accent' | 'success' | 'warning';
};

type MetricProps = {
  label: string;
  value: string;
  caption?: string;
  testID?: string;
};

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

const BADGE_TONES: Record<NonNullable<BadgeProps['tone']>, { borderColor: string; backgroundColor: string; color: string }> = {
  default: {
    borderColor: 'rgba(234, 240, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: '#d4e0eb'
  },
  accent: {
    borderColor: 'rgba(34, 211, 238, 0.22)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    color: '#6fe8ff'
  },
  success: {
    borderColor: 'rgba(52, 211, 153, 0.22)',
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    color: '#7ff0bc'
  },
  warning: {
    borderColor: 'rgba(251, 191, 36, 0.24)',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    color: '#ffd36e'
  }
};

export function CustomerShellHero({ eyebrow, title, description, children, testID }: HeroProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 28,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(7, 9, 19, 0.94)',
        paddingHorizontal: 20,
        paddingVertical: 20,
        gap: 14
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -90,
          right: -54,
          width: 210,
          height: 210,
          borderRadius: 999,
          backgroundColor: 'rgba(34, 211, 238, 0.08)'
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 84,
          backgroundColor: 'rgba(255, 255, 255, 0.015)'
        }}
      />

      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1.8,
            textTransform: 'uppercase'
          }}
        >
          {eyebrow}
        </Text>
        <Text style={{ color: theme.foreground, fontSize: 29, fontWeight: '800', lineHeight: 34 }}>{title}</Text>
        <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 23 }}>{description}</Text>
      </View>

      {children}
    </View>
  );
}

export function CustomerShellPanel({ title, description, children, testID }: PanelProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        gap: 12,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(13, 34, 48, 0.72)',
        paddingHorizontal: 18,
        paddingVertical: 18
      }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        {description ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{description}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function CustomerShellBadge({ label, tone = 'default' }: BadgeProps) {
  const style = BADGE_TONES[tone];

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text
        style={{
          color: style.color,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 1.1,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function CustomerShellMetric({ label, value, caption, testID }: MetricProps) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        minWidth: 0,
        gap: 6,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.1)',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 14
      }}
    >
      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 1.2,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
      <Text style={{ color: theme.foreground, fontSize: 19, fontWeight: '800', lineHeight: 23 }}>{value}</Text>
      {caption ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18 }}>{caption}</Text> : null}
    </View>
  );
}

export function CustomerShellActionButton({
  label,
  onPress,
  testID,
  disabled = false,
  variant = 'primary'
}: ActionButtonProps) {
  const { theme } = useMobileBootstrap();
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: isPrimary ? theme.accent : theme.stroke,
        backgroundColor: isPrimary ? theme.accent : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 18,
        paddingVertical: 14,
        opacity: disabled ? 0.5 : pressed ? 0.86 : 1
      })}
    >
      <Text
        style={{
          color: isPrimary ? theme.background : theme.foreground,
          fontSize: 15,
          fontWeight: '700'
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
