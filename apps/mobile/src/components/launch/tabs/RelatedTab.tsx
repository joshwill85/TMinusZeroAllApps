import React from 'react';
import { useRouter, type Href } from 'expo-router';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { RelatedTabData } from '@tminuszero/launch-detail-ui';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { formatTimestamp } from '@/src/utils/format';

type RelatedTabProps = {
  data: RelatedTabData;
  theme: MobileTheme;
};

export function RelatedTab({ data, theme }: RelatedTabProps) {
  const router = useRouter();
  const hasContent =
    data.vehicleTimeline.length > 0 ||
    data.news.length > 0 ||
    data.events.length > 0 ||
    data.media.length > 0 ||
    Boolean(data.resources?.pressKit || data.resources?.missionPage);

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No related content
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Vehicle history, news, related events, and official resources will appear here when they are available.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
      {data.vehicleTimeline.length > 0 ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Vehicle timeline</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.vehicleTimeline.map((launch) => (
              <Pressable
                key={launch.id}
                onPress={() => {
                  if (!launch.launchId || launch.isCurrent) return;
                  router.push((`/launches/${launch.launchId}`) as Href);
                }}
                disabled={!launch.launchId || launch.isCurrent}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 12,
                  opacity: pressed && !launch.isCurrent ? 0.9 : 1
                })}
              >
                <View style={{ alignItems: 'center', width: 18 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      marginTop: 5,
                      backgroundColor: statusColor(launch.status, theme)
                    }}
                  />
                  <View
                    style={{
                      width: 2,
                      flex: 1,
                      marginTop: 6,
                      backgroundColor: 'rgba(255, 255, 255, 0.08)'
                    }}
                  />
                </View>
                <View
                  style={{
                    flex: 1,
                    gap: 6,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: launch.isCurrent ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
                    backgroundColor: launch.isCurrent ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                    padding: 16
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700', flex: 1 }}>{launch.missionName}</Text>
                    <Badge label={launch.isCurrent ? 'Current' : launch.statusLabel || launch.status} theme={theme} accent={launch.isCurrent} />
                  </View>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>
                    {[launch.date ? formatTimestamp(launch.date) : null, launch.vehicleName].filter(Boolean).join(' • ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      ) : null}

      {data.news.length > 0 ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Launch news</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.news.map((article) => (
              <Pressable
                key={`${article.url}:${article.title}`}
                onPress={() => {
                  void openExternalCustomerUrl(article.url);
                }}
                style={({ pressed }) => ({
                  overflow: 'hidden',
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  opacity: pressed ? 0.9 : 1
                })}
              >
                {article.image ? (
                  <Image source={{ uri: article.image }} style={{ width: '100%', height: 164 }} resizeMode="cover" />
                ) : null}
                <View style={{ gap: 8, padding: 16 }}>
                  <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700', lineHeight: 22 }}>{article.title}</Text>
                  {article.summary ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{article.summary}</Text> : null}
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                    {[article.source, article.date ? formatTimestamp(article.date) : null].filter(Boolean).join(' • ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      ) : null}

      {data.events.length > 0 ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Related events</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.events.map((event) => (
              <Pressable
                key={`${event.name}:${event.date ?? 'event'}`}
                onPress={() => {
                  if (event.url) {
                    void openExternalCustomerUrl(event.url);
                  }
                }}
                disabled={!event.url}
                style={({ pressed }) => ({
                  gap: 6,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  padding: 16,
                  opacity: event.url && pressed ? 0.9 : 1
                })}
              >
                <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{event.name}</Text>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                  {[event.type, event.location, event.date ? formatTimestamp(event.date) : null].filter(Boolean).join(' • ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      ) : null}

      {data.media.length > 0 ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Official media</SectionTitle>
          <View style={{ gap: 10 }}>
            {data.media.map((item, index) => (
              <LinkRow
                key={`${item.url || item.title || item.name || 'media'}:${index}`}
                title={item.title || item.name || 'Media item'}
                subtitle={[item.type, item.description].filter(Boolean).join(' • ') || 'Official resource'}
                theme={theme}
                onPress={() => {
                  if (item.url) {
                    void openExternalCustomerUrl(item.url);
                  }
                }}
              />
            ))}
          </View>
        </SectionCard>
      ) : null}

      {data.resources && (data.resources.pressKit || data.resources.missionPage) ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Resources</SectionTitle>
          <View style={{ gap: 10 }}>
            {data.resources.pressKit ? (
              <LinkRow
                title="Press kit"
                subtitle="Mission press and media material"
                theme={theme}
                onPress={() => {
                  void openExternalCustomerUrl(data.resources?.pressKit || '');
                }}
              />
            ) : null}
            {data.resources.missionPage ? (
              <LinkRow
                title="Mission page"
                subtitle="Official mission details"
                theme={theme}
                onPress={() => {
                  void openExternalCustomerUrl(data.resources?.missionPage || '');
                }}
              />
            ) : null}
          </View>
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

function SectionCard({ children, theme }: { children: React.ReactNode; theme: MobileTheme }) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        gap: 14
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
        textTransform: 'uppercase',
        letterSpacing: 0.5
      }}
    >
      {children}
    </Text>
  );
}

function LinkRow({
  title,
  subtitle,
  theme,
  onPress
}: {
  title: string;
  subtitle: string;
  theme: MobileTheme;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        padding: 14,
        opacity: pressed ? 0.9 : 1
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open</Text>
    </Pressable>
  );
}

function Badge({
  label,
  theme,
  accent = false
}: {
  label: string;
  theme: MobileTheme;
  accent?: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accent ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
        backgroundColor: accent ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text
        style={{
          color: accent ? theme.accent : theme.foreground,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function statusColor(status: RelatedTabData['vehicleTimeline'][number]['status'], theme: MobileTheme) {
  if (status === 'success') return '#7ff0bc';
  if (status === 'upcoming') return theme.accent;
  return '#ff9aab';
}
