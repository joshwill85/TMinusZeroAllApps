import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import type { NewsStreamV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchNewsCard } from '@/src/components/launch/LaunchNewsCard';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { readRecentCustomerRouteEntries, type RecentCustomerRouteEntry } from './history';
import { formatRouteDateTime } from './shared';
import { useInfiniteNewsStreamQuery } from './queries';

const NEWS_FILTERS_STORAGE_KEY = 'customer-route-news-filters-v1';
const NEWS_FILTERS_STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

const NEWS_TYPES = [
  { label: 'All', value: 'all' as const },
  { label: 'Articles', value: 'article' as const },
  { label: 'Blogs', value: 'blog' as const },
  { label: 'Reports', value: 'report' as const }
];

const EMPTY_NEWS_PROVIDERS: NewsStreamV1['providers'] = [];

type PersistedNewsFilters = {
  type: NewsStreamV1['type'];
  providerSlug: string | null;
};

export function NewsScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const [hydrated, setHydrated] = useState(false);
  const [type, setType] = useState<NewsStreamV1['type']>('all');
  const [providerSlug, setProviderSlug] = useState<string | null>(null);
  const [providerSheetOpen, setProviderSheetOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [recentItems, setRecentItems] = useState<RecentCustomerRouteEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(NEWS_FILTERS_STORAGE_KEY, NEWS_FILTERS_STORAGE_OPTIONS);
        if (!stored) {
          if (!cancelled) {
            setHydrated(true);
          }
          return;
        }
        const parsed = JSON.parse(stored) as PersistedNewsFilters;
        if (!cancelled) {
          if (parsed.type === 'article' || parsed.type === 'blog' || parsed.type === 'report' || parsed.type === 'all') {
            setType(parsed.type);
          }
          setProviderSlug(typeof parsed.providerSlug === 'string' && parsed.providerSlug.trim() ? parsed.providerSlug.trim() : null);
          setHydrated(true);
        }
      } catch {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();

    void readRecentCustomerRouteEntries('news', 6).then((entries) => {
      if (!cancelled) {
        setRecentItems(entries);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void SecureStore.setItemAsync(
      NEWS_FILTERS_STORAGE_KEY,
      JSON.stringify({
        type,
        providerSlug
      } satisfies PersistedNewsFilters),
      NEWS_FILTERS_STORAGE_OPTIONS
    );
  }, [hydrated, providerSlug, type]);

  const query = useInfiniteNewsStreamQuery(
    {
      type,
      provider: providerSlug,
      limit: 18
    },
    { enabled: hydrated }
  );

  const stream = query.data?.pages?.[0] ?? null;
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data?.pages]);
  const providers = stream?.providers ?? EMPTY_NEWS_PROVIDERS;
  const filteredProviders = useMemo(() => {
    const search = providerSearch.trim().toLowerCase();
    if (!search) return providers;
    return providers.filter((provider) => {
      const haystack = `${provider.name} ${provider.slug} ${provider.countryCode || ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [providerSearch, providers]);
  const providerLabel = providerSlug ? providers.find((provider) => provider.slug === providerSlug)?.name ?? providerSlug : 'All providers';

  return (
    <AppScreen
      testID="news-screen"
      refreshControl={
        <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor="#6fe8ff" />
      }
    >
      <CustomerShellHero eyebrow="News" title={stream?.title ?? 'The CommLink Stream'} description={stream?.description ?? 'Launch-linked mission coverage with native detail, source handoff, and recent recall.'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={hydrated ? `${items.length} stories` : 'Loading'} tone="accent" />
          <CustomerShellBadge label={providerLabel} />
          <CustomerShellBadge label={type} />
          {stream?.hasMore ? <CustomerShellBadge label="Paging enabled" tone="warning" /> : null}
        </View>
      </CustomerShellHero>

      {recentItems.length ? (
        <CustomerShellPanel title="Recent views" description="Return to articles you opened recently on this device.">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {recentItems.map((item) => (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href as Href)}
                style={({ pressed }) => ({
                  width: 224,
                  gap: 10,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 16,
                  paddingVertical: 16
                })}
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {item.badge ? <CustomerShellBadge label={item.badge} tone="accent" /> : null}
                  <CustomerShellBadge label={formatRouteDateTime(item.updatedAt)} />
                </View>
                <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{item.title}</Text>
                {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.subtitle}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </CustomerShellPanel>
      ) : null}

      <CustomerShellPanel title="Filters" description="Keep a persistent stream mix per device and switch providers without typing raw slugs.">
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

          <Pressable
            onPress={() => {
              setProviderSearch('');
              setProviderSheetOpen(true);
            }}
            style={({ pressed }) => ({
              gap: 8,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: 'rgba(234, 240, 255, 0.1)',
              backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 14,
              paddingVertical: 14
            })}
          >
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Provider
            </Text>
            <Text style={{ color: '#eaf0ff', fontSize: 16, fontWeight: '700' }}>{providerLabel}</Text>
            <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19 }}>
              Searchable provider picker with current-device persistence.
            </Text>
          </Pressable>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <CustomerShellBadge label={`${providers.length} providers`} />
            {providerSlug ? (
              <Pressable
                onPress={() => setProviderSlug(null)}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(251, 191, 36, 0.24)',
                  backgroundColor: pressed ? 'rgba(251, 191, 36, 0.16)' : 'rgba(251, 191, 36, 0.12)',
                  paddingHorizontal: 10,
                  paddingVertical: 6
                })}
              >
                <Text style={{ color: '#ffd36e', fontSize: 10, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                  Clear provider
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Stream" description="Open a native article detail first, then hand off to the publisher when you want the full story.">
        <View style={{ gap: 14 }}>
          {!hydrated || query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading mission coverage…</Text>
          ) : query.isError ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
                {query.error instanceof Error ? query.error.message : 'Unable to load news.'}
              </Text>
              <CustomerShellActionButton label="Retry stream" onPress={() => void query.refetch()} />
            </View>
          ) : items.length ? (
            <>
              {items.map((item) => (
                <View key={item.id} style={{ gap: 10 }}>
                  <LaunchNewsCard
                    article={{
                      title: item.title,
                      summary: item.summary,
                      url: item.url,
                      source: item.newsSite,
                      imageUrl: item.imageUrl,
                      publishedAt: item.publishedAt,
                      itemType: item.itemType,
                      authors: item.authors,
                      featured: item.featured
                    }}
                    theme={theme}
                    actionLabel="Open story"
                    onPress={() => router.push(item.detailHref as Href)}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <CustomerShellBadge label={formatTrustLabel(item)} tone={item.relatedLaunchCount > 0 ? 'success' : 'default'} />
                    <CustomerShellBadge label={item.newsSite ?? 'Publisher source'} />
                    {item.relatedLaunchCount > 1 ? <CustomerShellBadge label={`+${item.relatedLaunchCount - 1} more launch links`} /> : null}
                  </View>
                  {item.launch ? (
                    <Pressable
                      onPress={() => router.push(item.launch?.href as Href)}
                      style={({ pressed }) => ({
                        gap: 6,
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: 'rgba(234, 240, 255, 0.08)',
                        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                        paddingHorizontal: 14,
                        paddingVertical: 12
                      })}
                    >
                      <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                        Linked launch
                      </Text>
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.launch.name}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                        {[item.launch.provider, formatRouteDateTime(item.launch.net)].filter(Boolean).join(' • ') || 'Open launch detail'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {query.hasNextPage ? (
                <CustomerShellActionButton
                  label={query.isFetchingNextPage ? 'Loading more…' : 'Continue downlink'}
                  onPress={() => {
                    if (!query.isFetchingNextPage) {
                      void query.fetchNextPage();
                    }
                  }}
                  disabled={query.isFetchingNextPage}
                />
              ) : (
                <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19 }}>
                  You reached the end of the current stream for these filters.
                </Text>
              )}
            </>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No news items matched the current filters.</Text>
              <CustomerShellActionButton
                label="Clear filters"
                variant="secondary"
                onPress={() => {
                  setType('all');
                  setProviderSlug(null);
                }}
              />
            </View>
          )}
        </View>
      </CustomerShellPanel>

      <ProviderPickerSheet
        open={providerSheetOpen}
        providerLabel={providerLabel}
        providers={filteredProviders}
        searchValue={providerSearch}
        selectedProviderSlug={providerSlug}
        onChangeSearch={setProviderSearch}
        onClose={() => setProviderSheetOpen(false)}
        onSelect={(slug) => {
          setProviderSlug(slug);
          setProviderSheetOpen(false);
        }}
      />
    </AppScreen>
  );
}

function ProviderPickerSheet({
  open,
  providerLabel,
  providers,
  searchValue,
  selectedProviderSlug,
  onChangeSearch,
  onClose,
  onSelect
}: {
  open: boolean;
  providerLabel: string;
  providers: NewsStreamV1['providers'];
  searchValue: string;
  selectedProviderSlug: string | null;
  onChangeSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (slug: string | null) => void;
}) {
  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.42)' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View
          style={{
            maxHeight: '78%',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: 'rgba(234, 240, 255, 0.1)',
            backgroundColor: '#070913',
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 28,
            gap: 14
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 44, height: 4, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.18)' }} />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>Provider picker</Text>
            <Text style={{ color: '#eaf0ff', fontSize: 21, fontWeight: '800' }}>{providerLabel}</Text>
            <Text style={{ color: '#8c9cad', fontSize: 14, lineHeight: 21 }}>
              Search providers by name or slug. The selected provider persists on this device.
            </Text>
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
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>Search providers</Text>
            <TextInput
              value={searchValue}
              onChangeText={onChangeSearch}
              placeholder="SpaceX, NSF, NASASpaceflight…"
              placeholderTextColor="#8c9cad"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ color: '#eaf0ff', fontSize: 16, marginTop: 8, paddingVertical: 0 }}
            />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <Pressable
              onPress={() => onSelect(null)}
              style={({ pressed }) => ({
                gap: 6,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: selectedProviderSlug == null ? 'rgba(34, 211, 238, 0.22)' : 'rgba(234, 240, 255, 0.08)',
                backgroundColor: selectedProviderSlug == null ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 16,
                paddingVertical: 14
              })}
            >
              <Text style={{ color: '#eaf0ff', fontSize: 15, fontWeight: '700' }}>All providers</Text>
              <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19 }}>Blend every source in one native stream.</Text>
            </Pressable>

            {providers.length ? (
              providers.map((provider) => (
                <Pressable
                  key={provider.slug}
                  onPress={() => onSelect(provider.slug)}
                  style={({ pressed }) => ({
                    gap: 6,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: selectedProviderSlug === provider.slug ? 'rgba(34, 211, 238, 0.22)' : 'rgba(234, 240, 255, 0.08)',
                    backgroundColor: selectedProviderSlug === provider.slug ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                    paddingHorizontal: 16,
                    paddingVertical: 14
                  })}
                >
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Text style={{ color: '#eaf0ff', fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{provider.name}</Text>
                    {provider.type ? <CustomerShellBadge label={provider.type} /> : null}
                    {provider.countryCode ? <CustomerShellBadge label={provider.countryCode} /> : null}
                  </View>
                  <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19 }}>{provider.slug}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 19 }}>No providers matched “{searchValue.trim()}”.</Text>
            )}
          </ScrollView>

          <CustomerShellActionButton label="Close" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
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

function formatTrustLabel(item: NewsStreamV1['items'][number]) {
  if (item.matchedBy === 'join') return 'Launch linked';
  if (item.matchedBy === 'mention') return 'Mention matched';
  return 'Source only';
}
