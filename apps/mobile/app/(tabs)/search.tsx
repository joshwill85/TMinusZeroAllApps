import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import type { SearchResultV1 } from '@tminuszero/contracts';
import { buildMobileRoute, buildSearchHref } from '@tminuszero/navigation';
import { prefetchLaunchDetail, useSearchQuery, useViewerSessionQuery } from '@/src/api/queries';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { getPublicSiteUrl } from '@/src/config/api';
import { resolveNativeProgramHubHref } from '@/src/features/programHubs/rollout';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatSearchResultLabel } from '@/src/utils/format';

const SEARCH_EXAMPLES = ['Starship', 'Artemis II', 'type:news starlink'];

function getQueryParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function SearchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useMobileApiClient();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const { theme } = useMobileBootstrap();
  const viewerSessionQuery = useViewerSessionQuery();
  const routeQuery = getQueryParam(params.q).trim();
  const [draft, setDraft] = useState(routeQuery);
  const searchQuery = useSearchQuery(routeQuery);
  const siteUrl = useMemo(() => getPublicSiteUrl(), []);
  const results = searchQuery.data?.results ?? [];
  const tookMs = searchQuery.data?.tookMs ?? null;
  const heading = getHeading(routeQuery, searchQuery.isPending, searchQuery.isError, results.length);

  useEffect(() => {
    setDraft(routeQuery);
  }, [routeQuery]);

  const submitSearch = () => {
    const nextQuery = draft.trim();
    if (!nextQuery) {
      router.replace(buildMobileRoute('search') as Href);
      return;
    }

    router.replace(buildSearchHref(nextQuery) as Href);
  };

  const runExampleSearch = (example: string) => {
    setDraft(example);
    router.replace(buildSearchHref(example) as Href);
  };

  const openResult = async (result: SearchResultV1) => {
    if (result.href.startsWith('/launches/')) {
      const launchId = result.href.split('/').pop() || '';
      if (launchId) {
        void prefetchLaunchDetail(queryClient, client, launchId);
      }
      router.push(result.href as Href);
      return;
    }

    const nativeHubHref = resolveNativeProgramHubHref(viewerSessionQuery.data, result.href);
    if (nativeHubHref) {
      router.push(nativeHubHref as Href);
      return;
    }

    const resolvedHref = resolveResultHref(result.href, siteUrl);
    try {
      await WebBrowser.openBrowserAsync(resolvedHref);
    } catch {
      await Linking.openURL(resolvedHref);
    }
  };

  return (
    <AppScreen testID="search-screen" keyboardShouldPersistTaps="handled">
      <CustomerShellHero
        eyebrow="Unified Search"
        title={heading}
        description="Live results update as you type and pull from launches, program hubs, guides, contracts, recovery assets, catalog entities, pages, and news."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Launches + programs" tone="accent" />
          <CustomerShellBadge label="Guides + news" />
          {tookMs != null && routeQuery.length >= 2 && !searchQuery.isPending && !searchQuery.isError ? (
            <CustomerShellBadge label={`${tookMs} ms`} tone="success" />
          ) : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Search query"
        description="Search across launches, missions, providers, guides, and news. Results stay in the route so deep links and relaunches land on the same query."
      >
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            paddingHorizontal: 16,
            paddingVertical: 14
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Search query
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <SearchGlyph color={theme.muted} />
            <TextInput
              testID="search-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="Starship, jellyfish, Artemis II, award ID..."
              placeholderTextColor={theme.muted}
              onSubmitEditing={submitSearch}
              style={{
                flex: 1,
                color: theme.foreground,
                fontSize: 16,
                paddingVertical: 0
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SEARCH_EXAMPLES.map((example) => (
            <Pressable
              key={example}
              onPress={() => runExampleSearch(example)}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: pressed ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.04)',
                paddingHorizontal: 12,
                paddingVertical: 8
              })}
            >
              <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>{example}</Text>
            </Pressable>
          ))}
        </View>

        <CustomerShellActionButton testID="search-submit" label="Search" onPress={submitSearch} />
      </CustomerShellPanel>

      {!routeQuery ? (
        <>
          <CustomerShellPanel
            title="Coverage"
            description="Launch detail pages, mission hubs, program pages, contracts, people, recovery assets, catalog entities, and live news."
          />
          <CustomerShellPanel
            title="Query tips"
            description="Quoted phrases keep words together. Prefix with `-` to exclude a term. Use `type:news` when you want editorial coverage."
          />
        </>
      ) : searchQuery.isPending ? (
        <CustomerShellPanel title="Searching" description={`Running “${routeQuery}” against the shared site index.`} />
      ) : searchQuery.isError ? (
        <CustomerShellPanel title="Search unavailable" description={searchQuery.error.message} />
      ) : results.length === 0 ? (
        <CustomerShellPanel title="No matches" description={`No results were returned for “${routeQuery}”.`} />
      ) : (
        <CustomerShellPanel
          testID="search-results-section"
          title="Results"
          description={`${results.length} result${results.length === 1 ? '' : 's'} returned${tookMs != null ? ` in ${tookMs} ms` : ''}.`}
        >
          <View style={{ gap: 12 }}>
            {results.map((result, index) => (
              <Pressable
                testID={index === 0 ? 'search-result-first' : `search-result-${result.id}`}
                key={`${result.type}:${result.id}`}
                onPress={() => {
                  void openResult(result);
                }}
                style={({ pressed }) => ({
                  gap: 10,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(234, 240, 255, 0.1)',
                  backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 16,
                  paddingVertical: 16
                })}
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <CustomerShellBadge label={String(result.badge || formatSearchResultLabel(result.type)).trim()} />
                    <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{result.title}</Text>
                  </View>
                  {result.publishedAt ? (
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                      {formatResultDate(result.publishedAt)}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                  {result.summary || result.subtitle || 'Open the source page for the full launch, program, or article details.'}
                </Text>
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                  {result.href.startsWith('/launches/') ? 'Open launch detail' : trimRouteLabel(result.href)}
                </Text>
              </Pressable>
            ))}
          </View>
        </CustomerShellPanel>
      )}
    </AppScreen>
  );
}

function getHeading(routeQuery: string, isPending: boolean, isError: boolean, resultCount: number) {
  if (routeQuery.length < 2) {
    return 'Search across launches, programs, guides, and news';
  }
  if (isError) {
    return 'Search is temporarily unavailable';
  }
  if (isPending && resultCount === 0) {
    return 'Searching...';
  }
  return `Results for "${routeQuery}"`;
}

function resolveResultHref(href: string, siteUrl: string) {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  return `${siteUrl}${href.startsWith('/') ? href : `/${href}`}`;
}

function trimRouteLabel(href: string) {
  if (/^https?:\/\//i.test(href)) {
    return href.replace(/^https?:\/\//i, '');
  }

  return href;
}

function formatResultDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

function SearchGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          borderWidth: 1.6,
          borderColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 6,
          height: 1.6,
          borderRadius: 999,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }, { translateX: 1 }]
        }}
      />
    </View>
  );
}
