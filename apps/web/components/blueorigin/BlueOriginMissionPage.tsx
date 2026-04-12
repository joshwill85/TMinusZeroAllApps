import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { Countdown } from '@/components/Countdown';
import { TimeDisplay } from '@/components/TimeDisplay';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchBlueOriginMissionSnapshot, getBlueOriginMissionLabel } from '@/lib/server/blueOrigin';
import { buildBlueOriginContractSlug, fetchBlueOriginContracts } from '@/lib/server/blueOriginContracts';
import { fetchBlueOriginContentViewModel } from '@/lib/server/blueOriginContent';
import { fetchBlueOriginPassengers, fetchBlueOriginPayloads } from '@/lib/server/blueOriginPeoplePayloads';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  BlueOriginRouteTraceLink,
  BlueOriginRouteTraceLogger
} from '@/app/blue-origin/_components/BlueOriginRouteTransitionTracker';
import type { BlueOriginMissionKey } from '@/lib/utils/blueOrigin';
import type { Launch } from '@/lib/types/launch';

export async function BlueOriginMissionPage({
  missionKey,
  canonicalPath,
  heading,
  summary
}: {
  missionKey: BlueOriginMissionKey;
  canonicalPath: string;
  heading: string;
  summary: string;
}) {
  const debugMode = process.env.NODE_ENV !== 'production';
  const serverStartMs = nowMilliseconds();
  const timings: Array<{
    phase: 'fetch' | 'transform' | 'server-total';
    step: string;
    ms: number;
    status: 'ok' | 'error';
    detail: string | null;
  }> = [];

  const pushTiming = (
    phase: 'fetch' | 'transform' | 'server-total',
    step: string,
    startedAtMs: number,
    status: 'ok' | 'error',
    detail: string | null = null
  ) => {
    timings.push({
      phase,
      step,
      ms: Number((nowMilliseconds() - startedAtMs).toFixed(2)),
      status,
      detail
    });
  };

  const timedFetch = async <T,>(step: string, fetcher: () => Promise<T>): Promise<T> => {
    const startedAtMs = nowMilliseconds();
    try {
      const result = await fetcher();
      pushTiming('fetch', step, startedAtMs, 'ok');
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      pushTiming('fetch', step, startedAtMs, 'error', detail);
      throw error;
    }
  };

  const [snapshot, passengers, payloads, contracts, content] = await Promise.all([
    timedFetch('fetchBlueOriginMissionSnapshot', () => fetchBlueOriginMissionSnapshot(missionKey)),
    timedFetch('fetchBlueOriginPassengers', () => fetchBlueOriginPassengers(missionKey)),
    timedFetch('fetchBlueOriginPayloads', () => fetchBlueOriginPayloads(missionKey)),
    timedFetch('fetchBlueOriginContracts', () => fetchBlueOriginContracts(missionKey)),
    timedFetch('fetchBlueOriginContentViewModel', () =>
      fetchBlueOriginContentViewModel({ mission: missionKey, kind: 'all', limit: 12, cursor: null })
    )
  ]);
  pushTiming('server-total', 'blueOriginMissionPage', serverStartMs, 'ok');

  if (debugMode) {
    console.info('[TMZ][BlueOriginMission][Server] timings', timings);
    console.info('[TMZ][BlueOriginMission][Server] launch slices', {
      missionKey,
      upcomingCount: snapshot.upcoming.length,
      recentCount: snapshot.recent.length,
      nextLaunchNet: snapshot.nextLaunch?.net || null,
      firstRecentNet: snapshot.recent[0]?.net || null
    });
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const nextLaunch = snapshot.nextLaunch;
  const featuredLaunch = nextLaunch || snapshot.recent[0] || null;
  const lastUpdated = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Blue Origin', item: `${siteUrl}/blue-origin` },
      { '@type': 'ListItem', position: 3, name: heading, item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: heading,
    description: summary,
    dateModified: snapshot.lastUpdated || snapshot.generatedAt
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
          organizer: featuredLaunch.provider ? { '@type': 'Organization', name: featuredLaunch.provider } : undefined,
          url: `${siteUrl}${buildLaunchHref(featuredLaunch)}`
        }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <BlueOriginRouteTraceLogger expectedPath={canonicalPath} serverTimings={timings} />
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(eventJsonLd ? [eventJsonLd] : [])]} />
      <ProgramHubBackLink program="blue-origin" />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Mission Hub</p>
        <h1 className="text-3xl font-semibold text-text1">{heading}</h1>
        <p className="max-w-3xl text-sm text-text2">{summary}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdated}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Upcoming: {snapshot.upcoming.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Recent: {snapshot.recent.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Passengers: {passengers.items.length}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Payloads: {payloads.items.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission snapshot</h2>
        <p className="mt-2 text-sm text-text2">{summary}</p>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Launch date and countdown</h2>
        {featuredLaunch ? (
          <div className="mt-3 space-y-3 rounded-xl border border-stroke bg-surface-0 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={buildLaunchHref(featuredLaunch)} className="text-sm font-semibold text-text1 hover:text-primary">
                  {featuredLaunch.name}
                </Link>
                <p className="mt-1 text-xs text-text3">
                  {featuredLaunch.provider} • {featuredLaunch.vehicle} • {featuredLaunch.pad?.shortCode || 'Pad TBD'}
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
            <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} fallbackTimeZone={featuredLaunch.pad.timezone} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text2">No launch entry is currently available for this mission route.</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Mission highlights</h2>
          {snapshot.highlights.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {snapshot.highlights.map((entry) => (
                <li key={entry} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  {entry}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No mission highlights currently available.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Contracts and procurement</h2>
          {contracts.items.length ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {contracts.items.slice(0, 8).map((contract) => (
                <li key={contract.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <Link
                    href={`/blue-origin/contracts/${buildBlueOriginContractSlug(contract.contractKey)}`}
                    className="font-semibold text-text1 hover:text-primary"
                  >
                    {contract.title}
                  </Link>
                  <p className="mt-1">{contract.description}</p>
                  <p className="mt-1 text-xs text-text3">{contract.awardedOn || 'Date pending'} • {contract.agency || contract.customer || 'Public record'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No contract records currently associated with this mission.</p>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Passengers</h2>
          {passengers.items.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-sm text-text2">
              {passengers.items.slice(0, 16).map((person) => (
                <li key={person.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <p className="font-semibold text-text1">{person.name}</p>
                  <p className="text-xs text-text3">{person.role || 'Passenger'} • {person.flightCode?.toUpperCase() || 'Mission'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No passenger records currently available.</p>
          )}
        </div>

        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <h2 className="text-xl font-semibold text-text1">Payload manifest</h2>
          {payloads.items.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-sm text-text2">
              {payloads.items.slice(0, 16).map((payload) => (
                <li key={payload.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <p className="font-semibold text-text1">{payload.name}</p>
                  <p className="text-xs text-text3">{payload.payloadType || 'Payload'} • {payload.flightCode?.toUpperCase() || 'Mission'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No payload records currently available.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Official media and updates</h2>
        {content.items.length ? (
          <ul className="mt-3 space-y-2">
            {content.items.slice(0, 12).map((item) => (
              <li key={item.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-text1 hover:text-primary">
                    {item.title}
                  </a>
                  <span className="text-xs uppercase tracking-[0.08em] text-text3">{item.kind}</span>
                </div>
                {item.summary ? <p className="mt-1 text-sm text-text2">{item.summary}</p> : null}
                <p className="mt-1 text-xs text-text3">{item.sourceLabel} • {item.confidence}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text2">No media items currently available for this mission.</p>
        )}
      </section>

      <LaunchList
        title={`Upcoming ${getBlueOriginMissionLabel(missionKey)} launches`}
        launches={snapshot.upcoming}
        emptyLabel={`No upcoming ${getBlueOriginMissionLabel(missionKey)} launches currently listed.`}
      />

      <LaunchList
        title={`Recent ${getBlueOriginMissionLabel(missionKey)} launches`}
        launches={snapshot.recent}
        emptyLabel={`No recent ${getBlueOriginMissionLabel(missionKey)} launches currently listed.`}
      />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">FAQ</h2>
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
        <BlueOriginRouteTraceLink
          href="/blue-origin"
          traceLabel="Blue Origin Program"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Blue Origin Program
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/missions/new-shepard"
          traceLabel="New Shepard Mission Hub"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          New Shepard
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/missions/new-glenn"
          traceLabel="New Glenn Mission Hub"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          New Glenn
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/vehicles"
          traceLabel="Blue Origin Vehicles"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Vehicles
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/engines"
          traceLabel="Blue Origin Engines"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Engines
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/flights"
          traceLabel="Blue Origin Flights"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Flights
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/travelers"
          traceLabel="Blue Origin Travelers"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Travelers
        </BlueOriginRouteTraceLink>
        <BlueOriginRouteTraceLink
          href="/blue-origin/contracts"
          traceLabel="Blue Origin Contracts"
          className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
        >
          Contracts
        </BlueOriginRouteTraceLink>
      </div>
    </div>
  );
}

function LaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
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
                <span className="text-xs text-text3">{formatUpdatedLabel(launch.net)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatUpdatedLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function nowMilliseconds() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
