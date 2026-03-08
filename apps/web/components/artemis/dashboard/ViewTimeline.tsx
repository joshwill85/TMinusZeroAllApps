import Link from 'next/link';
import { ArtemisProgramWorkbenchDesktop } from '@/components/artemis/ArtemisProgramWorkbenchDesktop';
import { ArtemisProgramWorkbenchMobile } from '@/components/artemis/ArtemisProgramWorkbenchMobile';
import { isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { Launch } from '@/lib/types/launch';
import { formatLaunchDate } from './formatters';
import { MissionControlCard } from './MissionControlCard';
import { MissionControlEmptyState } from './MissionControlEmptyState';
import type { ArtemisMissionControlProps } from './types';

export function ViewTimeline({
  programSnapshot,
  missions,
  timelineEvents,
  timelineInitialState
}: Pick<ArtemisMissionControlProps, 'programSnapshot' | 'missions' | 'timelineEvents' | 'timelineInitialState'>) {
  return (
    <div className="space-y-4 xl:flex xl:h-full xl:flex-col xl:overflow-hidden">
      <MissionControlCard
        title="Timeline Console"
        subtitle="Mission timeline explorer with full evidence filters and deep-link URL state"
        className="xl:flex-1 xl:overflow-hidden"
        bodyClassName="xl:h-full xl:overflow-y-auto xl:pr-1"
      >
        <div className="xl:hidden">
          <ArtemisProgramWorkbenchMobile
            programSnapshot={programSnapshot}
            missions={missions}
            timelineEvents={timelineEvents}
            defaultMode={timelineInitialState.mode}
            defaultMissionId={timelineInitialState.defaultMissionId}
            defaultSelectedEventId={timelineInitialState.defaultSelectedEventId}
            initialFilters={timelineInitialState.initialFilters}
          />
        </div>
        <div className="hidden xl:block">
          <ArtemisProgramWorkbenchDesktop
            programSnapshot={programSnapshot}
            missions={missions}
            timelineEvents={timelineEvents}
            defaultMode={timelineInitialState.mode}
            defaultMissionId={timelineInitialState.defaultMissionId}
            defaultSelectedEventId={timelineInitialState.defaultSelectedEventId}
            initialFilters={timelineInitialState.initialFilters}
          />
        </div>
      </MissionControlCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <TimelineLaunchList
          title="Upcoming Artemis launches"
          launches={programSnapshot.upcoming}
          emptyLabel="No upcoming Artemis launches in the current feed."
        />
        <TimelineLaunchList
          title="Recent Artemis launches"
          launches={programSnapshot.recent}
          emptyLabel="No recent Artemis launches found in the current feed."
        />
      </div>
    </div>
  );
}

function TimelineLaunchList({ title, launches, emptyLabel }: { title: string; launches: Launch[]; emptyLabel: string }) {
  return (
    <MissionControlCard title={title} action={<span>{launches.length} items</span>}>
      {launches.length === 0 ? (
        <MissionControlEmptyState title="No launch rows" detail={emptyLabel} />
      ) : (
        <ul className="space-y-2">
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
                      {launch.provider} - {launch.vehicle}
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
    </MissionControlCard>
  );
}
