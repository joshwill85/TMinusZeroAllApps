'use client';

import { useId, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import type { LaunchTab, TabDefinition } from '@tminuszero/launch-detail-ui';

type LaunchDetailTabsProps = {
  tabs: TabDefinition[];
  activeTab: LaunchTab;
  onTabChange: (tab: LaunchTab) => void;
  showBadge?: boolean;
  className?: string;
};

/**
 * Tab navigation for launch details (Web)
 * Follows ARIA tablist pattern with keyboard navigation
 */
export function LaunchDetailTabs({
  tabs,
  activeTab,
  onTabChange,
  showBadge,
  className,
}: LaunchDetailTabsProps) {
  const tablistId = useId();
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!tabs.length) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    let nextIndex = -1;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % tabs.length;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    }
    if (event.key === 'End') {
      event.preventDefault();
      nextIndex = tabs.length - 1;
    }

    if (nextIndex < 0) return;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    onTabChange(nextTab.id);
    const element = document.getElementById(getTabId(tablistId, nextTab.id));
    element?.focus();
  };

  return (
    <div
      className={clsx(
        'border-b border-stroke bg-surface-0 sticky top-0 z-20',
        className
      )}
      role="tablist"
      aria-label="Launch detail sections"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const showLiveBadge = tab.id === 'live' && showBadge;

            return (
              <button
                key={tab.id}
                id={getTabId(tablistId, tab.id)}
                role="tab"
                type="button"
                aria-selected={isActive}
                aria-controls={`${tab.id}-panel`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                className={clsx(
                  'group relative flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
                  isActive
                    ? 'text-primary'
                    : 'text-text2 hover:text-text1'
                )}
              >
                {/* Icon */}
                {tab.icon && (
                  <span className="text-base">{tab.icon}</span>
                )}

                {/* Label */}
                <span>{tab.label}</span>

                {/* Live Badge */}
                {showLiveBadge && (
                  <span className="flex h-1.5 w-1.5 items-center justify-center">
                    <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                )}

                {/* Active Indicator */}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Tab panel wrapper (Web)
 */
export function LaunchDetailTabPanel({
  id,
  activeTab,
  tabId,
  children,
}: {
  id?: string;
  activeTab: LaunchTab;
  tabId: LaunchTab;
  children: React.ReactNode;
}) {
  const isActive = activeTab === tabId;

  return (
    <div
      id={id || `${tabId}-panel`}
      role="tabpanel"
      aria-labelledby={`tab-${tabId}`}
      hidden={!isActive}
      className={clsx(
        'focus-visible:outline-none',
        !isActive && 'hidden'
      )}
    >
      {children}
    </div>
  );
}

// Helper functions

function getTabId(tablistId: string, tabId: string): string {
  return `${tablistId}-tab-${tabId}`;
}
