import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { NewsStreamV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { formatRouteDateTime, openExternalCustomerUrl, RouteListRow } from './shared';
import { useNewsStreamQuery } from './queries';

const NEWS_TYPES = [
  { label: 'All', value: 'all' as const },
  { label: 'Articles', value: 'article' as const },
  { label: 'Blogs', value: 'blog' as const },
  { label: 'Reports', value: 'report' as const }
];

export function NewsScreen() {
  const router = useRouter();
  const [type, setType] = useState<NewsStreamV1['type']>('all');
  const [providerSlug, setProviderSlug] = useState<string | null>(null);
  const query = useNewsStreamQuery(
    {
      type,
      provider: providerSlug,
      cursor: 0,
      limit: 24
    },
    { enabled: true }
  );
  const stream = query.data as NewsStreamV1 | null;
  const providers: NewsStreamV1['providers'] = stream?.providers ?? [];
  const items: NewsStreamV1['items'] = stream?.items ?? [];
  const providerLabel = providerSlug ? providers.find((provider) => provider.slug === providerSlug)?.name ?? providerSlug : 'All providers';

  return (
    <AppScreen testID="news-screen">
      <CustomerShellHero eyebrow="News" title={stream?.title ?? 'The CommLink Stream'} description={stream?.description ?? 'Launch-linked news and mission coverage.'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={stream ? `${items.length} items` : 'Loading'} tone="accent" />
          <CustomerShellBadge label={providerLabel} />
          <CustomerShellBadge label={type} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Filters" description="Toggle article type and provider without leaving the native app.">
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {NEWS_TYPES.map((option) => (
              <FilterChip
                key={option.value}
                label={option.label}
                active={type === option.value}
                onPress={() => {
                  setType(option.value);
                }}
              />
            ))}
          </View>

          <View
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: 'rgba(234, 240, 255, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 14,
              paddingVertical: 12
            }}
          >
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Provider filter
            </Text>
            <TextInput
              value={providerSlug ?? ''}
              onChangeText={(value) => {
                const next = String(value || '').trim().toLowerCase();
                setProviderSlug(next ? next : null);
              }}
              placeholder="provider slug"
              placeholderTextColor="#8c9cad"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ color: '#eaf0ff', fontSize: 16, marginTop: 8, paddingVertical: 0 }}
            />
            <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19, marginTop: 6 }}>
              Start typing a provider slug to narrow the stream. Leave blank to show every provider.
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <CustomerShellBadge label={providers.length ? `${providers.length} providers` : 'No provider list'} />
            {stream?.hasMore ? <CustomerShellBadge label={`More at cursor ${stream.nextCursor}`} tone="warning" /> : null}
          </View>
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Stream" description="Tap an item to open the launch detail or the original source page.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading news…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load news.'}
            </Text>
          ) : items.length ? (
            items.map((item: NewsStreamV1['items'][number]) => (
              <RouteListRow
                key={item.id}
                title={item.title}
                subtitle={buildNewsSubtitle(item)}
                meta={buildNewsMeta(item)}
                badge={item.matchedBy !== 'none' ? item.matchedBy : item.featured ? 'featured' : null}
                onPress={() => {
                  if (item.launch?.href) {
                    router.push(item.launch.href as Href);
                    return;
                  }
                  void openExternalCustomerUrl(item.url);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No news items matched the current filters.</Text>
          )}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function FilterChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.22)' : 'rgba(234, 240, 255, 0.08)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8
      })}
    >
      <Text style={{ color: active ? '#6fe8ff' : '#d4e0eb', fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function buildNewsSubtitle(item: NewsStreamV1['items'][number]) {
  const parts = [item.newsSite, item.summary].filter(Boolean);
  return parts.length ? parts.map((part) => String(part)).join(' • ') : 'Open the source article or the linked launch.';
}

function buildNewsMeta(item: NewsStreamV1['items'][number]) {
  const source = item.newsSite ?? 'Source';
  const date = formatRouteDateTime(item.publishedAt || item.updatedAt || null);
  return `${source} • ${date}`;
}
