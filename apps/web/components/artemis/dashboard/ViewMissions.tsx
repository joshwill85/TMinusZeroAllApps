import Link from 'next/link';
import { Countdown } from '@/components/Countdown';
import { TimeDisplay } from '@/components/TimeDisplay';
import { isDateOnlyNet } from '@/lib/time';
import { ARTEMIS_MISSION_HUB_KEYS } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { formatUpdatedLabel } from './formatters';
import { MissionControlCard } from './MissionControlCard';
import { MissionControlEmptyState } from './MissionControlEmptyState';
import type { ArtemisMissionControlProps } from './types';

const STATE_TONE: Record<'completed' | 'in-preparation' | 'planned', string> = {
  completed: 'bg-success/80',
  'in-preparation': 'bg-primary/80',
  planned: 'bg-stroke-strong'
};

const STATE_LABEL: Record<'completed' | 'in-preparation' | 'planned', string> = {
  completed: 'Completed',
  'in-preparation': 'In preparation',
  planned: 'Planned'
};

const STATE_WEIGHT: Record<'completed' | 'in-preparation' | 'planned', number> = {
  completed: 1,
  'in-preparation': 0.6,
  planned: 0.2
};

export function ViewMissions({
  missionCards,
  missionLaunches,
  missionProgress
}: Pick<ArtemisMissionControlProps, 'missionCards' | 'missionLaunches' | 'missionProgress'>) {
  const orderedProgress = ARTEMIS_MISSION_HUB_KEYS.map((key) => missionProgress.find((entry) => entry.mission === key)).filter(
    (entry): entry is ArtemisMissionControlProps['missionProgress'][number] => Boolean(entry)
  );
  const progressScore = orderedProgress.reduce((sum, entry) => sum + STATE_WEIGHT[entry.state], 0);
  const completionPercent = orderedProgress.length ? Math.round((progressScore / orderedProgress.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <MissionControlCard
        title="Program Progress"
        subtitle="Campaign completion estimate across Artemis I through Artemis VII"
        action={<span>{completionPercent}% complete</span>}
      >
        {orderedProgress.length ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full border border-stroke bg-surface-0">
              {orderedProgress.map((entry) => (
                <div
                  key={entry.mission}
                  title={`${entry.label}: ${STATE_LABEL[entry.state]}`}
                  className={STATE_TONE[entry.state]}
                  style={{ width: `${100 / orderedProgress.length}%` }}
                />
              ))}
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {orderedProgress.map((entry) => (
                <li key={entry.mission} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                  <p className="text-xs font-semibold text-text1">{entry.label}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-text3">{STATE_LABEL[entry.state]}</p>
                  <p className="mt-1 text-xs text-text3">{entry.targetDate ? formatUpdatedLabel(entry.targetDate) : 'Target TBD'}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <MissionControlEmptyState
            title="Program progress unavailable"
            detail="Timeline mission progress records are not currently available."
          />
        )}
      </MissionControlCard>

      <MissionControlCard title="Mission Hubs" subtitle="Direct routing to each mission page with current launch context">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missionCards.map((mission) => {
            const launch = missionLaunches[mission.key];
            return (
              <article key={mission.key} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text1">
                      <Link href={mission.href} className="hover:text-primary">
                        {mission.mission}
                      </Link>
                    </h3>
                    <p className="mt-1 text-xs text-text3">{mission.detail}</p>
                  </div>
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                    {mission.status}
                  </span>
                </div>

                <p className="mt-2 text-sm text-text2">{mission.summary}</p>

                {launch ? (
                  <MissionLaunchStatus launch={launch} href={buildLaunchHref(launch)} />
                ) : (
                  <p className="mt-3 rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-xs text-text3">
                    No mission-specific launch entry is currently available in the feed.
                  </p>
                )}

                <Link href={mission.href} className="mt-3 inline-flex rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-text3 hover:text-text1">
                  Open mission page
                </Link>
              </article>
            );
          })}
        </div>
      </MissionControlCard>
    </div>
  );
}

function MissionLaunchStatus({ href, launch }: { href: string; launch: Launch }) {
  const isUpcoming = Date.parse(launch.net) >= Date.now();
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-stroke bg-surface-1 p-3">
      <p className="text-[11px] uppercase tracking-[0.1em] text-text3">{isUpcoming ? 'Tracked launch window' : 'Latest tracked launch'}</p>
      <Link href={href} className="text-sm font-semibold text-text1 hover:text-primary">
        {launch.name}
      </Link>
      <p className="text-xs text-text3">
        {launch.provider} - {launch.vehicle}
      </p>
      {isUpcoming && !dateOnly ? (
        <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-2">
          <Countdown net={launch.net} />
        </div>
      ) : null}
      <TimeDisplay net={launch.net} netPrecision={launch.netPrecision} />
    </div>
  );
}
