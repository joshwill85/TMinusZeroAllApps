import type { LaunchTab, TabDefinition, TabVisibility } from './types';
import type { LaunchDetailV1 } from '@tminuszero/contracts';

/**
 * Default tab definitions for launch details
 */
export const DEFAULT_TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: '📋' },
  { id: 'live', label: 'Live', icon: '🔴' },
  { id: 'mission', label: 'Mission', icon: '🛰️' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚀' },
  { id: 'related', label: 'Related', icon: '📰' },
];

/**
 * Determine which tabs should be visible based on launch data
 */
export function computeTabVisibility(detail: LaunchDetailV1 | null): TabVisibility {
  if (!detail) {
    return {
      overview: true,
      live: false,
      mission: false,
      vehicle: false,
      related: false,
    };
  }

  const launch = detail.launchData ?? detail.launch;
  const now = Date.now();
  const netTime = launch?.net ? Date.parse(launch.net) : null;
  const hoursUntilLaunch = netTime ? (netTime - now) / (1000 * 60 * 60) : null;

  // Overview is always visible
  const overview = true;

  // Live tab: Show if webcast links exist, social posts exist, or within 72h of launch
  const hasWebcast = (detail.resources?.watchLinks?.length ?? 0) > 0;
  const hasSocial = (detail.social?.matchedPosts?.length ?? 0) > 0;
  const isNearLaunch = hoursUntilLaunch !== null && Math.abs(hoursUntilLaunch) < 72;
  const live = hasWebcast || hasSocial || isNearLaunch;

  // Mission tab: Show if payloads, crew, or mission description exists
  const hasPayloads = (detail.payloadManifest?.length ?? 0) > 0 || (launch?.payloads?.length ?? 0) > 0;
  const hasCrew = (launch?.crew?.length ?? 0) > 0;
  const hasMission = Boolean(launch?.mission?.name || launch?.mission?.description);
  const mission = hasPayloads || hasCrew || hasMission;

  // Vehicle tab: Show if stage/recovery data or vehicle stats exist
  const hasStages = (detail.enrichment?.firstStages?.length ?? 0) > 0;
  const hasRecovery = Boolean(detail.enrichment?.recovery);
  const hasVehicleStats = Boolean(detail.missionStats);
  const vehicle = hasStages || hasRecovery || hasVehicleStats;

  // Related tab: Show if news, events, or media exists
  const hasNews = (detail.relatedNews?.length ?? 0) > 0;
  const hasEvents = (detail.relatedEvents?.length ?? 0) > 0;
  const hasMedia = (detail.enrichment?.externalContent?.length ?? 0) > 0;
  const related = hasNews || hasEvents || hasMedia;

  return { overview, live, mission, vehicle, related };
}

/**
 * Get visible tabs in order
 */
export function getVisibleTabs(visibility: TabVisibility): TabDefinition[] {
  return DEFAULT_TABS.filter((tab) => visibility[tab.id]);
}

/**
 * Determine if live tab should show a badge (active webcast)
 */
export function shouldShowLiveBadge(detail: LaunchDetailV1 | null): boolean {
  if (!detail) return false;
  const launch = detail.launchData ?? detail.launch;
  return Boolean(launch?.webcastLive);
}

/**
 * Get default active tab based on launch state
 */
export function getDefaultActiveTab(
  detail: LaunchDetailV1 | null,
  visibility: TabVisibility
): LaunchTab {
  if (!detail) return 'overview';

  const launch = detail.launchData ?? detail.launch;
  const now = Date.now();
  const netTime = launch?.net ? Date.parse(launch.net) : null;
  const hoursUntilLaunch = netTime ? (netTime - now) / (1000 * 60 * 60) : null;

  // If launch is within 1 hour or webcast is live, default to Live tab
  if (visibility.live && (launch?.webcastLive || (hoursUntilLaunch !== null && hoursUntilLaunch > -1 && hoursUntilLaunch < 1))) {
    return 'live';
  }

  // Otherwise default to Overview
  return 'overview';
}
