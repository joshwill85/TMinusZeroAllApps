'use client';

import clsx from 'clsx';
import type { ComponentType } from 'react';
import type { ArtemisDashboardView } from '@/lib/types/artemis';
import type { ArtemisDashboardNavItem } from './types';
import { BudgetIcon, IntelIcon, MissionsIcon, OverviewIcon, TimelineIcon } from './DashboardIcons';

const ICON_BY_VIEW: Record<ArtemisDashboardView, ComponentType<{ className?: string }>> = {
  overview: OverviewIcon,
  timeline: TimelineIcon,
  intel: IntelIcon,
  budget: BudgetIcon,
  missions: MissionsIcon
};

export function DashboardMobileViewNav({
  items,
  activeView,
  onSelectView
}: {
  items: readonly ArtemisDashboardNavItem[];
  activeView: ArtemisDashboardView;
  onSelectView: (view: ArtemisDashboardView) => void;
}) {
  return (
    <div className="sticky top-12 z-30 -mx-1 rounded-2xl border border-stroke bg-[rgba(8,11,24,0.9)] p-1.5 shadow-surface backdrop-blur-xl xl:hidden">
      <nav aria-label="Artemis mobile views" className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {items.map((item) => {
          const Icon = ICON_BY_VIEW[item.id];
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                isActive
                  ? 'border-primary bg-primary/10 text-text1'
                  : 'border-stroke bg-surface-0/70 text-text2 hover:border-primary/50 hover:text-text1'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
