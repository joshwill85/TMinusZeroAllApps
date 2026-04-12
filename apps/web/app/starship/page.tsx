import type { Metadata } from 'next';
import Link from 'next/link';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { TimeDisplay } from '@/components/TimeDisplay';
import {
  StarshipProgramWorkbenchDesktop,
  type StarshipWorkbenchMission
} from '@/components/starship/StarshipProgramWorkbenchDesktop';
import { StarshipProgramWorkbenchMobile } from '@/components/starship/StarshipProgramWorkbenchMobile';
import { BRAND_NAME } from '@/lib/brand';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import {
  fetchStarshipFlightIndex,
  fetchStarshipFlightSnapshot,
  fetchStarshipProgramSnapshot
} from '@/lib/server/starship';
import {
  fetchStarshipTimelineViewModel,
  parseBooleanParam,
  parseIsoDateParam,
  parseStarshipAudienceMode,
  parseStarshipMissionFilter,
  parseStarshipSourceFilter
} from '@/lib/server/starshipUi';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { hasPresentSearchParams, readSearchParam, type RouteSearchParams } from '@/lib/utils/searchParams';
import type {
  StarshipTimelineEvent as StarshipServerTimelineEvent,
  StarshipTimelineMissionFilter
} from '@/lib/types/starship';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  buildStarshipFlightSlug,
  parseStarshipFlightSlug
} from '@/lib/utils/starship';
import type {
  StarshipTimelineEvent as StarshipWorkbenchTimelineEvent,
  StarshipTimelineFilters
} from '@/components/starship/StarshipTimelineExplorer';

export const revalidate = 60 * 5; // 5 minutes

type SearchParams = RouteSearchParams;

export async function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/starship';
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `Starship Program Workbench & Flight Tracker | ${BRAND_NAME}`;
  const description = 'Starship program workbench with per-flight timeline routing, evidence context, and launch schedule tracking.';
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

export default async function StarshipPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const mode = parseStarshipAudienceMode(readSearchParam(searchParams, 'mode')) ?? 'quick';
  const sourceType = parseStarshipSourceFilter(readSearchParam(searchParams, 'sourceType')) ?? 'all';
  const includeSuperseded = parseBooleanParam(readSearchParam(searchParams, 'includeSuperseded'), mode === 'technical') ?? (mode === 'technical');

  const parsedFrom = parseIsoDateParam(readSearchParam(searchParams, 'from'));
  const parsedTo = parseIsoDateParam(readSearchParam(searchParams, 'to'));
  const from = parsedFrom === 'invalid' ? null : parsedFrom;
  const to = parsedTo === 'invalid' ? null : parsedTo;
  const isRangeOrdered = !(from && to && from > to);
  const effectiveFrom = isRangeOrdered ? from : null;
  const effectiveTo = isRangeOrdered ? to : null;
  const requestedEventId = readSearchParam(searchParams, 'event');

  const [programSnapshot, flightIndex] = await Promise.all([
    fetchStarshipProgramSnapshot(),
    fetchStarshipFlightIndex()
  ]);

  const parsedMission = parseStarshipMissionFilter(readSearchParam(searchParams, 'mission'));
  const fallbackExplorerMission = flightIndex[0]?.flightSlug || 'starship-program';
  const missionFilter: StarshipTimelineMissionFilter =
    parsedMission ?? (mode === 'explorer' ? fallbackExplorerMission : 'all');

  const timelineViewModel = await fetchStarshipTimelineViewModel({
    mode,
    mission: missionFilter,
    sourceType,
    includeSuperseded,
    from: effectiveFrom,
    to: effectiveTo,
    cursor: null,
    limit: 100
  });

  const missionSnapshots = await Promise.all(
    flightIndex.slice(0, 8).map((entry) => fetchStarshipFlightSnapshot(entry.flightNumber))
  );

  const workbenchMissions = missionSnapshots.map((snapshot) => ({
    id: snapshot.flightSlug,
    label: snapshot.missionName,
    subtitle: `Upcoming: ${snapshot.upcoming.length} • Recent: ${snapshot.recent.length}`,
    status: snapshot.nextLaunch?.statusText || 'Tracking',
    snapshot
  })) satisfies StarshipWorkbenchMission[];

  const timelineEvents = timelineViewModel.events.map(mapTimelineEventToWorkbenchEvent);
  const defaultMissionId = resolveDefaultMissionId(timelineViewModel.mission, workbenchMissions);
  const defaultSelectedEventId = resolveDefaultSelectedEventId(requestedEventId, timelineEvents);
  const initialFilters: StarshipTimelineFilters = {
    sourceType,
    includeSuperseded,
    from: effectiveFrom,
    to: effectiveTo
  };

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/starship`;
  const lastUpdatedLabel = formatUpdatedLabel(programSnapshot.lastUpdated || programSnapshot.generatedAt);
  const nextLaunch = programSnapshot.nextLaunch;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Starship', item: pageUrl }
    ]
  };

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: 'Starship workbench',
    description: 'Starship program and per-flight mission routing with timeline context and launch schedule tracking.',
    dateModified: programSnapshot.lastUpdated || programSnapshot.generatedAt
  };

  const itemListJsonLd =
    programSnapshot.upcoming.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#upcoming-starship-launches`,
          numberOfItems: Math.min(25, programSnapshot.upcoming.length),
          itemListElement: programSnapshot.upcoming.slice(0, 25).map((launch, index) => ({
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
    mainEntity: programSnapshot.faq.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer }
    }))
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : []), faqJsonLd]} />

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">Program Workbench</p>
        <h1 className="text-3xl font-semibold text-text1">Starship Program</h1>
        <p className="max-w-3xl text-sm text-text2">
          Program-level Starship routing page for flight-specific hubs and timeline evidence. Canonical mission links use{' '}
          <code>/starship/flight-&lt;number&gt;</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Last updated: {lastUpdatedLabel}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Timeline events: {timelineViewModel.kpis.totalEvents}</span>
          <span className="rounded-full border border-stroke px-3 py-1">Flights tracked: {flightIndex.length}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Flight routing</h2>
        <p className="mt-2 text-sm text-text2">
          Each flight route has focused context and direct launch links. Explorer and technical console modes default to the latest tracked flight when no mission filter is set.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-text3">
          {flightIndex.slice(0, 8).map((entry) => (
            <Link
              key={entry.flightSlug}
              href={`/starship/${entry.flightSlug}`}
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.1em] hover:text-text1"
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Workbench console</h2>
        <p className="mt-2 text-sm text-text2">
          Interactive Starship timeline, systems, and change-ledger modules are wired directly to server timeline data.
        </p>
        <div className="mt-4 xl:hidden">
          <StarshipProgramWorkbenchMobile
            programSnapshot={programSnapshot}
            missions={workbenchMissions}
            timelineEvents={timelineEvents}
            defaultMode={mode}
            defaultMissionId={defaultMissionId}
            defaultSelectedEventId={defaultSelectedEventId}
            initialFilters={initialFilters}
          />
        </div>
        <div className="mt-4 hidden xl:block">
          <StarshipProgramWorkbenchDesktop
            programSnapshot={programSnapshot}
            missions={workbenchMissions}
            timelineEvents={timelineEvents}
            defaultMode={mode}
            defaultMissionId={defaultMissionId}
            defaultSelectedEventId={defaultSelectedEventId}
            initialFilters={initialFilters}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Next tracked launch</h2>
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
          <p className="mt-3 text-sm text-text2">No upcoming Starship launch is currently available in the feed.</p>
        )}
      </section>

      <LaunchList title="Upcoming Starship launches" launches={programSnapshot.upcoming} emptyLabel="No upcoming Starship launches in the current feed." />
      <LaunchList title="Recent Starship launches" launches={programSnapshot.recent} emptyLabel="No recent Starship launches in the current feed." />

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Starship FAQ</h2>
        <dl className="mt-4 space-y-4">
          {programSnapshot.faq.map((entry) => (
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
        <Link href="/artemis-ii" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Artemis II Hub
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

function mapTimelineEventToWorkbenchEvent(
  event: StarshipServerTimelineEvent
): StarshipWorkbenchTimelineEvent {
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
    supersedes: event.supersedes.map((entry) => ({
      eventId: entry.eventId,
      reason: entry.reason
    })),
    supersededBy: event.supersededBy
      ? { eventId: event.supersededBy.eventId, reason: event.supersededBy.reason }
      : null
  };
}

function toneFromTimelineStatus(
  status: StarshipServerTimelineEvent['status']
): StarshipWorkbenchTimelineEvent['tone'] {
  if (status === 'completed') return 'success';
  if (status === 'upcoming') return 'info';
  if (status === 'tentative') return 'warning';
  if (status === 'superseded') return 'danger';
  return 'default';
}

function formatTimelineMission(
  mission: StarshipServerTimelineEvent['mission']
) {
  if (mission === 'starship-program') return 'Starship Program';
  const flight = parseStarshipFlightSlug(mission);
  if (flight != null) return `Flight ${flight}`;
  return mission;
}

function resolveDefaultMissionId(
  mission: StarshipTimelineMissionFilter,
  workbenchMissions: StarshipWorkbenchMission[]
) {
  if (mission !== 'all' && mission !== 'starship-program') {
    const slug = buildStarshipFlightSlug(parseStarshipFlightSlug(mission) || 0);
    if (workbenchMissions.some((entry) => entry.id === slug)) return slug;
  }

  if (workbenchMissions.length > 0) return workbenchMissions[0].id;
  return null;
}

function resolveDefaultSelectedEventId(
  requestedEventId: string | null,
  events: StarshipWorkbenchTimelineEvent[]
) {
  if (requestedEventId && events.some((event) => event.id === requestedEventId)) {
    return requestedEventId;
  }
  return events[0]?.id ?? null;
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
