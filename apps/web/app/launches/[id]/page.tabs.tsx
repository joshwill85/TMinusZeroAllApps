/**
 * Tab-based Launch Detail Page (New Architecture - Web)
 *
 * This is the new tab-based implementation of the launch details page.
 * It replaces the 13+ full-width sections with 5 organized tabs.
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
import { LaunchDetailHero } from '@/components/launch/LaunchDetailHero';
import { LaunchDetailTabs, LaunchDetailTabPanel } from '@/components/launch/LaunchDetailTabs';
import { OverviewTab } from '@/components/launch/tabs';
import { buildCountdownSnapshot, formatLaunchCountdownClock } from '@tminuszero/domain';
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
  }, [detail, tabVisibility]);

  // Extract data for each tab
  const overviewData = extractOverviewData(detail);
  const liveData = extractLiveData(detail);
  const missionData = extractMissionData(detail);
  const vehicleData = extractVehicleData(detail);
  const relatedData = extractRelatedData(detail);

  // Format countdown
  const countdown = buildCountdownSnapshot(hero.net);
  const countdownText = countdown
    ? countdown.isPast
      ? 'Launched'
      : formatCountdown(countdown.totalMs)
    : null;

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
        countdown={countdownText}
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
            <LiveTabContent data={liveData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Mission Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="mission">
          <Suspense fallback={<LoadingSkeleton />}>
            <MissionTabContent data={missionData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Vehicle Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="vehicle">
          <Suspense fallback={<LoadingSkeleton />}>
            <VehicleTabContent data={vehicleData} />
          </Suspense>
        </LaunchDetailTabPanel>

        {/* Related Tab */}
        <LaunchDetailTabPanel activeTab={activeTab} tabId="related">
          <Suspense fallback={<LoadingSkeleton />}>
            <RelatedTabContent data={relatedData} />
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

function formatCountdown(totalMs: number): string {
  return formatLaunchCountdownClock(totalMs);
}

// Placeholder Tab Components (simplified versions)

function LiveTabContent({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <Section title="Live Coverage">
        {data.watchLinks.length > 0 ? (
          <div className="space-y-4">
            {data.watchLinks.slice(0, 3).map((link: any, idx: number) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-stroke bg-surface-0"
              >
                <p className="text-sm font-semibold text-text1">{link.title || link.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="Live coverage typically begins 24 hours before launch" />
        )}
      </Section>
    </div>
  );
}

function MissionTabContent({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <Section title="Mission Details">
        {data.payloadManifest.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-text2">
              {data.payloadManifest.length} payload(s)
            </p>
          </div>
        ) : (
          <EmptyState message="Mission details not yet available" />
        )}
      </Section>
    </div>
  );
}

function VehicleTabContent({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <Section title="Vehicle Details">
        {data.vehicleConfig.family ? (
          <div>
            <p className="text-xl font-bold text-text1">{data.vehicleConfig.family}</p>
          </div>
        ) : (
          <EmptyState message="Vehicle details not yet available" />
        )}
      </Section>
    </div>
  );
}

function RelatedTabContent({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <Section title="Related Content">
        {data.news.length > 0 ? (
          <div className="space-y-4">
            {data.news.slice(0, 5).map((article: any, idx: number) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-stroke bg-surface-0"
              >
                <p className="text-sm font-semibold text-text1">{article.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No related content available" />
        )}
      </Section>
    </div>
  );
}

// UI Components

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-6">
      <h2 className="text-base font-bold uppercase tracking-wider text-text1 mb-6">
        {title}
      </h2>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-text2">{message}</p>
    </div>
  );
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
