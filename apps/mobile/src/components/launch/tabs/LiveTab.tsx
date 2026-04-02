import React from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { LiveTabData } from '@tminuszero/launch-detail-ui';
import { JepPanel } from '@/src/components/launch/JepPanel';

type LiveTabProps = {
  data: LiveTabData;
  theme: MobileTheme;
};

export function LiveTab({ data, theme }: LiveTabProps) {
  const hasContent =
    data.hasJepScore ||
    data.watchLinks.length > 0 ||
    data.launchUpdates.length > 0 ||
    data.socialPosts.length > 0 ||
    data.faaAdvisories.length > 0;

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔴</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No Live Coverage Yet
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Live coverage typically begins 24 hours before launch
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      <JepPanel launchId={data.launchId} hasJepScore={data.hasJepScore} theme={theme} />

      {/* Webcast Embed / Primary Watch Link */}
      {data.webcastEmbed.url && (
        <SectionCard theme={theme}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            {data.webcastEmbed.isLive && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#ef4444',
                  }}
                />
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#fca5a5' }}>
                  LIVE NOW
                </Text>
              </View>
            )}
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.foreground, flex: 1 }}>
              {data.webcastEmbed.isLive ? 'Live Webcast' : 'Primary Stream'}
            </Text>
          </View>

          <Pressable
            onPress={() => Linking.openURL(data.webcastEmbed.url!)}
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: theme.accent,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#000' }}>
              Watch Live →
            </Text>
          </Pressable>
        </SectionCard>
      )}

      {/* Additional Watch Links */}
      {data.watchLinks.length > 1 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>All Streams</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.watchLinks.map((link, idx) => (
              <Pressable
                key={idx}
                onPress={() => Linking.openURL(link.url)}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>
                    {link.title || link.label}
                  </Text>
                  {link.meta && (
                    <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                      {link.meta}
                    </Text>
                  )}
                </View>
                <Text style={{ fontSize: 18 }}>▶️</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Launch Updates */}
      {data.launchUpdates.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Recent Updates ({data.launchUpdates.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.launchUpdates.slice(0, 10).map((update, idx) => (
              <View
                key={idx}
                style={{
                  padding: 12,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.accent,
                  backgroundColor: 'rgba(34, 211, 238, 0.05)',
                  borderRadius: 4,
                }}
              >
                <Text style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>
                  {update.timestamp}
                </Text>
                <Text style={{ fontSize: 13, color: theme.foreground, fontWeight: '600' }}>
                  {update.field}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {update.oldValue && (
                    <Text style={{ fontSize: 12, color: theme.muted, textDecorationLine: 'line-through' }}>
                      {update.oldValue}
                    </Text>
                  )}
                  <Text style={{ fontSize: 12, color: theme.accent, fontWeight: '600' }}>
                    → {update.newValue || 'N/A'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </SectionCard>
      )}

      {/* Social Posts */}
      {data.socialPosts.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            Social Media Updates ({data.socialPosts.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.socialPosts.map((post, idx) => (
              <Pressable
                key={post.id || idx}
                onPress={() => Linking.openURL(post.url)}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 24 }}>
                  {post.platform === 'twitter' || post.platform === 'x' ? '𝕏' : '📱'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, color: theme.foreground }}>
                    View on {post.platform === 'x' ? 'X' : post.platform}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: theme.accent }}>→</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      )}

      {/* FAA Advisories */}
      {data.faaAdvisories.length > 0 && (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>
            FAA Airspace Advisories ({data.faaAdvisories.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.faaAdvisories.map((advisory, idx) => (
              <View
                key={idx}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: 'rgba(251, 191, 36, 0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(251, 191, 36, 0.3)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ fontSize: 16 }}>✈️</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#fcd34d' }}>
                    Advisory {idx + 1}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, color: theme.muted }}>
                  {advisory.type || 'NOTAM'}
                </Text>
              </View>
            ))}
          </View>
        </SectionCard>
      )}
    </ScrollView>
  );
}

// Helper Components

function SectionCard({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      {children}
    </View>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <Text
      style={{
        fontSize: 16,
        fontWeight: '700',
        color: theme.foreground,
        marginBottom: 16,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}
