import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { MobileTheme } from '@tminuszero/design-tokens';
import type { LiveTabData } from '@tminuszero/launch-detail-ui';
import { JepPanel } from '@/src/components/launch/JepPanel';
import { XPostInlineEmbed } from '@/src/components/launch/XPostInlineEmbed';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { formatTimestamp } from '@/src/utils/format';

type LiveTabProps = {
  data: LiveTabData;
  theme: MobileTheme;
};

export function LiveTab({ data, theme }: LiveTabProps) {
  const [isForecastExpanded, setIsForecastExpanded] = useState(false);
  const hasWeather = Boolean(data.weatherDetail?.summary || data.weatherDetail?.cards?.length || data.weatherDetail?.concerns?.length);
  const hasForecastOutlook = hasWeather || data.faaAdvisories.length > 0;
  const hasContent =
    hasForecastOutlook ||
    data.hasJepScore ||
    data.watchLinks.length > 0 ||
    data.launchUpdates.length > 0 ||
    data.socialPosts.length > 0;

  if (!hasContent) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 8 }}>
          No live detail yet
        </Text>
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingHorizontal: 40 }}>
          Forecasts, streams, provider posts, and FAA notices will appear here when they are available.
        </Text>
      </View>
    );
  }

  const primaryWatchLink = data.watchLinks[0] ?? null;

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24 }}>
        {hasForecastOutlook ? (
          <SectionCard theme={theme}>
            <Pressable
              onPress={() => {
                setIsForecastExpanded((current) => !current);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12
              }}
            >
              <View style={{ flex: 1, gap: 8 }}>
                <SectionTitle theme={theme}>Forecast outlook</SectionTitle>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                  {hasWeather
                    ? data.faaAdvisories.length > 0
                      ? 'Weather sources and matched FAA launch advisories for launch day.'
                      : 'Weather sources matched to this launch.'
                    : 'Matched FAA launch advisories and launch-day airspace notices.'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                {data.faaAdvisories.length > 0 ? (
                  <Badge label={`${data.faaAdvisories.length} match${data.faaAdvisories.length === 1 ? '' : 'es'}`} theme={theme} />
                ) : null}
                <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>
                  {isForecastExpanded ? 'Collapse' : 'Expand'}
                </Text>
              </View>
            </Pressable>

            {isForecastExpanded ? (
              <View style={{ gap: 14 }}>
                {hasWeather ? (
                  <>
                    {data.weatherDetail?.summary ? (
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700', lineHeight: 22 }}>
                        {data.weatherDetail.summary}
                      </Text>
                    ) : null}
                    {data.weatherDetail?.concerns?.length ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {data.weatherDetail.concerns.map((concern) => (
                          <Badge key={concern} label={concern} theme={theme} />
                        ))}
                      </View>
                    ) : null}
                    {data.weatherDetail?.cards?.length ? (
                      <View style={{ gap: 12 }}>
                        {data.weatherDetail.cards.map((card) => (
                          <WeatherCard key={card.id} card={card} theme={theme} />
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}

                {data.faaAdvisories.length > 0 ? (
                  <View
                    style={{
                      gap: 12,
                      marginTop: hasWeather ? 2 : 0,
                      borderTopWidth: hasWeather ? 1 : 0,
                      borderTopColor: hasWeather ? theme.stroke : 'transparent',
                      paddingTop: hasWeather ? 14 : 0
                    }}
                  >
                    <View style={{ gap: 4 }}>
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Launch advisories</Text>
                      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                        Temporary flight restrictions and NOTAM matches tied to this launch.
                      </Text>
                    </View>

                    {data.faaAdvisories.map((advisory) => (
                      <View
                        key={advisory.matchId}
                        style={{
                          gap: 10,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: advisory.isActiveNow ? 'rgba(251, 191, 36, 0.4)' : theme.stroke,
                          backgroundColor: advisory.isActiveNow ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                          padding: 16
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{advisory.title}</Text>
                            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                              {buildFaaSummary(advisory)}
                            </Text>
                          </View>
                          <Badge label={advisory.isActiveNow ? 'Active' : formatStatusLabel(advisory.status)} theme={theme} accent={advisory.isActiveNow} />
                        </View>

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {advisory.notamId ? <Badge label={advisory.notamId} theme={theme} /> : null}
                          {advisory.type ? <Badge label={advisory.type} theme={theme} /> : null}
                          {advisory.matchConfidence != null ? <Badge label={`Match ${Math.round(advisory.matchConfidence)}%`} theme={theme} /> : null}
                        </View>

                        <Text style={{ color: theme.muted, fontSize: 12 }}>
                          {formatFaaWindow(advisory.validStart, advisory.validEnd)}
                        </Text>

                        {advisory.rawText ? (
                          <Text style={{ color: theme.foreground, fontSize: 13, lineHeight: 20 }}>
                            {buildFaaPreview(advisory.rawText)}
                          </Text>
                        ) : null}

                        {advisory.sourceGraphicUrl || advisory.sourceRawUrl || advisory.sourceUrl ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                            {advisory.sourceGraphicUrl || advisory.sourceUrl ? (
                              <Pressable
                                onPress={() => {
                                  void openExternalCustomerUrl(advisory.sourceGraphicUrl || advisory.sourceUrl || '');
                                }}
                              >
                                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                                  {advisory.sourceGraphicUrl ? 'Open FAA graphic page' : 'View FAA source'}
                                </Text>
                              </Pressable>
                            ) : null}
                            {advisory.sourceRawUrl && advisory.sourceRawUrl !== advisory.sourceGraphicUrl && advisory.sourceRawUrl !== advisory.sourceUrl ? (
                              <Pressable
                                onPress={() => {
                                  void openExternalCustomerUrl(advisory.sourceRawUrl || '');
                                }}
                              >
                                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>View raw notice text</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </SectionCard>
        ) : null}

      <JepPanel launchId={data.launchId} hasJepScore={data.hasJepScore} theme={theme} />

      {primaryWatchLink ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Live coverage</SectionTitle>
          <Pressable
            onPress={() => {
              void openExternalCustomerUrl(primaryWatchLink.url);
            }}
            style={({ pressed }) => ({
              gap: 8,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.035)',
              padding: 16,
              opacity: pressed ? 0.9 : 1
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{primaryWatchLink.title || primaryWatchLink.label}</Text>
                {primaryWatchLink.meta ? <Text style={{ color: theme.muted, fontSize: 13 }}>{primaryWatchLink.meta}</Text> : null}
              </View>
              <OpenLabel theme={theme} />
            </View>
          </Pressable>
          {data.watchLinks.length > 1 ? (
            <View style={{ gap: 10, marginTop: 12 }}>
              {data.watchLinks.slice(1).map((link) => (
                <LinkRow
                  key={link.url}
                  title={link.title || link.label}
                  subtitle={link.meta || link.host || 'Stream'}
                  theme={theme}
                  onPress={() => {
                    void openExternalCustomerUrl(link.url);
                  }}
                />
              ))}
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      {data.socialPosts.length > 0 || data.launchUpdates.length > 0 ? (
        <SectionCard theme={theme}>
          <SectionTitle theme={theme}>Social & updates</SectionTitle>
          <View style={{ gap: 12 }}>
            {data.socialPosts.map((post) =>
              post.kind === 'matched' ? (
                <View
                  key={post.id}
                  style={{
                    gap: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(34, 211, 238, 0.08)',
                    padding: 16
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{post.title}</Text>
                        <Badge label="Matched" theme={theme} accent />
                      </View>
                      {post.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{post.subtitle}</Text> : null}
                      {post.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{post.description}</Text> : null}
                      {post.matchedAt ? <Text style={{ color: theme.muted, fontSize: 12 }}>Matched {formatTimestamp(post.matchedAt)}</Text> : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                    <Pressable
                      onPress={() => {
                        void openExternalCustomerUrl(post.url);
                      }}
                      style={({ pressed }) => ({
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        opacity: pressed ? 0.88 : 1
                      })}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Open on X</Text>
                    </Pressable>
                  </View>
                  {post.postId ? (
                    <XPostInlineEmbed postId={post.postId} />
                  ) : (
                    <View
                      style={{
                        marginTop: 4,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14
                      }}
                    >
                      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                        A matched source URL is available, but no X status ID could be extracted for inline embed rendering.
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <Pressable
                  key={post.id}
                  onPress={() => {
                    void openExternalCustomerUrl(post.url);
                  }}
                  style={({ pressed }) => ({
                    gap: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 16,
                    opacity: pressed ? 0.9 : 1
                  })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{post.title}</Text>
                        <Badge label={post.platform.toUpperCase()} theme={theme} />
                      </View>
                      {post.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{post.subtitle}</Text> : null}
                      {post.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{post.description}</Text> : null}
                    </View>
                    <OpenLabel theme={theme} />
                  </View>
                </Pressable>
              )
            )}

            {data.launchUpdates.map((update) => (
              <View
                key={update.id}
                style={{
                  gap: 6,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  padding: 16
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{update.field}</Text>
                {update.timestamp ? <Text style={{ color: theme.muted, fontSize: 12 }}>{formatTimestamp(update.timestamp)}</Text> : null}
                {update.newValue ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{update.newValue}</Text> : null}
              </View>
            ))}
          </View>
        </SectionCard>
      ) : null}
      </ScrollView>
    </>
  );
}

function WeatherCard({
  card,
  theme
}: {
  card: NonNullable<LiveTabData['weatherDetail']>['cards'][number];
  theme: MobileTheme;
}) {
  return (
    <View
      style={{
        gap: 8,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        padding: 16
      }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{card.title}</Text>
        {card.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{card.subtitle}</Text> : null}
      </View>
      {card.headline ? <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{card.headline}</Text> : null}
      {(card.issuedAt || card.validStart || card.validEnd) ? (
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {[card.issuedAt ? `Issued ${formatTimestamp(card.issuedAt)}` : null, card.validStart ? `Valid ${formatTimestamp(card.validStart)}` : null, card.validEnd ? `to ${formatTimestamp(card.validEnd)}` : null]
            .filter(Boolean)
            .join(' • ')}
        </Text>
      ) : null}
      {card.badges.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {card.badges.map((badge) => (
            <Badge key={`${card.id}:${badge}`} label={badge} theme={theme} />
          ))}
        </View>
      ) : null}
      {card.metrics.length ? (
        <View style={{ gap: 8 }}>
          {card.metrics.map((metric) => (
            <MetricRow key={`${card.id}:${metric.label}`} label={metric.label} value={metric.value} theme={theme} />
          ))}
        </View>
      ) : null}
      {card.detail ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{card.detail}</Text> : null}
      {card.actionUrl && card.actionLabel ? (
        <Pressable
          onPress={() => {
            void openExternalCustomerUrl(card.actionUrl || '');
          }}
        >
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{card.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
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
      <OpenLabel theme={theme} />
    </Pressable>
  );
}

function MetricRow({ label, value, theme }: { label: string; value: string; theme: MobileTheme }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: theme.muted, fontSize: 12, flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
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

function OpenLabel({ theme }: { theme: MobileTheme }) {
  return <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open</Text>;
}

function formatFaaWindow(validStart: string | null | undefined, validEnd: string | null | undefined) {
  const start = validStart ? formatTimestamp(validStart) : null;
  const end = validEnd ? formatTimestamp(validEnd) : null;
  if (start && end) return `${start} to ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return 'Official schedule pending';
}

function formatStatusLabel(status: string | null | undefined) {
  if (status === 'expired') return 'Expired';
  if (status === 'manual') return 'Manual';
  return 'Scheduled';
}

function buildFaaSummary(advisory: LiveTabData['faaAdvisories'][number]) {
  const parts = [
    advisory.notamId,
    advisory.facility,
    advisory.type,
    advisory.shapeCount > 0 ? `${advisory.shapeCount} shape${advisory.shapeCount === 1 ? '' : 's'}` : null
  ].filter(Boolean);
  return parts.join(' • ') || 'Launch-linked airspace notice';
}

function buildFaaPreview(rawText: string | null | undefined) {
  if (!rawText) return null;
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}
