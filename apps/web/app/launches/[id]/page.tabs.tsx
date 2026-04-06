/**
 * Tab-based Launch Detail Page (Web)
 *
 * This route is an alternate tab-organized view over the canonical full-page
 * launch detail surface in `page.tsx`. Keep feature parity here where practical,
 * but treat the full page as the source of product truth.
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { LaunchTab } from '@tminuszero/launch-detail-ui';
import {
  computeTabVisibility,
  getVisibleTabs,
  shouldShowLiveBadge,
  getDefaultActiveTab,
  getLaunchHeroModel,
  extractOverviewData,
  extractLiveData,
  extractMissionData,
  extractVehicleData,
  extractRelatedData,
} from '@tminuszero/launch-detail-ui';
import { Countdown } from '@/components/Countdown';
import { LaunchDetailHero } from '@/components/launch/LaunchDetailHero';
import { LaunchDetailTabs, LaunchDetailTabPanel } from '@/components/launch/LaunchDetailTabs';
import { LiveTab, MissionTab, OverviewTab, RelatedTab, VehicleTab } from '@/components/launch/tabs';
import type { LaunchDetailV1 } from '@tminuszero/contracts';

type LaunchDetailTabsPageProps = {
  detail: LaunchDetailV1;
};

export default function LaunchDetailTabsPage({ detail }: LaunchDetailTabsPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hero = getLaunchHeroModel(detail);

  // Tab state
  const tabVisibility = computeTabVisibility(detail);
  const visibleTabs = getVisibleTabs(tabVisibility);
  const defaultTab = getDefaultActiveTab(detail, tabVisibility);

  // Get initial tab from URL or default
  const urlTab = searchParams.get('tab') as LaunchTab | null;
  const initialTab =
    urlTab && visibleTabs.some((t) => t.id === urlTab) ? urlTab : defaultTab;

  const [activeTab, setActiveTab] = useState<LaunchTab>(initialTab);
  const showLiveBadge = shouldShowLiveBadge(detail);

  // Update URL when tab changes
  const handleTabChange = (tab: LaunchTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Update default tab when data loads
  useEffect(() => {
    const newDefault = getDefaultActiveTab(detail, tabVisibility);
    if (newDefault !== activeTab && visibleTabs.some((t) => t.id === newDefault)) {
      setActiveTab(newDefault);
    }
  }, [activeTab, detail, tabVisibility, visibleTabs]);

  // Extract data for each tab
  const overviewData = extractOverviewData(detail);
  const liveData = extractLiveData(detail);
  const missionData = extractMissionData(detail);
  const vehicleData = extractVehicleData(detail);
  const relatedData = extractRelatedData(detail);

  // Format NET time
  const netTime = hero.net ? new Date(hero.net).toLocaleString() : null;

  return (
    <div className="min-h-screen bg-surface-0">
      {/* Hero Section */}
      <LaunchDetailHero
        backgroundImage={hero.backgroundImage}
        launchName={hero.launchName}
        provider={hero.provider}
        vehicle={hero.vehicle}
        status={hero.status}
        statusTone={getStatusTone(hero.status)}
        tier={hero.tier}
        webcastLive={hero.webcastLive}
        countdown={hero.net ? <Countdown net={hero.net} pastLabel="Launched" /> : null}
        netTime={netTime}
        location={hero.location}
        actionButtons={
          <div className="flex gap-3">
            {/* Placeholder action buttons */}
            <button className="px-6 py-3 text-sm font-bold rounded-xl bg-primary text-black hover:bg-primary/90 transition">
              Follow
            </button>
            <button className="px-6 py-3 text-sm font-bold rounded-xl border border-stroke bg-surface-1 text-text1 hover:bg-surface-2 transition">
              📅 Calendar
            </button>
            <button className="px-6 py-3 text-sm font-bold rounded-xl border border-stroke bg-surface-1 text-text1 hover:bg-surface-2 transition">
              📍 AR View
            </button>
            <button className="px-6 py-3 text-sm font-bold rounded-xl border border-stroke bg-surface-1 text-text1 hover:bg-surface-2 transition">
              Share
            </button>
          </div>
        }
      />

      {/* Tab Navigation */}
      <LaunchDetailTabs
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        showBadge={showLiveBadge}
      />

      {/* Tab Content */}
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
        {/* Overview Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="overview">
          <Suspense fallback={<LoadingSkeleton />}>
            <OverviewTab data={overviewData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Live Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="live">
          <Suspense fallback={<LoadingSkeleton />}>
            <LiveTab data={liveData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Mission Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="mission">
          <Suspense fallback={<LoadingSkeleton />}>
            <MissionTab data={missionData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Vehicle Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="vehicle">
          <Suspense fallback={<LoadingSkeleton />}>
            <VehicleTab data={vehicleData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Related Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="related">
          <Suspense fallback={<LoadingSkeleton />}>
            <RelatedTab data={relatedData} />
          </Suspense>
        </LaunchDetailTabPanel>
      </div>
    </div>
  );
}

// Helper functions

function getStatusTone(status: string | null): 'default' | 'success' | 'warning' | 'danger' {
  if (!status) return 'default';
  const lower = status.toLowerCase();
  if (lower.includes('success')) return 'success';
  if (lower.includes('hold') || lower.includes('tbd')) return 'warning';
  if (lower.includes('fail') || lower.includes('scrub')) return 'danger';
  return 'default';
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-32 rounded-2xl bg-surface-1" />
      <div className="h-64 rounded-2xl bg-surface-1" />
      <div className="h-48 rounded-2xl bg-surface-1" />
    </div>
  );
}
