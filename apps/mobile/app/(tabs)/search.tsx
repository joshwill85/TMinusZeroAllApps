import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, Text, TextInput } from 'react-native';
import { buildMobileRoute, buildSearchHref } from '@tminuszero/navigation';
import { useSearchQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { formatSearchResultLabel } from '@/src/utils/format';

function getQueryParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const { theme } = useMobileBootstrap();
  const routeQuery = getQueryParam(params.q).trim();
  const [draft, setDraft] = useState(routeQuery);
  const searchQuery = useSearchQuery(routeQuery);

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

  return (
    <AppScreen keyboardShouldPersistTaps="handled">
      <ScreenHeader
        eyebrow="Shared search"
        title="Search"
        description="This screen keeps the query in the route so deep links and refreshes stay stable."
      />

      <SectionCard title="Query">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Mission, vehicle, pad, agency..."
          placeholderTextColor={theme.muted}
          onSubmitEditing={submitSearch}
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.background,
            color: theme.foreground,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontSize: 16
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <Pressable
          onPress={submitSearch}
          style={{
            marginTop: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 14,
            backgroundColor: theme.accent
          }}
        >
          <Text style={{ color: theme.background, fontSize: 15, fontWeight: '700' }}>Run search</Text>
        </Pressable>
      </SectionCard>

      {!routeQuery ? (
        <EmptyStateCard
          title="Start with a query"
          body="Search is wired up, but the request only runs once the route contains a query string."
        />
      ) : searchQuery.isPending ? (
        <LoadingStateCard title="Searching" body={`Running “${routeQuery}” against /api/v1/search.`} />
      ) : searchQuery.isError ? (
        <ErrorStateCard title="Search failed" body={searchQuery.error.message} />
      ) : searchQuery.data.results.length === 0 ? (
        <EmptyStateCard title="No results" body={`No matches were returned for “${routeQuery}”.`} />
      ) : (
        <SectionCard title="Results" description={`${searchQuery.data.results.length} result(s) returned.`}>
          {searchQuery.data.results.map((result) => {
            const nativeHref = result.href.startsWith('/launches/') ? (result.href as Href) : null;

            return (
              <Pressable
                key={`${result.type}:${result.id}`}
                onPress={() => {
                  if (nativeHref) {
                    router.push(nativeHref);
                  }
                }}
                style={({ pressed }) => ({
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: pressed ? theme.background : theme.surface,
                  padding: 16,
                  opacity: nativeHref ? 1 : 0.88
                })}
              >
                <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{result.title}</Text>
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
                  {result.subtitle ?? formatSearchResultLabel(result.type)}
                </Text>
                <Text style={{ color: theme.accent, fontSize: 13, marginTop: 10 }}>
                  {nativeHref ? 'Open launch detail' : `Web route pending: ${result.href}`}
                </Text>
              </Pressable>
            );
          })}
        </SectionCard>
      )}
    </AppScreen>
  );
}
