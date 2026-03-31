import Link from 'next/link';
import clsx from 'clsx';
import type { ArtemisDashboardView } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { MissionControlStatChip } from './MissionControlStatChip';

const VIEW_COPY: Record<ArtemisDashboardView, { label: string; detail: string }> = {
  overview: {
    label: 'Overview',
    detail: 'Program summary with launch readiness, recent milestones, and key updates.'
  },
  timeline: {
    label: 'Timeline',
    detail: 'Mission-by-mission timeline with dated milestones, linked sources, and launch context.'
  },
  intel: {
    label: 'Updates',
    detail: 'Source-linked articles, imagery, posts, and structured data updates.'
  },
  budget: {
    label: 'Budget',
    detail: 'Budget lines, award totals, and contract pages tied to Artemis.'
  },
  missions: {
    label: 'Missions',
    detail: 'Direct links to Artemis mission pages from Artemis I through Artemis VII.'
  }
};

export function DashboardTopBar({
  activeView,
  nextLaunch,
  lastUpdatedLabel
}: {
  activeView: ArtemisDashboardView;
  nextLaunch: Launch | null;
  lastUpdatedLabel: string;
}) {
  const copy = VIEW_COPY[activeView];
  const launchHref = nextLaunch ? buildLaunchHref(nextLaunch) : null;

  return (
    <header className="rounded-3xl border border-stroke bg-[rgba(7,10,22,0.86)] px-5 py-5 shadow-surface backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-text4">
        <span>Artemis Program</span>
        <span className="hidden sm:inline">/</span>
        <span className="text-text3">{copy.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-semibold text-text1 md:text-4xl">Artemis Program</h1>
          <p className="mt-2 text-sm text-text2">{copy.detail}</p>
        </div>
        <div className="rounded-2xl border border-stroke bg-surface-0/80 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-text4">Current View</p>
          <p className="text-sm font-semibold text-text1">{copy.label}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MissionControlStatChip label={`Last updated: ${lastUpdatedLabel}`} />
        <MissionControlStatChip label="Data: server-rendered timeline + linked sources" tone="info" />
        <Link
          href="/artemis/awardees"
          className={clsx(
            'inline-flex items-center rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-text2 transition',
            'hover:border-primary hover:text-text1'
          )}
        >
          Awardee index
        </Link>
        {nextLaunch && launchHref ? (
          <Link
            href={launchHref}
            className={clsx(
              'inline-flex items-center rounded-full border border-stroke px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-text2 transition',
              'hover:border-primary hover:text-text1'
            )}
          >
            Next launch: {nextLaunch.name}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
