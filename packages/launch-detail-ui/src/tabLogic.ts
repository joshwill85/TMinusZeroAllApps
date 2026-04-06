import type { LaunchDetailV1 } from '@tminuszero/contracts';
import type { LaunchTab, TabDefinition, TabVisibility } from './types';
import {
  getLaunchCrew,
  getLaunchData,
  getLaunchHeroModel,
  getLaunchMissionDescription,
  getLaunchSocialPosts,
  getLaunchWatchLinks
} from './detailModel';

export const DEFAULT_TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview', icon: '📋' },
  { id: 'live', label: 'Live', icon: '🔴' },
  { id: 'mission', label: 'Mission', icon: '🛰️' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚀' },
  { id: 'related', label: 'Related', icon: '📰' }
];

export function computeTabVisibility(detail: LaunchDetailV1 | null): TabVisibility {
  if (!detail) {
    return {
      overview: true,
      live: false,
      mission: false,
      vehicle: false,
      related: false
    };
  }

  const hero = getLaunchHeroModel(detail);
  const launch = getLaunchData(detail);
  const now = Date.now();
  const netTime = hero.net ? Date.parse(hero.net) : null;
  const hoursUntilLaunch = netTime ? (netTime - now) / (1000 * 60 * 60) : null;

  const overview = true;
  const hasWebcast = getLaunchWatchLinks(detail).length > 0;
  const hasSocial = getLaunchSocialPosts(detail).length > 0;
  const hasLaunchUpdates = detail.launchUpdates.length > 0;
  const hasWeather = Boolean(detail.weather?.summary || detail.weather?.cards?.length || detail.weather?.concerns?.length);
  const hasFaaAdvisories = (detail.enrichment?.faaAdvisories?.length ?? 0) > 0;
  const hasJepScore = Boolean(detail.enrichment?.hasJepScore);
  const isNearLaunch = hoursUntilLaunch !== null && Math.abs(hoursUntilLaunch) < 72;
  const live = hasWebcast || hasSocial || hasLaunchUpdates || hasWeather || hasFaaAdvisories || hasJepScore || isNearLaunch;

  const hasPayloads = detail.payloadManifest.length > 0 || (launch?.payloads?.length ?? 0) > 0;
  const hasCrew = getLaunchCrew(detail).length > 0;
  const hasMission = Boolean(getLaunchMissionDescription(detail));
  const hasInventory =
    Boolean(detail.objectInventory?.summaryBadges?.length) ||
    Boolean(detail.objectInventory?.payloadObjects?.length) ||
    Boolean(detail.objectInventory?.nonPayloadObjects?.length);
  const mission = hasPayloads || hasCrew || hasMission || hasInventory;

  const hasStages = (detail.enrichment?.firstStages?.length ?? 0) > 0;
  const hasRecovery = (detail.enrichment?.recovery?.length ?? 0) > 0;
  const hasVehicleStats = Boolean(detail.missionStats);
  const vehicle = hasStages || hasRecovery || hasVehicleStats;

  const hasNews = detail.relatedNews.length > 0;
  const hasEvents = detail.relatedEvents.length > 0;
  const hasMedia = (detail.enrichment?.externalContent?.length ?? 0) > 0;
  const hasVehicleTimeline = detail.vehicleTimeline.length > 0;
  const hasResources = Boolean(detail.resources?.externalLinks?.length || detail.resources?.missionResources?.length);
  const related = hasNews || hasEvents || hasMedia || hasVehicleTimeline || hasResources;

  return { overview, live, mission, vehicle, related };
}

export function getVisibleTabs(visibility: TabVisibility): TabDefinition[] {
  return DEFAULT_TABS.filter((tab) => visibility[tab.id]);
}

export function shouldShowLiveBadge(detail: LaunchDetailV1 | null): boolean {
  if (!detail) return false;
  return getLaunchHeroModel(detail).webcastLive;
}

export function getDefaultActiveTab(
  detail: LaunchDetailV1 | null,
  visibility: TabVisibility
): LaunchTab {
  if (!detail) return 'overview';

  const hero = getLaunchHeroModel(detail);
  const now = Date.now();
  const netTime = hero.net ? Date.parse(hero.net) : null;
  const hoursUntilLaunch = netTime ? (netTime - now) / (1000 * 60 * 60) : null;

  if (visibility.live && (hero.webcastLive || (hoursUntilLaunch !== null && hoursUntilLaunch > -1 && hoursUntilLaunch < 1))) {
    return 'live';
  }

  return 'overview';
}
