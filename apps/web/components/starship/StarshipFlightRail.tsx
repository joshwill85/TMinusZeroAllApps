'use client';

import { useId, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

export type StarshipMissionRailItem = {
  id: string;
  label: string;
  subtitle?: string;
  status?: string;
  nextNet?: string | null;
  launchCount?: number;
  disabled?: boolean;
  panelId?: string;
};

export type StarshipMissionRailProps = {
  missions: readonly StarshipMissionRailItem[];
  value: string | null;
  onChange?: (missionId: string) => void;
  ariaLabel?: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
};

export function StarshipMissionRail({
  missions,
  value,
  onChange,
  ariaLabel = 'Mission selection',
  className,
  orientation = 'vertical'
}: StarshipMissionRailProps) {
  const tablistId = useId();
  const missionList = useMemo(() => missions.filter(Boolean), [missions]);
  const activeIndex = missionList.findIndex((mission) => mission.id === value);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!missionList.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    let nextIndex = -1;
    const isHorizontal = orientation === 'horizontal';

    if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = findNextEnabledMissionIndex(missionList, -1, 1);
    }
    if (event.key === 'End') {
      event.preventDefault();
      nextIndex = findNextEnabledMissionIndex(missionList, 0, -1);
    }
    if (event.key === (isHorizontal ? 'ArrowRight' : 'ArrowDown')) {
      event.preventDefault();
      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, 1);
    }
    if (event.key === (isHorizontal ? 'ArrowLeft' : 'ArrowUp')) {
      event.preventDefault();
      nextIndex = findNextEnabledMissionIndex(missionList, currentIndex, -1);
    }

    if (nextIndex < 0) return;
    const nextMission = missionList[nextIndex];
    if (!nextMission || nextMission.disabled) return;
    onChange?.(nextMission.id);
    const element = document.getElementById(getMissionTabId(tablistId, nextMission.id));
    element?.focus();
  };

  return (
    <section className={clsx('rounded-2xl border border-stroke bg-surface-1 p-2', className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation={orientation}
        onKeyDown={handleKeyDown}
        className={clsx('gap-2', orientation === 'horizontal' ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col')}
      >
        {missionList.map((mission) => {
          const isSelected = mission.id === value;
          const nextNetLabel = formatMissionNetLabel(mission.nextNet || null);
          return (
            <button
              key={mission.id}
              id={getMissionTabId(tablistId, mission.id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={mission.panelId}
              tabIndex={isSelected ? 0 : -1}
              disabled={mission.disabled}
              onClick={() => {
                if (mission.disabled) return;
                onChange?.(mission.id);
              }}
              className={clsx(
                'rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                mission.disabled && 'cursor-not-allowed opacity-60',
                isSelected
                  ? 'border-primary bg-[rgba(34,211,238,0.1)] text-text1 shadow-glow'
                  : 'border-stroke bg-surface-0 text-text2 hover:border-primary/60 hover:text-text1'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-semibold">{mission.label}</div>
                {typeof mission.launchCount === 'number' ? (
                  <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                    {mission.launchCount}
                  </span>
                ) : null}
              </div>
              {mission.subtitle ? <div className="mt-1 truncate text-xs text-text3">{mission.subtitle}</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {mission.status ? (
                  <span className="rounded-full border border-stroke px-2 py-0.5 uppercase tracking-[0.08em] text-text3">{mission.status}</span>
                ) : null}
                {nextNetLabel ? <span className="text-text3">Next: {nextNetLabel}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function findNextEnabledMissionIndex(items: readonly StarshipMissionRailItem[], start: number, direction: 1 | -1) {
  if (!items.length) return -1;
  for (let step = 1; step <= items.length; step += 1) {
    const index = (start + direction * step + items.length) % items.length;
    const item = items[index];
    if (item && !item.disabled) return index;
  }
  return -1;
}

function getMissionTabId(tablistId: string, missionId: string) {
  return `${tablistId}-${missionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function formatMissionNetLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}
