import Link from 'next/link';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { TimeDisplay } from '@/components/TimeDisplay';
import { ArtemisMissionIntelPanels } from '@/components/artemis/ArtemisMissionIntelPanels';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchArtemisMissionHubData } from '@/lib/server/artemisMissionHub';
import type { ArtemisMissionHubKey } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

type ArtemisPlannedMissionPageProps = {
  missionKey: ArtemisMissionHubKey;
  heading: string;
  canonicalPath: string;
  snapshotText: string;
  missionStatusLabel?: string;
};

export async function ArtemisPlannedMissionPage({
  missionKey,
  heading,
  canonicalPath,
  snapshotText,
  missionStatusLabel = 'Planned'
}: ArtemisPlannedMissionPageProps) {
  const mission = await fetchArtemisMissionHubData(missionKey);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const nextLaunch = mission.nextLaunch;
  const featuredLaunch = nextLaunch || mission.recent[0] || null;
  const lastUpdatedLabel = formatUpdatedLabel(mission.lastUpdated || mission.generatedAt);
  const launchHref = featuredLaunch ? buildLaunchHref(featuredLaunch) : null;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: heading, item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: mission.missionName,
    description: `${mission.missionName} mission schedule signals, timeline updates, and planning context.`,
    dateModified: mission.lastUpdated || mission.generatedAt
  };

  const eventJsonLd =
    featuredLaunch != null
      ? {
          '@context': 'https://schema.org',
          '@type': 'Event',
          '@id': `${pageUrl}#tracked-event`,
          name: featuredLaunch.name,
          startDate: featuredLaunch.net,
          eventStatus:
            featuredLaunch.status === 'scrubbed'
              ? 'https://schema.org/EventCancelled'
              : featuredLaunch.status === 'hold'
                ? 'https://schema.org/EventPostponed'
                : 'https://schema.org/EventScheduled',
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
          organizer: featuredLaunch.provider
            ? { '@type': 'Organization', name: featuredLaunch.provider }
            : undefined,
          url: launchHref ? `${siteUrl}${launchHref}` : pageUrl
        }
      : null;

  const upcomingJsonLd =
    mission.upcoming.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-launches`,
          numberOfItems: Math.min(25, mission.upcoming.length),
          itemListElement: mission.upcoming.slice(0, 25).map((launch, index) => ({
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
    mainEntity: mission.faq.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd
        data={[
          breadcrumbJsonLd,
          collectionPageJsonLd,
          ...(eventJsonLd ? [eventJsonLd] : []),
          ...(upcomingJsonLd ? [upcomingJsonLd] : []),
          faqJsonLd
        ]}
      />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
        <h1 className="text-3xl font-semibold text-text1">{heading}</h1>
        <p className="max-w-3xl text-sm text-text2">
          Mission-focused coverage for {heading}, including timeline evidence, launch tracking, and related Artemis program updates.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Last updated: {lastUpdatedLabel}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Coverage: news {mission.news.length} • social {mission.social.length}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Mission status: {missionStatusLabel}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission snapshot</h2>
        <p className="mt-2 text-sm text-text2">{snapshotText}</p>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
        {featuredLaunch ? (
          <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={buildLaunchHref(featuredLaunch)}
                  className="text-sm font-semibold text-text1 hover:text-primary"
                >
                  {featuredLaunch.name}
                </Link>
                <p className="mt-1 text-xs text-text3">
                  {featuredLaunch.provider} • {featuredLaunch.vehicle} • {formatPadLabel(featuredLaunch)}
                </p>
              </div>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                Status: {featuredLaunch.statusText}
              </span>
            </div>
            {nextLaunch && !isDateOnlyNet(nextLaunch.net, nextLaunch.netPrecision) ? (
              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
                <Countdown net={nextLaunch.net} />
              </div>
            ) : null}
            <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">
            No launch window is currently available in the feed for this mission route.
          </p>
        )}
      </section>

      <ArtemisMissionIntelPanels
        missionLabel={mission.missionName}
        evidenceLinks={mission.evidenceLinks}
        news={mission.news}
        social={mission.social}
        coverage={mission.coverage}
      />

      <LaunchList
        title={`Upcoming ${mission.missionName} launches`}
        launches={mission.upcoming}
        emptyLabel={`No upcoming ${mission.missionName} launches are currently listed.`}
      />
      <LaunchList
        title={`Recent ${mission.missionName} launches`}
        launches={mission.recent}
        emptyLabel={`No recent ${mission.missionName} launches are currently listed.`}
      />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">{mission.missionName} FAQ</h2>
        <dl className="mt-4 space-y-4">
          {mission.faq.map((entry) => (
            <div key={entry.question}>
              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link
          href="/artemis"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Artemis Workbench
        </Link>
        <Link
          href="/artemis-ii"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Artemis II Hub
        </Link>
        <Link
          href="/artemis-iii"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Artemis III Hub
        </Link>
        <Link
          href="/spacex"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          SpaceX Program
        </Link>
      </div>
    </div>
  );
}

function LaunchList({
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
          {launches.map((launch) => {
            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
            return (
              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                      {launch.name}
                    </Link>
                    <p className="mt-1 text-xs text-text3">
                      {launch.provider} • {formatPadLabel(launch)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{formatLaunchDate(launch)}</div>
                    {dateOnly ? (
                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                        Time TBD
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
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
