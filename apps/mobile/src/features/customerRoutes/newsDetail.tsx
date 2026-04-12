import { useEffect } from 'react';
import { Image, Linking, Share, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { NewsArticleDetailV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { recordRecentCustomerRouteEntry } from './history';
import { useNewsArticleDetailQuery } from './queries';
import { formatRouteDateTime, openExternalCustomerUrl, RouteListRow } from './shared';

export function NewsArticleRouteScreen({ articleId }: { articleId: string }) {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const query = useNewsArticleDetailQuery(articleId, { enabled: Boolean(articleId) });
  const article = query.data ?? null;

  useEffect(() => {
    if (!articleId.trim() || !article) return;
    void recordRecentCustomerRouteEntry({
      kind: 'news',
      href: `/news/${encodeURIComponent(article.id)}`,
      title: article.title,
      subtitle: article.sourceLabel ?? article.summary ?? 'News article',
      badge: article.itemType
    });
  }, [article, articleId]);

  if (!articleId.trim()) {
    return (
      <AppScreen testID="news-article-screen">
        <CustomerShellHero eyebrow="News detail" title="Story unavailable" description="No article identifier was provided for this route." />
        <CustomerShellPanel title="Next step" description="Return to the stream and choose a story from the native feed.">
          <CustomerShellActionButton label="Back to stream" onPress={() => router.replace('/news' as Href)} />
        </CustomerShellPanel>
      </AppScreen>
    );
  }

  if (query.isPending) {
    return (
      <AppScreen testID="news-article-screen">
        <CustomerShellHero eyebrow="News" title="Loading story" description="Fetching native article detail and related launch context." />
      </AppScreen>
    );
  }

  if (query.isError || !article) {
    return (
      <AppScreen testID="news-article-screen">
        <CustomerShellHero eyebrow="News" title="Story unavailable" description={query.error instanceof Error ? query.error.message : 'The story could not be loaded.'} />
        <CustomerShellPanel title="Next step" description="Return to the stream or retry the article detail request.">
          <View style={{ gap: 10 }}>
            <CustomerShellActionButton label="Back to stream" onPress={() => router.replace('/news' as Href)} />
            <CustomerShellActionButton label="Retry" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        </CustomerShellPanel>
      </AppScreen>
    );
  }

  const primaryLaunch = article.relatedLaunches[0] ?? null;

  return (
    <AppScreen testID="news-article-screen">
      <CustomerShellHero eyebrow="News detail" title={article.title} description={article.summary ?? 'Open the native summary, then hand off to the publisher for the full story.'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={formatNewsTypeLabel(article.itemType)} tone="accent" />
          {article.sourceLabel ? <CustomerShellBadge label={article.sourceLabel} /> : null}
          <CustomerShellBadge label={formatRouteDateTime(article.updatedAt || article.publishedAt)} />
          {article.authors.length ? <CustomerShellBadge label={formatAuthorLabel(article.authors)} /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Story frame" description="Native detail keeps metadata, launch context, and source actions in one place.">
        <View style={{ gap: 14 }}>
          <View
            style={{
              overflow: 'hidden',
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)'
            }}
          >
            <View style={{ height: 220, backgroundColor: 'rgba(34, 211, 238, 0.08)' }}>
              {article.imageUrl ? (
                <Image source={{ uri: article.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 24
                  }}
                >
                  <Text style={{ color: '#eaf0ff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{article.sourceLabel ?? 'Mission coverage'}</Text>
                  <Text style={{ color: '#8c9cad', fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' }}>
                    Hero imagery was not provided for this article. Source and launch context stay available below.
                  </Text>
                </View>
              )}
            </View>
            <View style={{ gap: 10, paddingHorizontal: 16, paddingVertical: 16 }}>
              {article.excerpt ? <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>{article.excerpt}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {article.publishedAt ? <CustomerShellBadge label={`Published ${formatRouteDateTime(article.publishedAt)}`} /> : null}
                {article.updatedAt && article.updatedAt !== article.publishedAt ? <CustomerShellBadge label={`Updated ${formatRouteDateTime(article.updatedAt)}`} /> : null}
              </View>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <CustomerShellActionButton
              label="Read in app browser"
              onPress={() => {
                void openExternalCustomerUrl(article.sourceUrl);
              }}
            />
            <CustomerShellActionButton
              label="Open externally"
              variant="secondary"
              onPress={() => {
                void Linking.openURL(article.sourceUrl);
              }}
            />
            <CustomerShellActionButton
              label="Share article"
              variant="secondary"
              onPress={() => {
                void Share.share({
                  message: `${article.title}\n${article.sourceUrl}`,
                  url: article.sourceUrl,
                  title: article.title
                });
              }}
            />
          </View>
        </View>
      </CustomerShellPanel>

      {primaryLaunch ? (
        <CustomerShellPanel title="Linked launch" description="Use the launch context to jump straight into follow, countdown, and launch-specific detail.">
          <View style={{ gap: 10 }}>
            <RouteListRow
              title={primaryLaunch.name}
              subtitle={[primaryLaunch.provider, primaryLaunch.statusText].filter(Boolean).join(' • ') || 'Open launch detail'}
              meta={formatRouteDateTime(primaryLaunch.net)}
              badge="launch"
              onPress={() => router.push(primaryLaunch.href as Href)}
            />
            <View style={{ gap: 10 }}>
              <CustomerShellActionButton label="Open launch" onPress={() => router.push(primaryLaunch.href as Href)} />
              <CustomerShellActionButton
                label="Follow on launch page"
                variant="secondary"
                onPress={() => router.push(primaryLaunch.href as Href)}
              />
            </View>
          </View>
        </CustomerShellPanel>
      ) : null}

      {article.relatedLaunches.length > 1 ? (
        <CustomerShellPanel title="More linked launches" description={`${article.relatedLaunches.length - 1} additional related launch reference${article.relatedLaunches.length - 1 === 1 ? '' : 's'}.`}>
          <View style={{ gap: 10 }}>
            {article.relatedLaunches.slice(1).map((launch) => (
              <RouteListRow
                key={launch.id}
                title={launch.name}
                subtitle={[launch.provider, launch.statusText].filter(Boolean).join(' • ') || 'Open launch detail'}
                meta={formatRouteDateTime(launch.net)}
                badge="launch"
                onPress={() => router.push(launch.href as Href)}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {article.relatedActions.length ? (
        <CustomerShellPanel title="Native actions" description="Connected in-app destinations for this story and its launch context.">
          <View style={{ gap: 10 }}>
            {article.relatedActions.map((action) => (
              <CustomerShellActionButton
                key={`${action.label}:${action.href}`}
                label={action.label}
                variant={action.external ? 'secondary' : 'primary'}
                onPress={() => {
                  if (action.external) {
                    void openExternalCustomerUrl(action.href);
                    return;
                  }
                  router.push(action.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}
    </AppScreen>
  );
}

function formatNewsTypeLabel(type: NewsArticleDetailV1['itemType']) {
  if (type === 'article') return 'Article';
  if (type === 'blog') return 'Blog';
  if (type === 'report') return 'Report';
  return 'Story';
}

function formatAuthorLabel(authors: string[]) {
  if (!authors.length) return 'No byline';
  if (authors.length === 1) return `By ${authors[0]}`;
  if (authors.length === 2) return `By ${authors[0]} + ${authors[1]}`;
  return `By ${authors[0]} +${authors.length - 1}`;
}
