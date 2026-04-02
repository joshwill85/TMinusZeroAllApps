import React from 'react';
import { View, Text, ScrollView, Pressable, Linking, Image } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { RelatedTabData } from '@tminuszero/launch-detail-ui';

type RelatedTabProps = {
  data: RelatedTabData;
  theme: MobileTheme;
};

export function RelatedTab({ data, theme }: RelatedTabProps) {
  const hasContent =
    data.news.length > 0 ||
    data.events.length > 0 ||
    data.media.length > 0 ||
    data.vehicleTimeline.length > 0;

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>📰</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No Related Content
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          News and related content not yet available
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {/* News Articles */}
      {data.news.length > 0 && (
        <View>
          <SectionTitle theme={theme}>
            Latest News ({data.news.length})
          </SectionTitle>
          <View style={{ gap: 16 }}>
            {data.news.map((article, idx) => (
              <Pressable
                key={idx}
                onPress={() => Linking.openURL(article.url)}
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  overflow: 'hidden',
                }}
              >
                {/* Article Image */}
                {article.image && (
                  <View
                    style={{
                      width: '100%',
                      height: 180,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <Image
                      source={{ uri: article.image }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  </View>
                )}

                {/* Article Content */}
                <View style={{ padding: 16 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: theme.foreground,
                      lineHeight: 22,
                      marginBottom: 8,
                    }}
                    numberOfLines={3}
                  >
                    {article.title}
                  </Text>

                  {article.summary && (
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.muted,
                        lineHeight: 18,
                        marginBottom: 12,
                      }}
                      numberOfLines={3}
                    >
                      {article.summary}
                    </Text>
                  )}

                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.accent, fontWeight: '600' }}>
                      {article.source}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.muted }}>
                      {article.date}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Related Events */}
      {data.events.length > 0 && (
        <View>
          <SectionTitle theme={theme}>
            Related Events ({data.events.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.events.map((event, idx) => (
              <View
                key={idx}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderLeftWidth: 4,
                  borderLeftColor: theme.accent,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  {/* Event Icon */}
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: theme.accent + '20',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>
                      {getEventIcon(event.type)}
                    </Text>
                  </View>

                  {/* Event Details */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.foreground, marginBottom: 4 }}>
                      {event.name || `Event ${idx + 1}`}
                    </Text>

                    {event.type && (
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 4,
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          alignSelf: 'flex-start',
                          marginBottom: 6,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: theme.muted, textTransform: 'uppercase' }}>
                          {event.type}
                        </Text>
                      </View>
                    )}

                    {event.date && (
                      <Text style={{ fontSize: 12, color: theme.muted }}>
                        📅 {event.date}
                      </Text>
                    )}

                    {event.location && (
                      <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                        📍 {event.location}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Official Media */}
      {data.media.length > 0 && (
        <View>
          <SectionTitle theme={theme}>
            Official Media ({data.media.length})
          </SectionTitle>
          <View style={{ gap: 12 }}>
            {data.media.map((item, idx) => (
              <Pressable
                key={idx}
                onPress={() => item.url && Linking.openURL(item.url)}
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
                  {getMediaIcon(item.type ?? undefined)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>
                    {item.title || item.name}
                  </Text>
                  {item.description && (
                    <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                </View>
                {item.url && (
                  <Text style={{ fontSize: 14, color: theme.accent }}>→</Text>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Resources */}
      {data.resources && (data.resources.pressKit || data.resources.missionPage) && (
        <View>
          <SectionTitle theme={theme}>Resources</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.resources.pressKit && (
              <Pressable
                onPress={() => {
                  if (data.resources?.pressKit) {
                    Linking.openURL(data.resources.pressKit);
                  }
                }}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 20 }}>📄</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>
                    Press Kit
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: theme.accent }}>→</Text>
              </Pressable>
            )}

            {data.resources.missionPage && (
              <Pressable
                onPress={() => {
                  if (data.resources?.missionPage) {
                    Linking.openURL(data.resources.missionPage);
                  }
                }}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 20 }}>🌐</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground }}>
                    Mission Page
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: theme.accent }}>→</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* Vehicle Timeline */}
      {data.vehicleTimeline.length > 0 && (
        <View>
          <SectionTitle theme={theme}>
            Vehicle History ({data.vehicleTimeline.length} launches)
          </SectionTitle>
          <View style={{ gap: 8 }}>
            {data.vehicleTimeline.slice(0, 10).map((launch, idx) => (
              <View
                key={idx}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderLeftWidth: 3,
                  borderLeftColor: launch.success ? '#7ff0bc' : theme.stroke,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.foreground, marginBottom: 4 }}>
                  {launch.mission}
                </Text>
                <Text style={{ fontSize: 12, color: theme.muted }}>
                  {launch.date}
                  {launch.success !== undefined && (
                    <Text style={{ color: launch.success ? '#7ff0bc' : '#ff9aab' }}>
                      {' • '}
                      {launch.success ? 'Success' : 'Failure'}
                    </Text>
                  )}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// Helper Components

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

// Helper Functions

function getEventIcon(type: string | undefined): string {
  switch (type?.toLowerCase()) {
    case 'docking':
      return '🔗';
    case 'undocking':
      return '🔓';
    case 'eva':
      return '👨‍🚀';
    case 'landing':
      return '🛬';
    case 'separation':
      return '✂️';
    default:
      return '📅';
  }
}

function getMediaIcon(type: string | undefined): string {
  switch (type?.toLowerCase()) {
    case 'video':
      return '🎥';
    case 'image':
    case 'photo':
      return '📸';
    case 'document':
      return '📄';
    case 'link':
      return '🔗';
    default:
      return '📎';
  }
}
