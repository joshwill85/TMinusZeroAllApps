import type { ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function formatRouteDate(value: string | null | undefined) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function formatRouteDateTime(value: string | null | undefined) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatRouteNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }

  return new Intl.NumberFormat().format(value);
}

export async function openExternalCustomerUrl(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
    return;
  } catch {
    // Fall back to the system URL handler if the in-app browser is unavailable.
  }

  await Linking.openURL(url);
}

export function RouteListRow({
  title,
  subtitle,
  meta,
  badge,
  onPress,
  trailing,
  testID
}: {
  title: string;
  subtitle: string;
  meta?: string | null;
  badge?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
  testID?: string;
}) {
  const { theme } = useMobileBootstrap();
  const containerStyle = ({ pressed }: { pressed?: boolean } = {}) => ({
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(234, 240, 255, 0.1)',
    backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: 16,
    paddingVertical: 15
  });

  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={containerStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
              {badge ? (
                <View
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: 'rgba(34, 211, 238, 0.22)',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    paddingHorizontal: 8,
                    paddingVertical: 4
                  }}
                >
                  <Text style={{ color: '#6fe8ff', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text>
            {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
          </View>
          {trailing}
        </View>
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={containerStyle()}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
            {badge ? (
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(34, 211, 238, 0.22)',
                  backgroundColor: 'rgba(34, 211, 238, 0.1)',
                  paddingHorizontal: 8,
                  paddingVertical: 4
                }}
              >
                <Text style={{ color: '#6fe8ff', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text>
          {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
        </View>
        {trailing}
      </View>
    </View>
  );
}

export function RouteKeyValueRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '700', flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}
