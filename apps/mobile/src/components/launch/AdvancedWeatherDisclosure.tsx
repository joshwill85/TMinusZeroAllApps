import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';

type AdvancedWeatherDisclosureProps = {
  count: number;
  isPremium: boolean;
  children: ReactNode;
  theme: MobileTheme;
  onOpenPremiumGate?: () => void;
  title?: string;
  description?: string;
};

export function AdvancedWeatherDisclosure({
  count,
  isPremium,
  children,
  theme,
  onOpenPremiumGate,
  title = '45 WS planning forecast',
  description = 'Premium planning products from 45 WS add broader launch-day and week-ahead Cape context.'
}: AdvancedWeatherDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handlePress = () => {
    if (!isPremium) {
      onOpenPremiumGate?.();
      return;
    }
    setIsExpanded((current) => !current);
  };

  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isPremium ? isExpanded : false }}
        onPress={handlePress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: 16,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
            Advanced weather
          </Text>
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
            {description}
            {!isPremium ? ' Premium required to open.' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <View
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
              {count} product{count === 1 ? '' : 's'}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: theme.foreground, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
              {isPremium ? (isExpanded ? 'Collapse' : 'Expand') : 'Premium'}
            </Text>
            <Text style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>{isPremium ? (isExpanded ? '▲' : '▼') : '🔒'}</Text>
          </View>
        </View>
      </Pressable>

      {isPremium && isExpanded ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.stroke,
            padding: 16,
            gap: 12,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
