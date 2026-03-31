import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { SpaceXJumpRail, type SpaceXHubSectionId } from '@/app/spacex/_components/SpaceXJumpRail';
import { SpaceXUsaspendingAwardsPanel } from '@/app/spacex/_components/SpaceXUsaspendingAwardsPanel';
import { SpaceXContractsSection } from '@/app/spacex/_components/hub/SpaceXContractsSection';
import { SpaceXFaqSection } from '@/app/spacex/_components/hub/SpaceXFaqSection';
import { SpaceXFinanceSection } from '@/app/spacex/_components/hub/SpaceXFinanceSection';
import { SpaceXFlightsSection } from '@/app/spacex/_components/hub/SpaceXFlightsSection';
import { SpaceXHardwareSection } from '@/app/spacex/_components/hub/SpaceXHardwareSection';
import { SpaceXHubHeader } from '@/app/spacex/_components/hub/SpaceXHubHeader';
import { SpaceXMediaSection } from '@/app/spacex/_components/hub/SpaceXMediaSection';
import { SpaceXMissionSection } from '@/app/spacex/_components/hub/SpaceXMissionSection';
import { SpaceXRecoverySection } from '@/app/spacex/_components/hub/SpaceXRecoverySection';
import { BRAND_NAME } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import { fetchProgramContractDiscoveryPage } from '@/lib/server/programContractDiscovery';
import { fetchSpaceXDroneShipsIndex } from '@/lib/server/spacexDroneShips';
import {
  fetchSpaceXContracts,
  fetchSpaceXEngines,
  fetchSpaceXFinanceSignals,
  fetchSpaceXFlights,
  fetchSpaceXTrackedFlightCount,
  fetchSpaceXPassengers,
  fetchSpaceXPayloads,
  fetchSpaceXProgramSnapshot,
  fetchSpaceXSocialPosts,
  fetchSpaceXVehicles
} from '@/lib/server/spacexProgram';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { fetchProgramUsaspendingAwardsPage } from '@/lib/server/usaspendingProgramAwards';
import {
  SPACEX_FALLBACK_TWEET_IDS,
  SPACEX_MISSION_ITEMS,
  buildMissionPulse,
  buildVideoArchive,
  formatUpdatedLabel,
  topUpEmbeddedPosts
} from '@/lib/utils/spacexHub';
import { resolveXPostId } from '@/lib/utils/xSocial';

export const revalidate = 60 * 10;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/spacex';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `SpaceX Program Hub, Missions, Flights & Contracts | ${BRAND_NAME}`;
  const description =
    'SpaceX program hub with Starship, Falcon, and Dragon mission pages, flights, recovery coverage, internal contract pages, passengers, and payloads.';

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [{ url: siteMeta.ogImage, width: 1200, height: 630, alt: SITE_META.ogImageAlt, type: 'image/jpeg' }]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default async function SpaceXProgramPage() {
  const discoveryPagePromise = fetchProgramContractDiscoveryPage('spacex', { limit: 8 }).catch((error) => {
    console.error('spacex discovery query error', error);
    return {
      items: [],
      total: 0,
      limit: 8,
      offset: 0,
      hasMore: false
    };
  });

  const [program, vehicles, engines, flights, trackedFlightsCount, contracts, passengers, payloads, finance, socialPosts, usaspendingAwardsPage, droneShips, discoveryPage] =
    await Promise.all([
      fetchSpaceXProgramSnapshot(),
      fetchSpaceXVehicles('all'),
      fetchSpaceXEngines('all'),
      fetchSpaceXFlights('all'),
      fetchSpaceXTrackedFlightCount(),
      fetchSpaceXContracts('all'),
      fetchSpaceXPassengers('all'),
      fetchSpaceXPayloads('all'),
      fetchSpaceXFinanceSignals(),
      fetchSpaceXSocialPosts(5),
      fetchProgramUsaspendingAwardsPage('spacex', { limit: 80, offset: 0 }),
      fetchSpaceXDroneShipsIndex(),
      discoveryPagePromise
    ]);

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/spacex`;
  const lastUpdated = formatUpdatedLabel(program.lastUpdated || program.generatedAt);
  const missionPulse = buildMissionPulse([...program.upcoming, ...program.recent]);
  const missionPulseMax = missionPulse.reduce((max, item) => Math.max(max, item.total), 0);
  const videoArchive = buildVideoArchive([...program.upcoming, ...program.recent], 8);
  const embeddedPosts = socialPosts
    .map((post) => ({
      id: post.id,
      tweetId: resolveXPostId(post.externalId, post.url),
      tweetUrl: post.url
    }))
    .filter((post): post is { id: string; tweetId: string; tweetUrl: string } => Boolean(post.tweetId && post.tweetUrl))
    .slice(0, 5);
  const embeddedPostsWithFallback = topUpEmbeddedPosts(
    embeddedPosts,
    SPACEX_FALLBACK_TWEET_IDS.map((tweetId) => ({
      id: `fallback:spacex:${tweetId}`,
      tweetId,
      tweetUrl: `https://x.com/SpaceX/status/${tweetId}`
    })),
    5
  );

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'SpaceX Program',
    description:
      'SpaceX program hub for mission pages, flights, recovery, contracts, and source-linked records.',
    dateModified: program.lastUpdated || program.generatedAt
  };

  const navCounts: Record<SpaceXHubSectionId, number> = {
    mission: SPACEX_MISSION_ITEMS.length,
    recovery: droneShips.items.length,
    hardware: vehicles.items.length + engines.items.length,
    media: embeddedPostsWithFallback.length + videoArchive.length,
    flights: trackedFlightsCount,
    contracts: contracts.items.length,
    finance: finance.items.length,
    faq: program.faq.length
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-8 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd]} />

      <div className="hidden w-52 flex-shrink-0 md:block">
        <SpaceXJumpRail counts={navCounts} variant="desktop" />
      </div>

      <div className="flex flex-grow flex-col gap-6">
        <SpaceXJumpRail counts={navCounts} variant="mobile" />

        <SpaceXHubHeader
          lastUpdated={lastUpdated}
          flightsCount={trackedFlightsCount}
          vehiclesCount={vehicles.items.length}
          enginesCount={engines.items.length}
          passengersCount={passengers.items.length}
          payloadsCount={payloads.items.length}
          contractsCount={contracts.items.length}
          droneShipCoveragePercent={droneShips.coverage.coveragePercent}
          usaspendingRows={usaspendingAwardsPage.total ?? usaspendingAwardsPage.items.length}
        />

        <SpaceXMissionSection
          missionPulse={missionPulse}
          missionPulseMax={missionPulseMax}
          upcomingCount={program.upcoming.length}
          recentCount={program.recent.length}
          passengersCount={passengers.items.length}
          payloadsCount={payloads.items.length}
          contractsCount={contracts.items.length}
        />

        <SpaceXRecoverySection droneShips={droneShips} />

        <SpaceXHardwareSection vehicles={vehicles.items} engines={engines.items} />

        <SpaceXMediaSection embeddedPosts={embeddedPostsWithFallback} videoArchive={videoArchive} />

        <SpaceXFlightsSection flights={flights.items} upcoming={program.upcoming} recent={program.recent} />

        <SpaceXContractsSection contracts={contracts.items} discoveryItems={discoveryPage.items} />

        <SpaceXUsaspendingAwardsPanel
          initialItems={usaspendingAwardsPage.items}
          initialTotal={usaspendingAwardsPage.total}
          initialHasMore={usaspendingAwardsPage.hasMore}
        />

        <SpaceXFinanceSection finance={finance} />

        <SpaceXFaqSection faqItems={program.faq} />
      </div>
    </div>
  );
}
