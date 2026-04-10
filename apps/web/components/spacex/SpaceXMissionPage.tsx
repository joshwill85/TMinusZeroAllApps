import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { ProgramHubBackLink } from '@/components/ProgramHubBackLink';
import { Countdown } from '@/components/Countdown';
import { TimeDisplay } from '@/components/TimeDisplay';
import { isDateOnlyNet } from '@/lib/time';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSpaceXDroneShipAssignmentsByLaunchIds, type SpaceXLaunchDroneShipAssignment } from '@/lib/server/spacexDroneShips';
import {
  buildSpaceXContractSlug,
  fetchSpaceXContractPreview,
  fetchSpaceXMissionSnapshot,
  fetchSpaceXPassengers,
  fetchSpaceXPayloads
} from '@/lib/server/spacexProgram';
import type { SpaceXMissionKey } from '@/lib/types/spacexProgram';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { Launch } from '@/lib/types/launch';

export async function SpaceXMissionPage({
  missionKey,
  canonicalPath,
  heading,
  summary
}: {
  missionKey: SpaceXMissionKey;
  canonicalPath: string;
  heading: string;
  summary: string;
}) {
  const [snapshot, passengers, payloads, contractPreview] = await Promise.all([
    fetchSpaceXMissionSnapshot(missionKey),
    fetchSpaceXPassengers(missionKey),
    fetchSpaceXPayloads(missionKey),
    fetchSpaceXContractPreview(8, missionKey)
  ]);
  const droneShipAssignments = await fetchSpaceXDroneShipAssignmentsByLaunchIds(
    dedupeIds([...snapshot.upcoming, ...snapshot.recent].map((launch) => launch.id))
  );

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const featuredLaunch = snapshot.nextLaunch || snapshot.recent[0] || null;
  const lastUpdated = formatUpdatedLabel(snapshot.lastUpdated || snapshot.generatedAt);

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'SpaceX', item: `${siteUrl}/spacex` },
      { '@type': 'ListItem', position: 3, name: heading, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd]} />
      <ProgramHubBackLink program="spacex" />

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
          <span className="rounded-full border border-stroke px-3 py-1">Contracts: {contractPreview.total}</span>
        </div>
      </header>

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
            {snapshot.nextLaunch && !isDateOnlyNet(snapshot.nextLaunch.net, snapshot.nextLaunch.netPrecision) ? (
              <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-text3">Countdown</p>
                <Countdown net={snapshot.nextLaunch.net} />
              </div>
            ) : null}
            <TimeDisplay net={featuredLaunch.net} netPrecision={featuredLaunch.netPrecision} />
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
          {contractPreview.total ? (
            <ul className="mt-3 space-y-2 text-sm text-text2">
              {contractPreview.items.map((contract) => (
                <li key={contract.id} className="rounded-lg border border-stroke bg-surface-0 p-3">
                  <Link
                    href={`/spacex/contracts/${buildSpaceXContractSlug(contract.contractKey)}`}
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
                  <p className="text-xs text-text3">{person.role || 'Passenger'}</p>
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
                  <p className="text-xs text-text3">{payload.payloadType || 'Payload'} • {payload.orbit || 'Orbit TBD'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text2">No payload records currently available.</p>
          )}
        </div>
      </section>

      <LaunchList
        title={`Upcoming ${heading} launches`}
        launches={snapshot.upcoming}
        emptyLabel={`No upcoming ${heading} launches currently listed.`}
        droneShipAssignments={droneShipAssignments}
      />
      <LaunchList
        title={`Recent ${heading} launches`}
        launches={snapshot.recent}
        emptyLabel={`No recent ${heading} launches currently listed.`}
        droneShipAssignments={droneShipAssignments}
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
        <Link href="/spacex" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          SpaceX Program
        </Link>
        <Link href="/spacex/vehicles" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Vehicles
        </Link>
        <Link href="/spacex/engines" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Engines
        </Link>
        <Link href="/spacex/flights" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Flights
        </Link>
        <Link href="/spacex/contracts" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Contracts
        </Link>
        <Link href="/spacex/drone-ships" className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1">
          Drone Ships
        </Link>
      </div>
    </div>
  );
}

function LaunchList({
  title,
  launches,
  emptyLabel,
  droneShipAssignments
}: {
  title: string;
  launches: Launch[];
  emptyLabel: string;
  droneShipAssignments: Map<string, SpaceXLaunchDroneShipAssignment>;
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
            const assignment = droneShipAssignments.get(launch.id);
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
                    {assignment ? (
                      <p className="mt-1 text-xs text-text3">
                        Landing ship:{' '}
                        <Link href={`/spacex/drone-ships/${assignment.shipSlug}`} className="font-semibold text-text2 hover:text-text1">
                          {assignment.shipName || assignment.shipAbbrev || assignment.shipSlug.toUpperCase()}
                        </Link>
                      </p>
                    ) : null}
                  </div>
                  <span className="text-xs text-text3">{formatUpdatedLabel(launch.net)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function dedupeIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
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
