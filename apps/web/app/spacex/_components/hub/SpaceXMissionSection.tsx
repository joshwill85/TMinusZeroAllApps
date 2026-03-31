import Link from 'next/link';
import { SPACEX_MISSION_ITEMS, type SpaceXMissionPulseEntry } from '@/lib/utils/spacexHub';

export function SpaceXMissionSection({
  missionPulse,
  missionPulseMax,
  upcomingCount,
  recentCount,
  passengersCount,
  payloadsCount,
  contractsCount
}: {
  missionPulse: SpaceXMissionPulseEntry[];
  missionPulseMax: number;
  upcomingCount: number;
  recentCount: number;
  passengersCount: number;
  payloadsCount: number;
  contractsCount: number;
}) {
  return (
    <section id="mission" className="scroll-mt-24 space-y-4">
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <h2 className="text-xl font-semibold text-text1">Mission pages</h2>
        <p className="mt-2 text-sm text-text2">
          Mission pages cover Starship, Falcon 9, Falcon Heavy, and Dragon with linked flights, passengers, payloads, and contract pages.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SPACEX_MISSION_ITEMS.map((mission) => (
            <Link
              key={mission.key}
              href={mission.href}
              className="rounded-xl border border-stroke bg-surface-0 p-3 hover:border-primary/60"
            >
              <p className="text-sm font-semibold text-text1">{mission.label}</p>
              <p className="mt-1 text-xs text-text3">Flights, payloads, passengers, and contract pages.</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-text1">Program summary</h2>
          <span className="rounded-full border border-stroke px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-text3">
            Coverage snapshot
          </span>
        </div>
        <p className="mt-2 text-sm text-text2">
          Flight activity spans multiple mission families, with crew, payload, and contract coverage collected in one place.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-stroke bg-surface-0 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-text3">Mission cadence mix</p>
            <ul className="mt-3 space-y-3">
              {missionPulse.map((entry) => {
                const width = missionPulseMax > 0 ? Math.max(8, Math.round((entry.total / missionPulseMax) * 100)) : 8;
                return (
                  <li key={entry.key}>
                    <div className="flex items-center justify-between gap-2 text-xs text-text3">
                      <span className="font-semibold text-text1">{entry.label}</span>
                      <span>Total {entry.total}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-[rgba(255,255,255,0.08)]">
                      <div className="h-2 rounded-full bg-primary/85" style={{ width: `${width}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-text3">
                      Upcoming {entry.upcoming} • Recent {entry.recent}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-stroke bg-surface-0 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-text3">Program snapshot</p>
            <ul className="mt-3 space-y-2 text-sm text-text2">
              <li className="rounded-lg border border-stroke bg-surface-1/40 p-2">
                <span className="font-semibold text-text1">Upcoming vs. recent flights:</span> {upcomingCount} upcoming missions against {recentCount} recent completions.
              </li>
              <li className="rounded-lg border border-stroke bg-surface-1/40 p-2">
                <span className="font-semibold text-text1">Passenger records:</span> {passengersCount} passenger records currently connected to tracked missions.
              </li>
              <li className="rounded-lg border border-stroke bg-surface-1/40 p-2">
                <span className="font-semibold text-text1">Payload records:</span> {payloadsCount} payload records tied to program flights.
              </li>
              <li className="rounded-lg border border-stroke bg-surface-1/40 p-2">
                <span className="font-semibold text-text1">Contract pages:</span> {contractsCount} tracked contract entries with linked source records.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </section>
  );
}
