import Link from 'next/link';
import type { SpaceXDroneShipListResponse } from '@/lib/types/spacexProgram';

export function SpaceXRecoverySection({ droneShips }: { droneShips: SpaceXDroneShipListResponse }) {
  return (
    <section id="recovery" className="scroll-mt-24">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Drone-ship recoveries</h2>
          <Link
            href="/spacex/drone-ships"
            className="text-xs uppercase tracking-[0.1em] text-primary hover:text-primary/80"
          >
            Recovery hub
          </Link>
        </div>
        <p className="mt-2 text-sm text-text2">
          OCISLY, ASOG, and JRTI coverage with assignment KPIs, booster-level context, and launch-linked drilldowns.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">
            Known assignments: {droneShips.coverage.knownLandingAssignments.toLocaleString('en-US')}
          </span>
          <span className="rounded-full border border-stroke px-3 py-1">
            Upcoming recoveries: {droneShips.coverage.upcomingKnownAssignments.toLocaleString('en-US')}
          </span>
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {droneShips.items.map((ship) => (
            <li key={ship.slug} className="rounded-xl border border-stroke bg-surface-0 p-3">
              <Link href={`/spacex/drone-ships/${ship.slug}`} className="text-sm font-semibold text-text1 hover:text-primary">
                {ship.name}
              </Link>
              <p className="mt-1 text-xs text-text3">
                {ship.abbrev || ship.slug.toUpperCase()} • {ship.status}
              </p>
              <p className="mt-2 text-xs text-text3">
                Known {ship.kpis.assignmentsKnown} • Upcoming {ship.kpis.upcomingAssignments} • Boosters{' '}
                {ship.kpis.distinctBoostersRecovered}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
