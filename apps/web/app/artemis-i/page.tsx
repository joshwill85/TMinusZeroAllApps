import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { TimeDisplay } from '@/components/TimeDisplay';
import { ArtemisMissionIntelPanels } from '@/components/artemis/ArtemisMissionIntelPanels';
import { BRAND_NAME } from '@/lib/brand';
import { resolveArtemisMissionPageFaq } from '@/lib/content/faq/resolvers';
import { getSiteUrl } from '@/lib/server/env';
import { fetchArtemisMissionHubData } from '@/lib/server/artemisMissionHub';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const dynamic = 'force-dynamic';
export const revalidate = 60 * 5; // 5 minutes

const ARTEMIS_I_FAQ = resolveArtemisMissionPageFaq('artemis-i');

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis-i';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis I (Artemis 1) Mission Recap & Timeline | ${BRAND_NAME}`;
  const description = 'Artemis I mission recap with timeline context, tracked launch entries, and links to ongoing Artemis mission coverage.';
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

export default async function ArtemisIMissionPage() {
  const mission = await fetchArtemisMissionHubData('artemis-i');
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/artemis-i`;
  const launches = dedupeLaunches([...mission.upcoming, ...mission.recent]);
  const featuredLaunch = launches[0] || null;
  const lastUpdatedLabel = formatUpdatedLabel(mission.lastUpdated || mission.generatedAt);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Artemis I', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: mission.missionName,
    description: 'Artemis I mission context and tracked launch timeline.',
    dateModified: mission.lastUpdated || mission.generatedAt
  };

  const eventJsonLd =
    featuredLaunch != null
      ? {
          '@context': 'https://schema.org',
          '@type': 'Event',
          '@id': `${pageUrl}#mission-event`,
          name: featuredLaunch.name,
          startDate: featuredLaunch.net,
          eventStatus: mapEventStatus(featuredLaunch),
          location: {
            '@type': 'Place',
            name: featuredLaunch.pad?.name,
            address: {
              '@type': 'PostalAddress',
              addressLocality: featuredLaunch.pad?.locationName || undefined,
              addressRegion: featuredLaunch.pad?.state || undefined,
              addressCountry: featuredLaunch.pad?.countryCode || undefined
            }
          },
          organizer: featuredLaunch.provider ? { '@type': 'Organization', name: featuredLaunch.provider } : undefined,
          url: `${siteUrl}${buildLaunchHref(featuredLaunch)}`
        }
      : null;

  const itemListJsonLd =
    launches.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#tracked-launches`,
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
        }
      : null;

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: ARTEMIS_I_FAQ.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : []), ...(itemListJsonLd ? [itemListJsonLd] : []), faqJsonLd]} />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
        <h1 className="text-3xl font-semibold text-text1">Artemis I (Artemis 1)</h1>
        <p className="max-w-3xl text-sm text-text2">
          Artemis I was the uncrewed lunar test mission that opened NASA&apos;s Artemis era. This route provides mission recap context and launch timeline references while current planning focus shifts to Artemis II and Artemis III.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Coverage: news {mission.news.length} • social {mission.social.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Mission status: Completed</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission snapshot</h2>
        <p className="mt-2 text-sm text-text2">
          Artemis I validated the SLS-Orion stack through a lunar flight profile and recovery sequence, providing data used to progress crewed Artemis objectives.
        </p>
        {featuredLaunch ? (
          <div className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-text3">Tracked launch record</p>
            <Link href={buildLaunchHref(featuredLaunch)} className="mt-2 inline-block text-sm font-semibold text-text1 hover:text-primary">
              {featuredLaunch.name}
            </Link>
            <p className="mt-1 text-xs text-text3">
              {featuredLaunch.provider} - {featuredLaunch.vehicle}
            </p>
            <div className="mt-2">
              <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No Artemis I launch record is currently present in the feed snapshot.</p>
        )}
      </section>

      <ArtemisMissionIntelPanels
        missionLabel={mission.missionName}
        evidenceLinks={mission.evidenceLinks}
        news={mission.news}
        social={mission.social}
        coverage={mission.coverage}
      />

      <LaunchList title="Artemis I launch timeline entries" launches={launches} emptyLabel="No Artemis I entries are currently present in the mission feed snapshot." />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Artemis I FAQ</h2>
        <dl className="mt-4 space-y-4">
          {ARTEMIS_I_FAQ.map((entry) => (
            <div key={entry.question}>
              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Workbench
        </Link>
        <Link href="/artemis-ii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis II Hub
        </Link>
        <Link href="/artemis-iii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis III Hub
        </Link>
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
      </div>
    </div>
  );
}

function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">{title}</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{launches.length} items</span>
      </div>

      {launches.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {launches.map((launch) => (
            <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                    {launch.name}
                  </Link>
                  <p className="mt-1 text-xs text-text3">
                    {launch.provider} - {formatPadLabel(launch)}
                  </p>
                </div>
                <div className="text-right text-xs text-text3">
                  <div>{formatLaunchDate(launch)}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

function mapEventStatus(launch: Launch) {
  if (launch.status === 'scrubbed') return 'https://schema.org/EventCancelled';
  if (launch.status === 'hold') return 'https://schema.org/EventPostponed';
  const startMs = Date.parse(launch.net);
  if (Number.isFinite(startMs) && startMs < Date.now()) return 'https://schema.org/EventCompleted';
  return 'https://schema.org/EventScheduled';
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const options: Intl.DateTimeFormatOptions = {
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

function formatPadLabel(launch: Launch) {
  return launch.pad?.shortCode || launch.pad?.name || 'Pad TBD';
}
