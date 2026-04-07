import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';

type ForecastAdvisoriesDisclosureProps = {
  count: number;
  children: ReactNode;
  theme: MobileTheme;
  defaultExpanded?: boolean;
};

export function ForecastAdvisoriesDisclosure({
  count,
  children,
  theme,
  defaultExpanded = false,
}: ForecastAdvisoriesDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

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
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => {
          setIsExpanded((current) => !current);
        }}
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
            FAA airspace
          </Text>
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Launch advisories</Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
            Temporary flight restrictions and NOTAM matches tied to this launch.
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
              {count} match{count === 1 ? '' : 'es'}
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
              {isExpanded ? 'Collapse' : 'Expand'}
            </Text>
            <Text style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>{isExpanded ? '▲' : '▼'}</Text>
          </View>
        </View>
      </Pressable>

      {isExpanded ? (
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
