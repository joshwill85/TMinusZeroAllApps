import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { JsonLd } from '@/components/JsonLd';
import { XTweetEmbed } from '@/components/XTweetEmbed';
import { ArtemisMissionControl } from '@/components/artemis/dashboard';
import type { ArtemisMissionWorkbenchCard } from '@/components/artemis/dashboard';
import type { ArtemisWorkbenchMission } from '@/components/artemis/ArtemisProgramWorkbenchDesktop';
import { resolveArtemisWorkbenchFaq } from '@/lib/content/faq/resolvers';
import { getSiteUrl } from '@/lib/server/env';
import { buildArtemisFaq, fetchArtemisIISnapshot, fetchArtemisProgramSnapshot } from '@/lib/server/artemis';
import { fetchArtemisContentViewModel } from '@/lib/server/artemisContent';
import { getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import { fetchArtemisProgramIntel } from '@/lib/server/artemisProgramIntel';
import { fetchArtemisMissionComponents, fetchArtemisPeople } from '@/lib/server/artemisMissionSections';
import {
  fetchArtemisTimelineViewModel,
  parseArtemisAudienceMode,
  parseArtemisDashboardView,
  parseArtemisMissionFilter,
  parseArtemisSourceClassFilter,
  parseArtemisSourceFilter,
  parseBooleanParam,
  parseIsoDateParam
} from '@/lib/server/artemisUi';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { BRAND_NAME } from '@/lib/brand';
import type { Launch } from '@/lib/types/launch';
import { hasPresentSearchParams, readSearchParam, type RouteSearchParams } from '@/lib/utils/searchParams';
import type {
  ArtemisContentKind,
  ArtemisDashboardView,
  ArtemisMissionHubKey,
  ArtemisMissionSnapshot,
  ArtemisProgramSnapshot,
  ArtemisTimelineEvent as ArtemisServerTimelineEvent,
  ArtemisTimelineMissionFilter
} from '@/lib/types/artemis';
import { ARTEMIS_MISSION_HUB_KEYS } from '@/lib/types/artemis';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { getArtemisMissionKeyFromLaunch } from '@/lib/utils/artemis';
import { resolveXPostId } from '@/lib/utils/xSocial';
import type {
  ArtemisTimelineEvent as ArtemisWorkbenchTimelineEvent,
  ArtemisTimelineFilters
} from '@/components/artemis/ArtemisTimelineExplorer';

export const revalidate = 60 * 10; // 10 minutes

const CONTENT_PANEL_LIMIT = 8;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

type ArtemisMissionKey = ArtemisMissionHubKey;

type SearchParams = RouteSearchParams;

const LEGACY_TIMELINE_KEYS = [
  'mode',
  'mission',
  'event',
  'sourceType',
  'sourceClass',
  'includeSuperseded',
  'from',
  'to'
] as const;

const MISSION_WORKBENCH: ReadonlyArray<ArtemisMissionWorkbenchCard> = ARTEMIS_MISSION_HUB_KEYS.map((key) => {
  const profile = getArtemisMissionProfileDefault(key);
  return {
    key,
    mission: profile.missionName,
    href: profile.hubHref,
    status: formatMissionStatus(profile.status),
    summary: profile.summary,
    detail: profile.detail
  };
});

const ARTEMIS_FALLBACK_TWEET_IDS = [
  '2024988492799865343',
  '2024264543648494060',
  '2024153660683399394',
  '2022330437142503506',
  '2021956309919150187'
] as const;

export async function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis Mission Control Dashboard & Launch Schedule | ${BRAND_NAME}`;
  const description =
    'Artemis mission control dashboard with timeline exploration, intelligence, budget context, awardee detail pages, and mission routing across Artemis I through Artemis VII.';
  const images = [
    {
      url: siteMeta.ogImage,
      width: 1200,
      height: 630,
      alt: SITE_META.ogImageAlt,
      type: 'image/jpeg'
    }
  ];

  return {
    title,
    description,
    alternates: { canonical },
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined,
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: siteMeta.ogImage,
          alt: SITE_META.ogImageAlt
        }
      ]
    }
  };
}

export default async function ArtemisWorkbenchPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const mode = parseArtemisAudienceMode(readSearchParam(searchParams, 'mode')) ?? 'quick';
  const parsedMissionFilter = parseArtemisMissionFilter(readSearchParam(searchParams, 'mission'));
  const missionFilter: ArtemisTimelineMissionFilter = parsedMissionFilter ?? (mode === 'explorer' ? 'artemis-ii' : 'all');
  const sourceType = parseArtemisSourceFilter(readSearchParam(searchParams, 'sourceType')) ?? 'all';
  const sourceClass = parseArtemisSourceClassFilter(readSearchParam(searchParams, 'sourceClass')) ?? 'all';
  const includeSuperseded =
    parseBooleanParam(readSearchParam(searchParams, 'includeSuperseded'), mode === 'technical') ?? mode === 'technical';

  const parsedFrom = parseIsoDateParam(readSearchParam(searchParams, 'from'));
  const parsedTo = parseIsoDateParam(readSearchParam(searchParams, 'to'));
  const from = parsedFrom === 'invalid' ? null : parsedFrom;
  const to = parsedTo === 'invalid' ? null : parsedTo;
  const isRangeOrdered = !(from && to && from > to);
  const effectiveFrom = isRangeOrdered ? from : null;
  const effectiveTo = isRangeOrdered ? to : null;
  const requestedEventId = readSearchParam(searchParams, 'event');

  const parsedView = parseArtemisDashboardView(readSearchParam(searchParams, 'view'));
  const hasLegacyTimelineParams = LEGACY_TIMELINE_KEYS.some((key) => readSearchParam(searchParams, key) !== null);
  const initialView: ArtemisDashboardView = parsedView ?? (hasLegacyTimelineParams ? 'timeline' : 'overview');

  const [
    snapshot,
    artemisIISnapshot,
    artemisIICrewProfiles,
    artemisIIMissionPieces,
    programIntel,
    timelineViewModel,
    articleContent,
    photoContent,
    socialContent,
    dataContent
  ] = await Promise.all([
    fetchArtemisProgramSnapshot(),
    fetchArtemisIISnapshot(),
    fetchArtemisPeople('artemis-ii'),
    fetchArtemisMissionComponents('artemis-ii'),
    fetchArtemisProgramIntel(),
    fetchArtemisTimelineViewModel({
      mode,
      mission: missionFilter,
      sourceType,
      sourceClass,
      includeSuperseded,
      from: effectiveFrom,
      to: effectiveTo,
      cursor: null,
      limit: 100
    }),
    fetchArtemisContentViewModel({
      mission: 'all',
      kind: 'article',
      tier: 'all',
      cursor: null,
      limit: CONTENT_PANEL_LIMIT
    }),
    fetchArtemisContentViewModel({
      mission: 'all',
      kind: 'photo',
      tier: 'all',
      cursor: null,
      limit: CONTENT_PANEL_LIMIT
    }),
    fetchArtemisContentViewModel({
      mission: 'all',
      kind: 'social',
      tier: 'all',
      cursor: null,
      limit: CONTENT_PANEL_LIMIT
    }),
    fetchArtemisContentViewModel({
      mission: 'all',
      kind: 'data',
      tier: 'all',
      cursor: null,
      limit: CONTENT_PANEL_LIMIT
    })
  ]);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/artemis`;
  const missionLaunches = buildMissionLaunchMap(snapshot.upcoming, snapshot.recent);
  const workbenchMissions = buildWorkbenchMissions(snapshot, artemisIISnapshot);
  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
  const timelineEvents = timelineViewModel.events.map(mapTimelineEventToWorkbenchEvent);
  const defaultMissionId = resolveDefaultMissionId(missionFilter);
  const defaultSelectedEventId = resolveDefaultSelectedEventId(requestedEventId, timelineEvents);
  const articleItems = articleContent.items.slice(0, CONTENT_PANEL_LIMIT);
  const photoItems = photoContent.items.slice(0, CONTENT_PANEL_LIMIT);
  const socialItems = socialContent.items.slice(0, CONTENT_PANEL_LIMIT);
  const dataItems = dataContent.items.slice(0, CONTENT_PANEL_LIMIT);
  const embeddedSocialPosts = socialItems
    .flatMap((item) => {
      const platform = (item.platform || '').trim().toLowerCase();
      if (platform && platform !== 'x' && platform !== 'twitter') return [];
      const tweetId = resolveXPostId(item.externalId, item.url);
      if (!tweetId) return [];
      return [{ id: item.id, tweetId, tweetUrl: item.url }];
    })
    .filter((item, index, array) => array.findIndex((entry) => entry.tweetId === item.tweetId) === index)
    .slice(0, 5);
  const embeddedSocialPostsWithFallback = topUpEmbeddedPosts(
    embeddedSocialPosts,
    ARTEMIS_FALLBACK_TWEET_IDS.map((tweetId) => ({
      id: `fallback:nasaartemis:${tweetId}`,
      tweetId,
      tweetUrl: `https://x.com/NASAArtemis/status/${tweetId}`
    })),
    5
  );
  const featuredAstronaut = artemisIICrewProfiles[0] ?? null;
  const supportingCrew = artemisIICrewProfiles.slice(featuredAstronaut ? 1 : 0, 4);
  const featuredMissionPieces = artemisIIMissionPieces.slice(0, 4);
  const initialFilters: ArtemisTimelineFilters = {
    sourceType,
    includeSuperseded,
    from: effectiveFrom,
    to: effectiveTo
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'Artemis mission control dashboard',
    description:
      'Artemis mission control dashboard with timeline exploration, intelligence, budget transparency, awardee discovery, and mission route hubs.',
    dateModified: snapshot.lastUpdated || snapshot.generatedAt
  };

  const missionWorkbenchJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${pageUrl}#mission-workbench`,
    itemListElement: MISSION_WORKBENCH.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${siteUrl}${entry.href}`,
      name: entry.mission
    }))
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: snapshot.faq.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
    }))
  };

  const itemListJsonLd =
    snapshot.upcoming.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-artemis-launches`,
          numberOfItems: Math.min(25, snapshot.upcoming.length),
          itemListElement: snapshot.upcoming.slice(0, 25).map((launch, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'Event',
              name: launch.name,
              startDate: launch.net,
              url: `${siteUrl}${buildLaunchHref(launch)}`
            }
          }))
        }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, missionWorkbenchJsonLd, faqJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-lg font-semibold text-text1">Artemis Search Hubs</h2>
        <p className="mt-1 text-sm text-text2">
          Use mission hubs for timeline coverage and the awardee index for recipient-level procurement context.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
          <Link
            href="/artemis/awardees"
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:border-primary/60 hover:text-text1"
          >
            Awardee Index
          </Link>
          <Link
            href="/artemis/contracts"
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:border-primary/60 hover:text-text1"
          >
            Contracts
          </Link>
          <Link
            href="/artemis/content"
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:border-primary/60 hover:text-text1"
          >
            Content Feed
          </Link>
          <Link
            href="/spacex"
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:border-primary/60 hover:text-text1"
          >
            SpaceX Program
          </Link>
          <Link
            href="/blue-origin"
            className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:border-primary/60 hover:text-text1"
          >
            Blue Origin Program
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-text1">Artemis II astronauts</h2>
            <Link href="/artemis-ii#astronauts" className="text-xs text-primary hover:text-primary/80">
              View bios
            </Link>
          </div>
          {featuredAstronaut ? (
            <div className="mt-3 space-y-3">
              <article className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start gap-3">
                  {featuredAstronaut.portraitUrl ? (
                    <Image
                      src={featuredAstronaut.portraitUrl}
                      alt={featuredAstronaut.name}
                      width={84}
                      height={84}
                      className="h-[84px] w-[84px] rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-[84px] w-[84px] items-center justify-center rounded-lg border border-stroke text-[10px] uppercase tracking-[0.08em] text-text3">
                      Crew
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text1">{featuredAstronaut.name}</p>
                    <p className="text-xs text-text3">
                      {featuredAstronaut.role || 'Crew'} • {featuredAstronaut.agency}
                    </p>
                    {featuredAstronaut.summary ? (
                      <p className="mt-2 text-xs text-text2">{truncateText(featuredAstronaut.summary, 160)}</p>
                    ) : null}
                  </div>
                </div>
              </article>

              {supportingCrew.length ? (
                <ul className="space-y-2 text-sm text-text2">
                  {supportingCrew.map((person) => (
                    <li key={person.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                      <span className="font-semibold text-text1">{person.name}</span>
                      <span className="text-text3"> • {person.role || 'Crew'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-text2">Crew biographies will appear once the weekly official-source job runs.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-text1">Artemis II mission pieces</h2>
            <Link href="/artemis-ii#mission-pieces" className="text-xs text-primary hover:text-primary/80">
              View details
            </Link>
          </div>
          {featuredMissionPieces.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {featuredMissionPieces.map((component) => (
                <li key={component.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <p className="font-semibold text-text1">{component.component}</p>
                  {component.description ? <p className="mt-1 text-xs text-text2">{truncateText(component.description, 170)}</p> : null}
                  {component.officialUrls[0] ? (
                    <a href={component.officialUrls[0]} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:text-primary/80">
                      Official source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">Mission components will appear once the weekly official-source job runs.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Latest Artemis posts (X)</h2>
          <a href="https://x.com/NASAArtemis" target="_blank" rel="noreferrer" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            Official feed
          </a>
        </div>
        {embeddedSocialPostsWithFallback.length ? (
          <ul className="mt-3 space-y-3">
            {embeddedSocialPostsWithFallback.map((post) => (
              <li key={post.id} className="overflow-hidden rounded-xl border border-stroke bg-surface-0 p-2">
                <XTweetEmbed tweetId={post.tweetId} tweetUrl={post.tweetUrl} theme="dark" conversation="none" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No embedded Artemis X posts are currently available.</p>
        )}
      </section>

      <ArtemisMissionControl
        initialView={initialView}
        lastUpdatedLabel={lastUpdatedLabel}
        programSnapshot={snapshot}
        missions={workbenchMissions}
        missionCards={MISSION_WORKBENCH}
        missionLaunches={missionLaunches}
        missionProgress={timelineViewModel.missionProgress}
        timelineEvents={timelineEvents}
        timelineInitialState={{
          mode,
          defaultMissionId,
          defaultSelectedEventId,
          initialFilters
        }}
        programIntel={programIntel}
        articleItems={articleItems}
        photoItems={photoItems}
        socialItems={socialItems}
        dataItems={dataItems}
      />
    </div>
  );
}

function truncateText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function formatUpdatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function buildMissionLaunchMap(upcoming: Launch[], recent: Launch[]) {
  const missionMap = Object.fromEntries(
    ARTEMIS_MISSION_HUB_KEYS.map((missionKey) => [missionKey, null])
  ) as Record<ArtemisMissionKey, Launch | null>;

  for (const launch of upcoming) {
    const key = resolveMissionKey(launch);
    if (!key || missionMap[key]) continue;
    missionMap[key] = launch;
  }

  for (const launch of recent) {
    const key = resolveMissionKey(launch);
    if (!key || missionMap[key]) continue;
    missionMap[key] = launch;
  }

  return missionMap;
}

function resolveMissionKey(launch: Launch): ArtemisMissionKey | null {
  const missionKey = getArtemisMissionKeyFromLaunch(launch);
  if (!missionKey) return null;
  if (!ARTEMIS_MISSION_HUB_KEYS.includes(missionKey as ArtemisMissionKey)) return null;
  return missionKey as ArtemisMissionKey;
}

function buildWorkbenchMissions(programSnapshot: ArtemisProgramSnapshot, artemisIISnapshot: ArtemisMissionSnapshot): ArtemisWorkbenchMission[] {
  return ARTEMIS_MISSION_HUB_KEYS.map((missionKey) => {
    const profile = getArtemisMissionProfileDefault(missionKey);
    const snapshot =
      missionKey === 'artemis-ii'
        ? artemisIISnapshot
        : buildDerivedMissionSnapshot({
            programSnapshot,
            missionName: profile.missionName,
            matcher: (launch) => resolveMissionKey(launch) === missionKey,
            faq: resolveWorkbenchFaq(missionKey)
          });

    return {
      id: missionKey,
      label: profile.shortLabel,
      subtitle: profile.summary,
      status: formatMissionStatus(profile.status),
      snapshot
    };
  });
}

function resolveWorkbenchFaq(missionKey: ArtemisMissionKey) {
  if (missionKey === 'artemis-i') return resolveArtemisWorkbenchFaq('artemis-i');
  if (missionKey === 'artemis-iii') return resolveArtemisWorkbenchFaq('artemis-iii');
  return buildArtemisFaq('program');
}

function formatMissionStatus(status: ReturnType<typeof getArtemisMissionProfileDefault>['status']) {
  if (status === 'completed') return 'Completed';
  if (status === 'in-preparation') return 'In preparation';
  return 'Planned';
}

function topUpEmbeddedPosts(
  primary: Array<{ id: string; tweetId: string; tweetUrl: string }>,
  fallback: Array<{ id: string; tweetId: string; tweetUrl: string }>,
  limit: number
) {
  const byTweet = new Map<string, { id: string; tweetId: string; tweetUrl: string }>();
  for (const row of [...primary, ...fallback]) {
    if (!row.tweetId || !row.tweetUrl) continue;
    if (!byTweet.has(row.tweetId)) byTweet.set(row.tweetId, row);
    if (byTweet.size >= limit) break;
  }
  return [...byTweet.values()].slice(0, limit);
}

function buildDerivedMissionSnapshot({
  programSnapshot,
  missionName,
  matcher,
  faq
}: {
  programSnapshot: ArtemisProgramSnapshot;
  missionName: string;
  matcher: (launch: Launch) => boolean;
  faq: ReadonlyArray<{ question: string; answer: string }>;
}): ArtemisMissionSnapshot {
  const upcoming = programSnapshot.upcoming.filter(matcher);
  const recent = programSnapshot.recent.filter(matcher);
  const all = dedupeLaunches([...upcoming, ...recent]);
  const nextLaunch = upcoming[0] || null;
  const latest = resolveLatestIso(all) || programSnapshot.lastUpdated || programSnapshot.generatedAt;

  return {
    generatedAt: programSnapshot.generatedAt,
    lastUpdated: latest,
    missionName,
    nextLaunch,
    upcoming,
    recent,
    crewHighlights: nextLaunch ? buildCrewHighlights(nextLaunch) : [],
    changes: buildMissionChanges(all),
    faq: [...faq]
  };
}

function dedupeLaunches(launches: Launch[]) {
  const seen = new Set<string>();
  const deduped: Launch[] = [];
  for (const launch of launches) {
    if (seen.has(launch.id)) continue;
    seen.add(launch.id);
    deduped.push(launch);
  }
  return deduped;
}

function buildCrewHighlights(launch: Launch) {
  if (!Array.isArray(launch.crew)) return [];
  return launch.crew
    .map((entry) => {
      const astronaut = entry?.astronaut?.trim();
      const role = entry?.role?.trim();
      if (!astronaut) return null;
      return role ? `${astronaut} (${role})` : astronaut;
    })
    .filter(Boolean)
    .slice(0, 6) as string[];
}

function buildMissionChanges(launches: Launch[]) {
  const changes = launches
    .map((launch) => {
      const date = resolveLaunchIso(launch);
      if (!date) return null;
      return {
        title: launch.name,
        summary: `Status: ${launch.statusText || launch.status || 'Status pending'}. NET: ${formatLaunchDate(launch)}.`,
        date,
        href: buildLaunchHref(launch)
      };
    })
    .filter(Boolean) as ArtemisMissionSnapshot['changes'];

  changes.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return changes.slice(0, 12);
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  }).format(date);
}

function resolveLatestIso(launches: Launch[]) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = launches
    .map((launch) => resolveLaunchIso(launch))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });
  if (!candidates.length) return null;
  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function resolveLaunchIso(launch: Launch) {
  const values = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function resolveDefaultMissionId(mission: ArtemisTimelineMissionFilter): ArtemisMissionKey {
  if (mission === 'artemis-i') return 'artemis-i';
  if (mission === 'artemis-ii') return 'artemis-ii';
  if (mission === 'artemis-iii') return 'artemis-iii';
  if (mission === 'artemis-iv') return 'artemis-iv';
  if (mission === 'artemis-v') return 'artemis-v';
  if (mission === 'artemis-vi') return 'artemis-vi';
  if (mission === 'artemis-vii') return 'artemis-vii';
  return 'artemis-ii';
}

function resolveDefaultSelectedEventId(requestedEventId: string | null, events: ArtemisWorkbenchTimelineEvent[]) {
  if (requestedEventId && events.some((event) => event.id === requestedEventId)) {
    return requestedEventId;
  }
  return events[0]?.id ?? null;
}

function mapTimelineEventToWorkbenchEvent(event: ArtemisServerTimelineEvent): ArtemisWorkbenchTimelineEvent {
  return {
    id: event.id,
    title: event.title,
    when: event.date,
    summary: event.summary,
    mission: formatTimelineMission(event.mission),
    tone: toneFromTimelineStatus(event.status),
    launch: event.launch || null,
    status: event.status,
    eventTime: event.date,
    announcedTime: event.source.lastVerifiedAt || event.date,
    sourceType: event.source.type,
    sourceLabel: event.source.label,
    sourceHref: event.source.href,
    confidence: event.confidence,
    supersedes: event.supersedes.map((entry) => ({ eventId: entry.eventId, reason: entry.reason })),
    supersededBy: event.supersededBy ? { eventId: event.supersededBy.eventId, reason: event.supersededBy.reason } : null
  };
}

function toneFromTimelineStatus(status: ArtemisServerTimelineEvent['status']): ArtemisWorkbenchTimelineEvent['tone'] {
  if (status === 'completed') return 'success';
  if (status === 'upcoming') return 'info';
  if (status === 'tentative') return 'warning';
  if (status === 'superseded') return 'danger';
  return 'default';
}

function formatTimelineMission(mission: ArtemisServerTimelineEvent['mission']) {
  if (mission === 'artemis-i') return 'Artemis I';
  if (mission === 'artemis-ii') return 'Artemis II';
  if (mission === 'artemis-iii') return 'Artemis III';
  if (mission === 'artemis-iv') return 'Artemis IV';
  if (mission === 'artemis-v') return 'Artemis V';
  if (mission === 'artemis-vi') return 'Artemis VI';
  if (mission === 'artemis-vii') return 'Artemis VII';
  return 'Artemis Program';
}
