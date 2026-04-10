import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { TimeDisplay } from '@/components/TimeDisplay';
import { ArtemisMissionIntelPanels } from '@/components/artemis/ArtemisMissionIntelPanels';
import { BRAND_NAME } from '@/lib/brand';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchArtemisMissionHubData } from '@/lib/server/artemisMissionHub';
import { fetchArtemisMissionComponents, fetchArtemisPeople } from '@/lib/server/artemisMissionSections';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const dynamic = 'force-dynamic';
export const revalidate = 60 * 5; // 5 minutes

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/artemis-ii';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Artemis II (Artemis 2) Launch Schedule & Countdown | ${BRAND_NAME}`;
  const description = 'Artemis II (Artemis 2) launch date, countdown, mission updates, crew details, and watch links.';
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

export default async function ArtemisIIMissionPage() {
  const [mission, crewProfiles, missionComponents] = await Promise.all([
    fetchArtemisMissionHubData('artemis-ii'),
    fetchArtemisPeople('artemis-ii'),
    fetchArtemisMissionComponents('artemis-ii')
  ]);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/artemis-ii`;
  const nextLaunch = mission.nextLaunch;
  const watchLinks = mission.watchLinks;
  const lastUpdatedLabel = formatUpdatedLabel(mission.lastUpdated || mission.generatedAt);
  const launchHref = nextLaunch ? buildLaunchHref(nextLaunch) : null;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Artemis', item: `${siteUrl}/artemis` },
      { '@type': 'ListItem', position: 3, name: 'Artemis II', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: mission.missionName,
    description: 'Artemis II (Artemis 2) mission schedule, countdown, crew overview, and recent updates.',
    dateModified: mission.lastUpdated || mission.generatedAt
  };

  const eventJsonLd =
    nextLaunch != null
      ? {
          '@context': 'https://schema.org',
          '@type': 'Event',
          '@id': `${pageUrl}#next-launch`,
          name: nextLaunch.name,
          startDate: nextLaunch.net,
          eventStatus:
            nextLaunch.status === 'scrubbed'
              ? 'https://schema.org/EventCancelled'
              : nextLaunch.status === 'hold'
                ? 'https://schema.org/EventPostponed'
                : 'https://schema.org/EventScheduled',
          location: {
            '@type': 'Place',
            name: nextLaunch.pad?.name,
            address: {
              '@type': 'PostalAddress',
              addressLocality: nextLaunch.pad?.locationName || undefined,
              addressRegion: nextLaunch.pad?.state || undefined,
              addressCountry: nextLaunch.pad?.countryCode || undefined
            }
          },
          organizer: nextLaunch.provider ? { '@type': 'Organization', name: nextLaunch.provider } : undefined,
          url: launchHref ? `${siteUrl}${launchHref}` : pageUrl
        }
      : null;

  const itemListJsonLd =
    mission.upcoming.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-artemis-ii-launches`,
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
        data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : []), ...(itemListJsonLd ? [itemListJsonLd] : []), faqJsonLd]}
      />
      <ProgramHubBackLink program="artemis" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
        <h1 className="text-3xl font-semibold text-text1">Artemis II (Artemis 2)</h1>
        <p className="max-w-3xl text-sm text-text2">
          Mission-focused coverage for Artemis II including launch timing, countdown visibility, crew notes, and schedule changes. For broader context, visit the{' '}
          <Link href="/artemis" className="text-primary hover:text-primary/80">
            Artemis program hub
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Data source: Launch cache + SNAPI {mission.coverage.hasSocial ? '+ social posts' : ''}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Coverage: news {mission.news.length} • social {mission.social.length}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission summary</h2>
        <p className="mt-2 text-sm text-text2">
          Artemis II is the first planned crewed mission in NASA&apos;s Artemis campaign and is commonly searched as both Artemis II and Artemis 2.
          This page tracks schedule changes, timing, and mission readiness signals as the launch window evolves.
        </p>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
        {nextLaunch ? (
          <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={buildLaunchHref(nextLaunch)} className="text-sm font-semibold text-text1 hover:text-primary">
                  {nextLaunch.name}
                </Link>
                <p className="mt-1 text-xs text-text3">
                  {nextLaunch.provider} - {nextLaunch.vehicle} - {formatPadLabel(nextLaunch)}
                </p>
              </div>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
                Status: {nextLaunch.statusText}
              </span>
            </div>
            {!isDateOnlyNet(nextLaunch.net, nextLaunch.netPrecision) ? (
              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
                <Countdown net={nextLaunch.net} />
              </div>
            ) : null}
            <TimeDisplay net={nextLaunch.net} netPrecision={nextLaunch.netPrecision} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">
            No Artemis II launch window is currently available in the feed. This page stays updated as timing data changes.
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Crew highlights</h2>
          {mission.crewHighlights.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {mission.crewHighlights.map((entry) => (
                <li key={entry} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">Crew details are not currently present in the mission feed payload.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">How to watch</h2>
          {watchLinks.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {watchLinks.map((entry) => (
                <li key={entry.url}>
                  <a href={entry.url} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                    {entry.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">
              No public stream URLs are listed yet. Watch links appear automatically when sources publish them.
            </p>
          )}
        </div>
      </section>

      <section id="astronauts" className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Astronauts</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{crewProfiles.length} profiles</span>
        </div>
        <p className="mt-1 text-xs text-text3">Official profiles are sourced from NASA and partner agency biography pages.</p>
        {crewProfiles.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {crewProfiles.map((person) => (
              <div key={person.id} className="flex gap-3 rounded-xl border border-stroke bg-surface-0 p-3">
                {person.portraitUrl ? (
                  <Image
                    src={person.portraitUrl}
                    alt={person.name}
                    width={84}
                    height={105}
                    className="h-[105px] w-[84px] rounded-lg border border-stroke object-cover"
                  />
                ) : (
                  <div className="flex h-[105px] w-[84px] items-center justify-center rounded-lg border border-stroke bg-surface-2 text-xs uppercase tracking-[0.12em] text-text3">
                    {person.name
                      .split(' ')
                      .slice(0, 2)
                      .map((part) => part.slice(0, 1))
                      .join('')}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-text1">{person.name}</p>
                      <p className="mt-0.5 text-xs text-text3">
                        {person.role || 'Crew'} • {person.agency}
                      </p>
                    </div>
                    <a href={person.bioUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:text-primary/80">
                      Official bio
                    </a>
                  </div>
                  {person.summary ? <p className="mt-2 text-xs text-text2">{truncateText(person.summary, 240)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No official crew biographies are currently available.</p>
        )}
      </section>

      <section id="mission-pieces" className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Mission pieces</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">{missionComponents.length} items</span>
        </div>
        <p className="mt-1 text-xs text-text3">Structured from official NASA reference and topic pages.</p>
        {missionComponents.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {missionComponents.map((component) => (
              <div key={component.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text1">{component.component}</p>
                  {component.officialUrls[0] ? (
                    <a href={component.officialUrls[0]} target="_blank" rel="noreferrer" className="text-xs text-primary hover:text-primary/80">
                      Official source
                    </a>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-text2">{truncateText(component.description, 260)}</p>
                {component.officialUrls.length > 1 ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text3">
                    {component.officialUrls.slice(1, 3).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                        Additional source
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No Artemis II mission components are currently available.</p>
        )}
      </section>

      <ArtemisMissionIntelPanels
        missionLabel={mission.missionName}
        evidenceLinks={mission.evidenceLinks}
        news={mission.news}
        social={mission.social}
        coverage={mission.coverage}
      />

      <LaunchList title="Upcoming Artemis II launches" launches={mission.upcoming} emptyLabel="No upcoming Artemis II launches in the feed yet." />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Recent update log</h2>
        {mission.changes.length ? (
          <ul className="mt-3 space-y-2 text-sm text-text2">
            {mission.changes.map((change) => (
              <li key={`${change.title}:${change.date}`} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-text1">{change.title}</span>
                  <span className="text-xs text-text3">{formatUpdatedLabel(change.date)}</span>
                </div>
                <p className="mt-1">{change.summary}</p>
                {change.href ? (
                  <Link href={change.href} className="mt-2 inline-block text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
                    Open launch detail
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No change-log entries are currently available for Artemis II.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Artemis II FAQ</h2>
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
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Program
        </Link>
        <Link href="/artemis-i" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis I Hub
        </Link>
        <Link href="/artemis-iii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis III Hub
        </Link>
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
        <Link href="/#schedule" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Back to launch schedule
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
                      {launch.provider} - {formatPadLabel(launch)}
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

function truncateText(value: string, max: number) {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}
