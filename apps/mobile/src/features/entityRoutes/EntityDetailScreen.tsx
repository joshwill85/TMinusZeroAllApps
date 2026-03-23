import { Image, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { LocationDetailV1, PadDetailV1, ProviderDetailV1, RocketDetailV1 } from '@tminuszero/api-client';
import { normalizeNativeMobileCustomerHref } from '@tminuszero/navigation';
import {
  useLocationDetailQuery,
  usePadDetailQuery,
  useProviderDetailQuery,
  useRocketDetailQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellBadge, CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';
import { RouteKeyValueRow, RouteListRow, formatRouteDateTime, openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';

type CoreEntityDetail = ProviderDetailV1 | RocketDetailV1 | LocationDetailV1 | PadDetailV1;

export function ProviderDetailRouteScreen({ slug, testID }: { slug: string; testID: string }) {
  const query = useProviderDetailQuery(slug || null);
  return <EntityDetailShell query={query} fallbackTitle={slug || 'provider'} testID={testID} />;
}

export function RocketDetailRouteScreen({ routeId, testID }: { routeId: string; testID: string }) {
  const query = useRocketDetailQuery(routeId || null);
  return <EntityDetailShell query={query} fallbackTitle={routeId || 'rocket'} testID={testID} />;
}

export function LocationDetailRouteScreen({ routeId, testID }: { routeId: string; testID: string }) {
  const query = useLocationDetailQuery(routeId || null);
  return <EntityDetailShell query={query} fallbackTitle={routeId || 'location'} testID={testID} />;
}

export function PadDetailRouteScreen({ routeId, testID }: { routeId: string; testID: string }) {
  const query = usePadDetailQuery(routeId || null);
  return <EntityDetailShell query={query} fallbackTitle={routeId || 'pad'} testID={testID} />;
}

function EntityDetailShell({
  query,
  fallbackTitle,
  testID
}: {
  query: {
    data: CoreEntityDetail | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
  fallbackTitle: string;
  testID: string;
}) {
  const detail = query.data ?? null;
  const router = useRouter();

  const openLink = (href: string, external = false) => {
    if (!href) return;
    if (external) {
      void openExternalCustomerUrl(href);
      return;
    }

    const nativeHref = normalizeNativeMobileCustomerHref(href) || href;
    if (nativeHref.startsWith('/')) {
      router.push(nativeHref as Href);
      return;
    }

    void openExternalCustomerUrl(nativeHref);
  };

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero
        eyebrow={detail?.eyebrow ?? 'Entity'}
        title={detail?.title ?? fallbackTitle}
        description={detail?.description ?? 'Loading native detail…'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={detail?.entity ?? 'native'} tone="accent" />
          {(detail?.badges ?? []).slice(0, 4).map((badge) => (
            <CustomerShellBadge key={`${badge.label}:${badge.tone}`} label={badge.label} tone={badge.tone} />
          ))}
          {detail?.generatedAt ? <CustomerShellBadge label={formatRouteDateTime(detail.generatedAt)} /> : null}
        </View>
      </CustomerShellHero>

      {detail?.imageUrl ? (
        <CustomerShellPanel title="Visual reference" description="Primary image and identity art for this native entity page.">
          <Image
            source={{ uri: detail.imageUrl }}
            resizeMode="cover"
            style={{
              width: '100%',
              aspectRatio: 1.9,
              borderRadius: 18,
              backgroundColor: 'rgba(255, 255, 255, 0.03)'
            }}
          />
        </CustomerShellPanel>
      ) : null}

      {query.isPending ? (
        <CustomerShellPanel title="Loading detail" description="Pulling the native entity payload and connected launch context." />
      ) : query.isError ? (
        <CustomerShellPanel
          title="Unable to load detail"
          description={query.error instanceof Error ? query.error.message : 'Unable to load this entity detail page.'}
        />
      ) : !detail ? (
        <CustomerShellPanel title="Detail unavailable" description="This entity did not resolve to a native detail payload." />
      ) : (
        <>
          {detail.facts.length ? (
            <CustomerShellPanel title="Facts" description="Entity metadata, identity, and linked reference context.">
              <View style={{ gap: 10 }}>
                {detail.facts.map((fact) => (
                  <RouteKeyValueRow key={`${fact.label}:${fact.value}`} label={fact.label} value={fact.value} />
                ))}
              </View>
            </CustomerShellPanel>
          ) : null}

          {detail.stats.length ? (
            <CustomerShellPanel title="Stats" description="Launch cadence and related-context counts for this entity.">
              <View style={{ gap: 10 }}>
                {detail.stats.map((stat) => (
                  <RouteKeyValueRow
                    key={`${stat.label}:${stat.value}`}
                    label={stat.label}
                    value={stat.detail ? `${stat.value} • ${stat.detail}` : stat.value}
                  />
                ))}
              </View>
            </CustomerShellPanel>
          ) : null}

          {detail.links.length ? (
            <CustomerShellPanel title="Primary links" description="Canonical native and external links tied directly to this entity.">
              <View style={{ gap: 10 }}>
                {detail.links.map((link) => (
                  <RouteListRow
                    key={`${link.title}:${link.href}`}
                    title={link.title}
                    subtitle={link.subtitle || (link.external ? 'External reference' : 'Native linked surface')}
                    badge={link.badge}
                    onPress={() => {
                      openLink(link.href, link.external);
                    }}
                  />
                ))}
              </View>
            </CustomerShellPanel>
          ) : null}

          {detail.relatedLinks.length ? (
            <CustomerShellPanel title="Connected surfaces" description="Continue through linked providers, vehicles, locations, pads, and supporting pages.">
              <View style={{ gap: 10 }}>
                {detail.relatedLinks.map((link) => (
                  <RouteListRow
                    key={`${link.title}:${link.href}`}
                    title={link.title}
                    subtitle={link.subtitle || 'Native linked surface'}
                    badge={link.badge}
                    onPress={() => {
                      openLink(link.href, link.external);
                    }}
                  />
                ))}
              </View>
            </CustomerShellPanel>
          ) : null}

          {detail.relatedNews.length ? (
            <CustomerShellPanel title="Related news" description="Latest linked coverage that stays connected to this entity.">
              <View style={{ gap: 10 }}>
                {detail.relatedNews.map((item) => (
                  <RouteListRow
                    key={item.id}
                    title={item.title}
                    subtitle={item.subtitle || 'Coverage item'}
                    meta={item.publishedAt ? formatRouteDateTime(item.publishedAt) : null}
                    badge={item.external ? 'external' : 'native'}
                    onPress={() => {
                      openLink(item.href, item.external);
                    }}
                  />
                ))}
              </View>
            </CustomerShellPanel>
          ) : null}

          <LaunchSection
            title="Upcoming launches"
            description="Forward schedule linked directly to this entity."
            launches={detail.upcomingLaunches}
            onOpen={(href) => {
              openLink(href, false);
            }}
          />
          <LaunchSection
            title="Recent launches"
            description="Recent launch history tied to this entity."
            launches={detail.recentLaunches}
            onOpen={(href) => {
              openLink(href, false);
            }}
          />
        </>
      )}
    </AppScreen>
  );
}

function LaunchSection({
  title,
  description,
  launches,
  onOpen
}: {
  title: string;
  description: string;
  launches: CoreEntityDetail['upcomingLaunches'];
  onOpen: (href: string) => void;
}) {
  if (!launches.length) {
    return <CustomerShellPanel title={title} description={`No ${title.toLowerCase()} are available for this entity yet.`} />;
  }

  return (
    <CustomerShellPanel title={title} description={description}>
      <View style={{ gap: 10 }}>
        {launches.map((launch) => (
          <RouteListRow
            key={launch.id}
            title={launch.name}
            subtitle={[launch.provider, launch.vehicle, launch.statusText].filter(Boolean).join(' • ') || 'Launch'}
            meta={launch.net ? formatRouteDateTime(launch.net) : null}
            badge={launch.status || null}
            onPress={() => {
              onOpen(launch.href);
            }}
          />
        ))}
      </View>
    </CustomerShellPanel>
  );
}
