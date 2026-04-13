import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { isDateOnlyNet } from '@/lib/time';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getIndexingSiteUrl } from '@/lib/server/indexing';
import { buildPageMetadata } from '@/lib/server/seo';
import { fetchProviderBySlug } from '@/lib/server/providers';
import { fetchProviderSchedule } from '@/lib/server/providerSchedule';
import { buildPublicStateFilterOrClause } from '@/lib/server/usStates';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { loadPublicLaunchPage } from '@/lib/server/publicLaunchFeed';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  getSpaceXMissionKeyFromLaunch
} from '@/lib/utils/spacexProgram';
import {
  getLaunchIntentLandingConfig,
  type LaunchIntentLandingConfig,
  type LaunchIntentLandingKey
} from '@/lib/server/launchIntentLandingConfig';
import type { SpaceXMissionKey } from '@/lib/types/spacexProgram';

type ProviderEntity = {
  name: string;
  slug: string;
  type?: string | null;
  countryCode?: string | null;
};

type LandingData = {
  entityName: string;
  entityMeta: string | null;
  featuredLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  mainEntityJsonLd: Record<string, unknown> | null;
  itemListJsonLd: Record<string, unknown> | null;
  featuredEventJsonLd: Record<string, unknown> | null;
  pageJsonLd: Record<string, unknown>;
};

type LaunchSplit = {
  upcoming: Launch[];
  recent: Launch[];
};

const PAGE_UPCOMING_LIMIT = 12;
const PAGE_RECENT_LIMIT = 12;
const FEATURED_LAUNCH_RELATED_LINK_LABEL = 'Launch Details';
const MISSION_LANDING_QUERY_LIMIT = 48;

const MISSION_LANDING_OR_FILTERS: Partial<Record<SpaceXMissionKey, string>> = {
  'falcon-9': [
    'name.ilike.%Falcon 9%',
    'mission_name.ilike.%Falcon 9%',
    'rocket_full_name.ilike.%Falcon 9%',
    'vehicle.ilike.%Falcon 9%'
  ].join(','),
  starship: [
    'name.ilike.%Starship%',
    'mission_name.ilike.%Starship%',
    'rocket_full_name.ilike.%Starship%',
    'vehicle.ilike.%Starship%',
    'name.ilike.%Super Heavy%',
    'mission_name.ilike.%Super Heavy%',
    'rocket_full_name.ilike.%Super Heavy%',
    'vehicle.ilike.%Super Heavy%'
  ].join(',')
};

const PROVIDER_FALLBACKS: Record<string, ProviderEntity> = {
  spacex: { name: 'SpaceX', slug: 'spacex' },
  'blue-origin': { name: 'Blue Origin', slug: 'blue-origin' },
  nasa: { name: 'NASA', slug: 'nasa' },
  'united-launch-alliance-ula': {
    name: 'United Launch Alliance (ULA)',
    slug: 'united-launch-alliance-ula'
  }
};

export const INTENT_LANDING_REVALIDATE_SECONDS = 60 * 5;

export function buildLaunchIntentLandingMetadata(
  key: LaunchIntentLandingKey
): Metadata {
  const config = getLaunchIntentLandingConfig(key);

  return buildPageMetadata({
    title: config.title,
    description: config.description,
    canonical: config.path,
    robots: {
      index: config.indexing.index,
      follow: config.indexing.follow
    }
  });
}

export async function renderLaunchIntentLandingPage(
  key: LaunchIntentLandingKey
) {
  const config = getLaunchIntentLandingConfig(key);
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${config.path}`;
  const data = await loadLandingData(config, pageUrl);
  const relatedLinks = buildRelatedLinks(config, data.featuredLaunch);
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: config.breadcrumbs.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item:
        index === config.breadcrumbs.length - 1 || !item.href
          ? pageUrl
          : `${siteUrl}${item.href}`
    }))
  };
  const jsonLd = [
    breadcrumbJsonLd,
    data.pageJsonLd,
    ...(data.mainEntityJsonLd ? [data.mainEntityJsonLd] : []),
    ...(data.itemListJsonLd ? [data.itemListJsonLd] : []),
    ...(data.featuredEventJsonLd ? [data.featuredEventJsonLd] : [])
  ];
  const upcomingForList =
    data.featuredLaunch &&
    data.upcoming[0] &&
    data.upcoming[0].id === data.featuredLaunch.id
      ? data.upcoming.slice(1)
      : data.upcoming;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={config.breadcrumbs} />

      <header className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">
            {config.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold text-text1">{config.title}</h1>
        </div>
        <p className="max-w-3xl text-sm text-text2">{config.intro}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Upcoming loaded: {data.upcoming.length}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Recent loaded: {data.recent.length}
          </span>
          {data.entityMeta ? (
            <span className="rounded-full border border-stroke px-3 py-1">
              {data.entityMeta}
            </span>
          ) : null}
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.1em] text-text3">
              Featured
            </p>
            <h2 className="text-xl font-semibold text-text1">
              {config.featureTitle}
            </h2>
          </div>
          <Link
            href="/"
            className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.12em] text-text3 transition hover:text-text1"
          >
            Full launch feed
          </Link>
        </div>

        {data.featuredLaunch ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-stroke bg-surface-0 p-4">
              <Link
                href={buildLaunchHref(data.featuredLaunch)}
                className="text-lg font-semibold text-text1 hover:text-primary"
              >
                {data.featuredLaunch.name}
              </Link>
              <p className="mt-2 text-sm text-text2">
                {data.featuredLaunch.provider} - {resolveVehicleLabel(data.featuredLaunch)} -{' '}
                {resolvePadLabel(data.featuredLaunch)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-text3">
                <span className="rounded-full border border-stroke px-3 py-1">
                  {formatLaunchDate(data.featuredLaunch)}
                </span>
                <span className="rounded-full border border-stroke px-3 py-1">
                  Status: {data.featuredLaunch.statusText || 'Tracking'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0 p-4">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">
                Mission window
              </div>
              <div className="mt-2 text-sm text-text2">
                {buildFeaturedSummary(data.featuredLaunch, config.title)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={buildLaunchHref(data.featuredLaunch)}
                  className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.12em] text-text3 transition hover:text-text1"
                >
                  Mission page
                </Link>
                <Link
                  href="/rocket-launches-today"
                  className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.12em] text-text3 transition hover:text-text1"
                >
                  Today&apos;s schedule
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-text3">{config.featureEmptyLabel}</p>
        )}
      </section>

      <LaunchListSection
        title={config.upcomingTitle}
        launches={upcomingForList}
        emptyLabel={`No upcoming missions are published for ${config.title.toLowerCase()} right now.`}
      />

      <LaunchListSection
        title={config.recentTitle}
        launches={data.recent}
        emptyLabel={`No recent mission history is loaded for ${config.title.toLowerCase()} right now.`}
      />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">
            Related internal links
          </h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
            {relatedLinks.length} links
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {relatedLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-stroke bg-surface-0 p-4 transition hover:border-primary"
            >
              <div className="text-sm font-semibold text-text1">
                {link.label}
              </div>
              <p className="mt-1 text-xs text-text3">{link.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

async function loadLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  switch (config.source.kind) {
    case 'provider':
      return loadProviderLandingData(config, pageUrl);
    case 'mission':
      return loadMissionLandingData(config, pageUrl);
    case 'location':
      return loadLocationLandingData(config, pageUrl);
    case 'state':
      return loadStateLandingData(config, pageUrl);
    case 'today':
      return loadTodayLandingData(config, pageUrl);
    case 'next-provider-launch':
      return loadNextProviderLaunchLandingData(config, pageUrl);
  }
}

async function loadProviderLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const source = config.source;
  if (source.kind !== 'provider') throw new Error('Unexpected landing source');

  const provider = await resolveProviderEntity(
    source.providerSlug,
    source.providerNameFallback
  );
  const schedule = await fetchProviderSchedule({ providerName: provider.name });
  const featuredLaunch = schedule.upcoming[0] || schedule.recent[0] || null;
  const entityMeta = [provider.type || null, provider.countryCode || null]
    .filter(Boolean)
    .join(' - ');
  const mainEntityId = `${pageUrl}#provider`;
  const mainEntityJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': mainEntityId,
    name: provider.name,
    url: pageUrl
  };

  return {
    entityName: provider.name,
    entityMeta: entityMeta || null,
    featuredLaunch,
    upcoming: schedule.upcoming.slice(0, PAGE_UPCOMING_LIMIT),
    recent: schedule.recent.slice(0, PAGE_RECENT_LIMIT),
    mainEntityJsonLd,
    itemListJsonLd: buildItemListJsonLd(pageUrl, schedule.upcoming),
    featuredEventJsonLd: featuredLaunch
      ? buildLaunchEventJsonLd(featuredLaunch, pageUrl)
      : null,
    pageJsonLd: buildCollectionPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId
    })
  };
}

async function loadMissionLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const source = config.source;
  if (source.kind !== 'mission') throw new Error('Unexpected landing source');

  const split = await fetchMissionLandingSplit(source.missionKey);
  const featuredLaunch = split.upcoming[0] || split.recent[0] || null;
  const mainEntityId = `${pageUrl}#rocket`;

  return {
    entityName: source.entityName,
    entityMeta: 'SpaceX mission schedule',
    featuredLaunch,
    upcoming: split.upcoming.slice(0, PAGE_UPCOMING_LIMIT),
    recent: split.recent.slice(0, PAGE_RECENT_LIMIT),
    mainEntityJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': mainEntityId,
      name: source.entityName,
      url: pageUrl,
      description: source.entityDescription,
      category: 'Launch vehicle',
      brand: { '@type': 'Brand', name: 'SpaceX' },
      manufacturer: { '@type': 'Organization', name: 'SpaceX' },
      sameAs: [source.officialHref]
    },
    itemListJsonLd: buildItemListJsonLd(pageUrl, split.upcoming),
    featuredEventJsonLd: featuredLaunch
      ? buildLaunchEventJsonLd(featuredLaunch, pageUrl)
      : null,
    pageJsonLd: buildCollectionPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId
    })
  };
}

async function loadLocationLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const source = config.source;
  if (source.kind !== 'location') throw new Error('Unexpected landing source');

  const split = await fetchLocationLaunchSplit(source.locationPatterns);
  const sample = split.upcoming[0] || split.recent[0] || null;
  const entityMeta = [sample?.pad.state || null, sample?.pad.countryCode || null]
    .filter((value) => value && value !== 'NA')
    .join(' - ');
  const mainEntityId = `${pageUrl}#place`;

  return {
    entityName: source.entityName,
    entityMeta: entityMeta || null,
    featuredLaunch: split.upcoming[0] || split.recent[0] || null,
    upcoming: split.upcoming.slice(0, PAGE_UPCOMING_LIMIT),
    recent: split.recent.slice(0, PAGE_RECENT_LIMIT),
    mainEntityJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Place',
      '@id': mainEntityId,
      name: source.entityName,
      url: pageUrl,
      address:
        sample?.pad.state || sample?.pad.countryCode
          ? {
              '@type': 'PostalAddress',
              addressRegion:
                sample?.pad.state && sample.pad.state !== 'NA'
                  ? sample.pad.state
                  : undefined,
              addressCountry:
                sample?.pad.countryCode && sample.pad.countryCode !== 'NA'
                  ? sample.pad.countryCode
                  : undefined
            }
          : undefined
    },
    itemListJsonLd: buildItemListJsonLd(pageUrl, split.upcoming),
    featuredEventJsonLd:
      split.upcoming[0] != null
        ? buildLaunchEventJsonLd(split.upcoming[0], pageUrl)
        : null,
    pageJsonLd: buildCollectionPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId
    })
  };
}

async function loadStateLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const source = config.source;
  if (source.kind !== 'state') throw new Error('Unexpected landing source');

  const split = await fetchStateLaunchSplit(source.stateCode);
  const mainEntityId = `${pageUrl}#area`;

  return {
    entityName: source.entityName,
    entityMeta: 'US launch region',
    featuredLaunch: split.upcoming[0] || split.recent[0] || null,
    upcoming: split.upcoming.slice(0, PAGE_UPCOMING_LIMIT),
    recent: split.recent.slice(0, PAGE_RECENT_LIMIT),
    mainEntityJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'AdministrativeArea',
      '@id': mainEntityId,
      name: source.entityName,
      url: pageUrl,
      address: {
        '@type': 'PostalAddress',
        addressRegion: source.stateCode,
        addressCountry: 'US'
      }
    },
    itemListJsonLd: buildItemListJsonLd(pageUrl, split.upcoming),
    featuredEventJsonLd:
      split.upcoming[0] != null
        ? buildLaunchEventJsonLd(split.upcoming[0], pageUrl)
        : null,
    pageJsonLd: buildCollectionPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId
    })
  };
}

async function loadTodayLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const nowMs = Date.now();
  const launches = await fetchTodayLaunches(nowMs);
  const upcoming = launches
    .filter((launch) => {
      const netMs = Date.parse(launch.net);
      return Number.isFinite(netMs) && netMs >= nowMs;
    })
    .slice(0, PAGE_UPCOMING_LIMIT);
  const recent = launches
    .filter((launch) => {
      const netMs = Date.parse(launch.net);
      return Number.isFinite(netMs) && netMs < nowMs;
    })
    .slice(0, PAGE_RECENT_LIMIT);
  const featuredLaunch = upcoming[0] || recent[0] || null;
  const itemListId = `${pageUrl}#launches-today`;

  return {
    entityName: config.title,
    entityMeta: 'US live feed window',
    featuredLaunch,
    upcoming,
    recent,
    mainEntityJsonLd: null,
    itemListJsonLd: launches.length
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': itemListId,
          numberOfItems: Math.min(25, launches.length),
          itemListElement: launches.slice(0, 25).map((launch, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'Event',
              name: launch.name,
              startDate: launch.net,
              url: `${getIndexingSiteUrl().replace(/\/$/, '')}${buildLaunchHref(launch)}`
            }
          }))
        }
      : null,
    featuredEventJsonLd: featuredLaunch
      ? buildLaunchEventJsonLd(featuredLaunch, pageUrl)
      : null,
    pageJsonLd: buildCollectionPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId: launches.length ? itemListId : undefined
    })
  };
}

async function loadNextProviderLaunchLandingData(
  config: LaunchIntentLandingConfig,
  pageUrl: string
): Promise<LandingData> {
  const source = config.source;
  if (source.kind !== 'next-provider-launch') {
    throw new Error('Unexpected landing source');
  }

  const provider = await resolveProviderEntity(
    source.providerSlug,
    source.providerNameFallback
  );
  const schedule = await fetchProviderSchedule({ providerName: provider.name });
  const nextLaunch = schedule.upcoming[0] || null;
  const mainEntityId = `${pageUrl}#provider`;

  return {
    entityName: provider.name,
    entityMeta: 'Current provider window',
    featuredLaunch: nextLaunch,
    upcoming: schedule.upcoming.slice(0, PAGE_UPCOMING_LIMIT),
    recent: schedule.recent.slice(0, PAGE_RECENT_LIMIT),
    mainEntityJsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': mainEntityId,
      name: provider.name,
      url: pageUrl
    },
    itemListJsonLd: buildItemListJsonLd(pageUrl, schedule.upcoming),
    featuredEventJsonLd: nextLaunch
      ? buildLaunchEventJsonLd(nextLaunch, pageUrl)
      : null,
    pageJsonLd: buildWebPageJsonLd({
      pageUrl,
      name: config.title,
      description: config.description,
      mainEntityId: nextLaunch ? `${pageUrl}#event` : mainEntityId
    })
  };
}

async function resolveProviderEntity(
  providerSlug: string,
  fallbackName: string
): Promise<ProviderEntity> {
  const provider = await fetchProviderBySlug(providerSlug);
  if (provider) {
    return {
      name: provider.name,
      slug: provider.slug,
      type: provider.type,
      countryCode: provider.countryCode
    };
  }

  return (
    PROVIDER_FALLBACKS[providerSlug] || {
      name: fallbackName,
      slug: providerSlug
    }
  );
}

async function fetchLocationLaunchSplit(
  locationPatterns: string[]
): Promise<LaunchSplit> {
  if (!isSupabaseConfigured()) return { upcoming: [], recent: [] };

  const clause = buildLocationOrClause(locationPatterns);
  if (!clause) return { upcoming: [], recent: [] };

  return fetchLaunchSplit((supabase) =>
    supabase
      .from('launches_public_cache')
      .select('*')
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .or(clause)
  );
}

async function fetchStateLaunchSplit(stateCode: string): Promise<LaunchSplit> {
  if (!isSupabaseConfigured()) return { upcoming: [], recent: [] };

  return fetchLaunchSplit((supabase) =>
    supabase
      .from('launches_public_cache')
      .select('*')
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .or(buildPublicStateFilterOrClause(stateCode))
  );
}

const fetchMissionLandingSplit = cache(
  async (mission: SpaceXMissionKey): Promise<LaunchSplit> => {
    const clause = MISSION_LANDING_OR_FILTERS[mission];
    if (!clause || !isSupabaseConfigured()) {
      return { upcoming: [], recent: [] };
    }

    return fetchLaunchSplit(
      (supabase) =>
        supabase.from('launches_public_cache').select('*').or(clause),
      {
        upcomingLimit: MISSION_LANDING_QUERY_LIMIT,
        recentLimit: MISSION_LANDING_QUERY_LIMIT,
        filter: (launch) => getSpaceXMissionKeyFromLaunch(launch) === mission
      }
    );
  }
);

async function fetchLaunchSplit(
  buildQuery: (supabase: ReturnType<typeof createSupabasePublicClient>) => any,
  options: {
    upcomingLimit?: number;
    recentLimit?: number;
    filter?: (launch: Launch) => boolean;
  } = {}
): Promise<LaunchSplit> {
  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();
  const upcomingLimit = options.upcomingLimit ?? PAGE_UPCOMING_LIMIT + 1;
  const recentLimit = options.recentLimit ?? PAGE_RECENT_LIMIT;
  const filterLaunch = options.filter ?? (() => true);
  const [upcomingRes, recentRes] = await Promise.all([
    buildQuery(supabase)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(upcomingLimit),
    buildQuery(supabase)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(recentLimit)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('launch intent split query error', {
      upcoming: upcomingRes.error,
      recent: recentRes.error
    });
    return { upcoming: [], recent: [] };
  }

  return {
    upcoming: dedupeLaunches(
      (upcomingRes.data || []).map(mapPublicCacheRow).filter(filterLaunch)
    ),
    recent: dedupeLaunches(
      (recentRes.data || []).map(mapPublicCacheRow).filter(filterLaunch)
    )
  };
}

async function fetchTodayLaunches(nowMs: number) {
  if (!isSupabaseConfigured()) return [] as Launch[];

  const from = new Date(nowMs - NEXT_LAUNCH_RETENTION_MS).toISOString();
  const to = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
  const result = await loadPublicLaunchPage({
    from,
    to,
    location: null,
    state: null,
    pad: null,
    padId: null,
    provider: null,
    providerId: null,
    rocketId: null,
    status: null,
    sort: 'soonest',
    region: 'us',
    limit: 30,
    offset: 0
  });
  return result.launches;
}

function LaunchListSection({
  title,
  launches,
  emptyLabel
}: {
  title: string;
  launches: Launch[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">{title}</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {launches.length} items
        </span>
      </div>
      {launches.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {launches.map((launch) => (
            <li
              key={launch.id}
              className="rounded-xl border border-stroke bg-surface-0 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={buildLaunchHref(launch)}
                    className="text-sm font-semibold text-text1 hover:text-primary"
                  >
                    {launch.name}
                  </Link>
                  <div className="mt-1 text-xs text-text3">
                    {launch.provider} - {resolveVehicleLabel(launch)}
                  </div>
                </div>
                <div className="text-right text-xs text-text3">
                  <div>{formatLaunchDate(launch)}</div>
                  {isDateOnlyNet(launch.net, launch.netPrecision) ? (
                    <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                      Time TBD
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 text-xs text-text3">
                Launch site: {resolvePadLabel(launch)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function buildCollectionPageJsonLd({
  pageUrl,
  name,
  description,
  mainEntityId
}: {
  pageUrl: string;
  name: string;
  description: string;
  mainEntityId?: string;
}) {
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name,
    description,
    isPartOf: { '@id': `${siteUrl}#website` },
    publisher: { '@id': `${siteUrl}#organization` },
    ...(mainEntityId ? { mainEntity: { '@id': mainEntityId } } : {})
  };
}

function buildWebPageJsonLd({
  pageUrl,
  name,
  description,
  mainEntityId
}: {
  pageUrl: string;
  name: string;
  description: string;
  mainEntityId?: string;
}) {
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name,
    description,
    isPartOf: { '@id': `${siteUrl}#website` },
    publisher: { '@id': `${siteUrl}#organization` },
    ...(mainEntityId ? { mainEntity: { '@id': mainEntityId } } : {})
  };
}

function buildItemListJsonLd(pageUrl: string, launches: Launch[]) {
  if (launches.length === 0) return null;

  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${pageUrl}#upcoming-launches`,
    numberOfItems: Math.min(25, launches.length),
    itemListElement: launches.slice(0, 25).map((launch, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Event',
        name: launch.name,
        startDate: launch.net,
        url: `${siteUrl}${buildLaunchHref(launch)}`
      }
    }))
  };
}

function buildLaunchEventJsonLd(launch: Launch, pageUrl: string) {
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${pageUrl}#event`,
    name: launch.name,
    startDate: launch.net,
    eventStatus: resolveEventStatus(launch.status),
    url: `${siteUrl}${buildLaunchHref(launch)}`,
    location: {
      '@type': 'Place',
      name: launch.pad?.name || resolvePadLabel(launch),
      address: {
        '@type': 'PostalAddress',
        addressLocality: launch.pad?.locationName || undefined,
        addressRegion: launch.pad?.state || undefined,
        addressCountry: launch.pad?.countryCode || undefined
      }
    },
    organizer: launch.provider
      ? { '@type': 'Organization', name: launch.provider }
      : undefined
  };
}

function buildRelatedLinks(
  config: LaunchIntentLandingConfig,
  featuredLaunch: Launch | null
) {
  const links = [...config.relatedLinks];
  if (featuredLaunch) {
    const launchHref = buildLaunchHref(featuredLaunch);
    if (!links.some((link) => link.href === launchHref)) {
      links.unshift({
        href: launchHref,
        label: FEATURED_LAUNCH_RELATED_LINK_LABEL,
        detail: `Open the mission page for ${featuredLaunch.name}.`
      });
    }
  }
  return links;
}

function buildFeaturedSummary(launch: Launch, title: string) {
  const parts = [
    `${title} is currently led by ${launch.name}.`,
    `NET: ${formatLaunchDate(launch)}.`,
    `Launch site: ${resolvePadLabel(launch)}.`
  ];

  if (launch.statusText) {
    parts.push(`Status: ${launch.statusText}.`);
  }

  return parts.join(' ');
}

function buildLocationOrClause(patterns: string[]) {
  const clauses = new Set<string>();
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    const escaped = toContainsPattern(trimmed);
    clauses.add(`pad_location_name.ilike.${escaped}`);
    clauses.add(`pad_name.ilike.${escaped}`);
    clauses.add(`pad_short_code.ilike.${escaped}`);
  }
  return Array.from(clauses).join(',');
}

function toContainsPattern(value: string) {
  return `%${value.replace(/"/g, '\\"')}%`;
}

function dedupeLaunches(launches: Launch[]) {
  const seen = new Set<string>();
  return launches.filter((launch) => {
    if (seen.has(launch.id)) return false;
    seen.add(launch.id);
    return true;
  });
}

function resolvePadLabel(launch: Launch) {
  return launch.pad?.locationName || launch.pad?.name || launch.pad?.shortCode;
}

function resolveVehicleLabel(launch: Launch) {
  return launch.rocket?.fullName || launch.vehicle;
}

function resolveEventStatus(status: string | null | undefined) {
  if (status === 'scrubbed') return 'https://schema.org/EventCancelled';
  if (status === 'hold') return 'https://schema.org/EventPostponed';
  return 'https://schema.org/EventScheduled';
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const options: Intl.DateTimeFormatOptions = isDateOnlyNet(
    launch.net,
    launch.netPrecision
  )
    ? {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        timeZone: zone
      }
    : {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}
