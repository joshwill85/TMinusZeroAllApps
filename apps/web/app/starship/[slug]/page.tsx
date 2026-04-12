import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { TimeDisplay } from '@/components/TimeDisplay';
import { BRAND_NAME } from '@/lib/brand';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchStarshipFlightSnapshot } from '@/lib/server/starship';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  buildStarshipFlightSlug,
  parseStarshipFlightSlug
} from '@/lib/utils/starship';

export const revalidate = 60 * 5; // 5 minutes

type Params = {
  slug: string;
};

export async function generateMetadata({
  params
}: {
  params: Params;
}): Promise<Metadata> {
  const parsed = parseFlightParam(params.slug);
  if (!parsed) {
    return {
      title: `Starship Flight | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = `/starship/${parsed.canonicalSlug}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Starship Flight ${parsed.flightNumber} Tracker | ${BRAND_NAME}`;
  const description = `Starship Flight ${parsed.flightNumber} launch schedule, timeline updates, and mission tracking coverage.`;
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

export default async function StarshipFlightPage({
  params
}: {
  params: Params;
}) {
  const parsed = parseFlightParam(params.slug);
  if (!parsed) notFound();
  if (parsed.redirectNeeded) {
    permanentRedirect(`/starship/${parsed.canonicalSlug}`);
  }

  const snapshot = await fetchStarshipFlightSnapshot(parsed.flightNumber);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/starship/${parsed.canonicalSlug}`;
  const nextLaunch = snapshot.nextLaunch;
  const lastUpdatedLabel = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);
  const launchHref = nextLaunch ? buildLaunchHref(nextLaunch) : null;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Starship', item: `${siteUrl}/starship` },
      {
        '@type': 'ListItem',
        position: 3,
        name: snapshot.missionName,
        item: pageUrl
      }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: snapshot.missionName,
    description: `${snapshot.missionName} timeline and launch tracking coverage.`,
    dateModified: snapshot.lastUpdated || snapshot.generatedAt
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
    snapshot.upcoming.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-starship-flight-launches`,
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd
        data={[
          breadcrumbJsonLd,
          collectionPageJsonLd,
          ...(eventJsonLd ? [eventJsonLd] : []),
          ...(itemListJsonLd ? [itemListJsonLd] : []),
          faqJsonLd
        ]}
      />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Flight Hub</p>
        <h1 className="text-3xl font-semibold text-text1">{snapshot.missionName}</h1>
        <p className="max-w-3xl text-sm text-text2">
          Flight-level Starship route with canonical URL handling, launch tracking, and timeline references. Legacy aliases like <code>ift-{snapshot.flightNumber}</code> redirect here.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Upcoming: {snapshot.upcoming.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Recent: {snapshot.recent.length}</span>
        </div>
      </header>

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
                  {nextLaunch.provider} • {nextLaunch.vehicle}
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
            <TimeDisplay net={nextLaunch.net} netPrecision={nextLaunch.netPrecision} fallbackTimeZone={nextLaunch.pad.timezone} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No launch entry is currently available for this flight number.</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Flight highlights</h2>
          {snapshot.crewHighlights.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {snapshot.crewHighlights.map((entry) => (
                <li key={entry} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No flight highlights are currently available for this route.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Recent changes</h2>
          {snapshot.changes.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {snapshot.changes.map((change) => (
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
            <p className="mt-3 text-sm text-text2">No change entries are currently available for this flight route.</p>
          )}
        </div>
      </section>

      <LaunchList
        title={`Upcoming ${snapshot.missionName} launches`}
        launches={snapshot.upcoming}
        emptyLabel={`No upcoming ${snapshot.missionName} launches are currently listed.`}
      />

      <LaunchList
        title={`Recent ${snapshot.missionName} launches`}
        launches={snapshot.recent}
        emptyLabel={`No recent ${snapshot.missionName} launches are currently listed.`}
      />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">{snapshot.missionName} FAQ</h2>
        <dl className="mt-4 space-y-4">
          {snapshot.faq.map((entry) => (
            <div key={entry.question}>
              <dt className="text-sm font-semibold text-text1">{entry.question}</dt>
              <dd className="mt-1 text-sm text-text2">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
        <Link href="/starship" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Starship Program
        </Link>
        <Link href="/artemis" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis Program
        </Link>
        <Link href="/#schedule" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Back to launch schedule
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
                      {launch.provider} • {launch.vehicle}
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

function parseFlightParam(raw: string) {
  const trimmed = (raw || '').trim().toLowerCase();
  if (!trimmed) return null;

  const canonical = parseStarshipFlightSlug(trimmed);
  if (canonical != null) {
    return {
      flightNumber: canonical,
      canonicalSlug: buildStarshipFlightSlug(canonical),
      redirectNeeded: false
    };
  }

  const aliasPatterns = [
    /^ift-(\d{1,3})$/,
    /^ift(\d{1,3})$/,
    /^flight(\d{1,3})$/,
    /^(\d{1,3})$/
  ];

  for (const pattern of aliasPatterns) {
    const match = trimmed.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) continue;
    const flightNumber = Math.max(1, Math.min(999, Math.trunc(parsed)));
    return {
      flightNumber,
      canonicalSlug: buildStarshipFlightSlug(flightNumber),
      redirectNeeded: true
    };
  }

  return null;
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
