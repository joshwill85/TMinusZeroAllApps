import Link from 'next/link';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { formatLaunchDate } from '@/lib/utils/spacexHub';
import type { Launch } from '@/lib/types/launch';
import type { SpaceXFlightRecord } from '@/lib/types/spacexProgram';

export function SpaceXFlightsSection({
  flights,
  upcoming,
  recent
}: {
  flights: SpaceXFlightRecord[];
  upcoming: Launch[];
  recent: Launch[];
}) {
  return (
    <section id="flights" className="scroll-mt-24 space-y-4">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Notable flights</h2>
          <Link href="/spacex/flights" className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80">
            Flight index
          </Link>
        </div>
        {flights.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {flights.slice(0, 16).map((entry) => (
              <li key={entry.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/spacex/flights/${entry.flightSlug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                      {entry.launch.name}
                    </Link>
                    <p className="mt-1 text-xs text-text3">
                      {entry.missionLabel}
                      {entry.droneShipSlug ? (
                        <>
                          {' '}
                          •{' '}
                          <Link href={`/spacex/drone-ships/${entry.droneShipSlug}`} className="hover:text-text1">
                            {entry.droneShipName || entry.droneShipAbbrev || entry.droneShipSlug.toUpperCase()}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className="text-xs text-text3">{formatLaunchDate(entry.launch.net)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-text3">No SpaceX flights are currently present in the launch cache snapshot.</p>
        )}
      </section>

      <LaunchList
        title="Upcoming SpaceX launches"
        launches={upcoming}
        emptyLabel="No upcoming SpaceX launches currently listed."
      />
      <LaunchList title="Recent SpaceX launches" launches={recent} emptyLabel="No recent SpaceX launches currently listed." />
    </section>
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
                <span className="text-xs text-text3">{formatLaunchDate(launch.net)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
