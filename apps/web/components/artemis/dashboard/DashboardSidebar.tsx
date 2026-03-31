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

export function DashboardSidebar({
  items,
  activeView,
  onSelectView
}: {
  items: readonly ArtemisDashboardNavItem[];
  activeView: ArtemisDashboardView;
  onSelectView: (view: ArtemisDashboardView) => void;
}) {
  return (
    <nav className="sticky top-24 rounded-3xl border border-stroke bg-[rgba(8,11,24,0.88)] p-3 shadow-surface backdrop-blur-xl" aria-label="Artemis views">
      <p className="px-2 text-[10px] uppercase tracking-[0.22em] text-text4">Program Views</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const Icon = ICON_BY_VIEW[item.id];
          const isActive = item.id === activeView;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'group flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                  isActive
                    ? 'border-primary bg-primary/10 text-text1 shadow-glow'
                    : 'border-stroke bg-surface-0/70 text-text2 hover:border-primary/50 hover:text-text1'
                )}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] text-current">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="mt-1 block text-xs text-text3">{item.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
