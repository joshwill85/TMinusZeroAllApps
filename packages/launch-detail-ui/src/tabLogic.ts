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
  const isNearLaunch = hoursUntilLaunch !== null && Math.abs(hoursUntilLaunch) < 72;
  const live = hasWebcast || hasSocial || isNearLaunch;

  const hasPayloads = detail.payloadManifest.length > 0 || (launch?.payloads?.length ?? 0) > 0;
  const hasCrew = getLaunchCrew(detail).length > 0;
  const hasMission = Boolean(getLaunchMissionDescription(detail));
  const mission = hasPayloads || hasCrew || hasMission;

  const hasStages = (detail.enrichment?.firstStages?.length ?? 0) > 0;
  const hasRecovery = (detail.enrichment?.recovery?.length ?? 0) > 0;
  const hasVehicleStats = Boolean(detail.missionStats);
  const vehicle = hasStages || hasRecovery || hasVehicleStats;

  const hasNews = detail.relatedNews.length > 0;
  const hasEvents = detail.relatedEvents.length > 0;
  const hasMedia = (detail.enrichment?.externalContent?.length ?? 0) > 0;
  const related = hasNews || hasEvents || hasMedia;

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
