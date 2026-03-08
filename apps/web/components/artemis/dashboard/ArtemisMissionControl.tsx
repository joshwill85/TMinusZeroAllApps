'use client';

import { useCallback } from 'react';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ArtemisDashboardView } from '@/lib/types/artemis';
import { DashboardMobileViewNav } from './DashboardMobileViewNav';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardTopBar } from './DashboardTopBar';
import type { ArtemisDashboardNavItem, ArtemisMissionControlProps } from './types';
import { ViewBudget } from './ViewBudget';
import { ViewIntel } from './ViewIntel';
import { ViewMissions } from './ViewMissions';
import { ViewOverview } from './ViewOverview';
import { ViewTimeline } from './ViewTimeline';

const NAV_ITEMS: readonly ArtemisDashboardNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    shortLabel: 'Overview',
    description: 'Executive mission pulse'
  },
  {
    id: 'timeline',
    label: 'Timeline',
    shortLabel: 'Timeline',
    description: 'Deep event exploration'
  },
  {
    id: 'intel',
    label: 'Intelligence',
    shortLabel: 'Intel',
    description: 'Media and data signals'
  },
  {
    id: 'budget',
    label: 'Budget',
    shortLabel: 'Budget',
    description: 'Funding and awards'
  },
  {
    id: 'missions',
    label: 'Missions',
    shortLabel: 'Missions',
    description: 'Mission hub navigation'
  }
];

export function ArtemisMissionControl(props: ArtemisMissionControlProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeView = resolveView(searchParams.get('view')) || props.initialView;

  const selectView = useCallback(
    (nextView: ArtemisDashboardView) => {
      if (nextView === activeView) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', nextView);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    },
    [activeView, pathname, router, searchParams]
  );

  return (
    <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden xl:block">
        <DashboardSidebar items={NAV_ITEMS} activeView={activeView} onSelectView={selectView} />
      </aside>

      <div className="min-w-0 space-y-4">
        <DashboardTopBar
          activeView={activeView}
          nextLaunch={props.programSnapshot.nextLaunch}
          lastUpdatedLabel={props.lastUpdatedLabel}
        />
        <DashboardMobileViewNav items={NAV_ITEMS} activeView={activeView} onSelectView={selectView} />

        <div
          className={clsx(
            'rounded-3xl border border-stroke bg-[rgba(9,13,30,0.8)] p-4 shadow-surface backdrop-blur-xl',
            activeView === 'timeline' && 'xl:h-[calc(100vh-15.5rem)] xl:overflow-hidden'
          )}
        >
          {activeView === 'overview' ? (
            <ViewOverview
              programSnapshot={props.programSnapshot}
              missionCards={props.missionCards}
              timelineEvents={props.timelineEvents}
              articleItems={props.articleItems}
              programIntel={props.programIntel}
            />
          ) : null}

          {activeView === 'timeline' ? (
            <ViewTimeline
              programSnapshot={props.programSnapshot}
              missions={props.missions}
              timelineEvents={props.timelineEvents}
              timelineInitialState={props.timelineInitialState}
            />
          ) : null}

          {activeView === 'intel' ? (
            <ViewIntel
              articleItems={props.articleItems}
              photoItems={props.photoItems}
              socialItems={props.socialItems}
              dataItems={props.dataItems}
            />
          ) : null}

          {activeView === 'budget' ? <ViewBudget programIntel={props.programIntel} /> : null}

          {activeView === 'missions' ? (
            <ViewMissions
              missionCards={props.missionCards}
              missionLaunches={props.missionLaunches}
              missionProgress={props.missionProgress}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function resolveView(value: string | null): ArtemisDashboardView | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'overview') return 'overview';
  if (normalized === 'timeline') return 'timeline';
  if (normalized === 'intel' || normalized === 'intelligence') return 'intel';
  if (normalized === 'budget') return 'budget';
  if (normalized === 'missions') return 'missions';
  return null;
}
