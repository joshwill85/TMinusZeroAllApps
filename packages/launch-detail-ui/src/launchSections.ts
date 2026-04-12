import type { LaunchDetailV1 } from '@tminuszero/contracts';
import {
  getLaunchData,
  getLaunchMissionDescription,
  getLaunchMissionName,
  getLaunchMissionTimeline,
  getLaunchRecovery,
  getLaunchSocialPosts,
  getLaunchVehicle,
  getLaunchWatchLinks,
  getLaunchWeatherSummary
} from './detailModel';

export type LaunchSectionId = 'overview' | 'timeline' | 'viewing' | 'vehicle' | 'coverage' | 'details';
export type VisibleLaunchSectionId = Exclude<LaunchSectionId, 'details'>;

export type LaunchHeroUtilityChip = {
  id: 'visibility' | 'weather' | 'recovery';
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning';
};

export type LaunchHeroTimelineSummary = {
  label: string;
  time: string | null;
  description: string | null;
};

export type LaunchHeroSummary = {
  title: string;
  subtitle: string | null;
  statusLabel: string | null;
  rawStatusLabel: string | null;
  missionSummary: string | null;
  net: string | null;
  watchUrl: string | null;
  utilityChips: LaunchHeroUtilityChip[];
  nextEvent: LaunchHeroTimelineSummary | null;
};

export const CANONICAL_LAUNCH_SECTION_ORDER: LaunchSectionId[] = [
  'overview',
  'timeline',
  'viewing',
  'vehicle',
  'coverage',
  'details'
];

export const PRIMARY_LAUNCH_SECTION_ORDER: VisibleLaunchSectionId[] = [
  'overview',
  'timeline',
  'viewing',
  'vehicle',
  'coverage'
];

export function resolveLaunchPrimaryTitle(missionName?: string | null, launchName?: string | null) {
  return normalizeText(missionName) || normalizeText(launchName) || 'Launch';
}

export function buildLaunchHeroSubtitleLine({
  provider,
  vehicle,
  padLabel
}: {
  provider?: string | null;
  vehicle?: string | null;
  padLabel?: string | null;
}) {
  const parts = [normalizeText(provider), normalizeText(vehicle), normalizeText(padLabel)].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : null;
}

export function normalizePrimaryLaunchStatus(status?: string | null) {
  const normalized = normalizeText(status);
  if (!normalized) return null;

  const upper = normalized.toUpperCase();
  if (upper.includes('SCRUB')) return 'Scrubbed';
  if (upper.includes('DELAY')) return 'Delayed';
  if (upper === 'GO ROUTINE' || upper.startsWith('GO ')) return 'GO';

  return normalized;
}

export function getNextLaunchTimelineSummary(
  items: Array<{ label: string; time?: string | null; description?: string | null; phase?: string | null }>
): LaunchHeroTimelineSummary | null {
  if (!items.length) return null;

  const preferred =
    items.find((item) => item.phase === 'prelaunch') ||
    items.find((item) => item.phase === 'timeline') ||
    items[0] ||
    null;

  if (!preferred) return null;

  return {
    label: preferred.label,
    time: preferred.time ?? null,
    description: preferred.description ?? null
  };
}

export function buildLaunchHeroSummary(detail: LaunchDetailV1): LaunchHeroSummary {
  const launch = getLaunchData(detail);
  const title = resolveLaunchPrimaryTitle(getLaunchMissionName(detail), launch?.name ?? detail.launch.name);
  const subtitle = buildLaunchHeroSubtitleLine({
    provider: launch?.provider ?? detail.launch.provider ?? null,
    vehicle: getLaunchVehicle(detail),
    padLabel: launch?.pad?.shortCode ?? launch?.pad?.name ?? detail.launch.padName ?? null
  });
  const rawStatusLabel = launch?.status ?? detail.launch.status ?? null;
  const weatherSummary = summarizeText(getLaunchWeatherSummary(detail));
  const recovery = getLaunchRecovery(detail);
  const missionTimeline = getLaunchMissionTimeline(detail);
  const watchUrl = getLaunchWatchLinks(detail)[0]?.url ?? null;

  const utilityChips: LaunchHeroUtilityChip[] = [];

  if (detail.enrichment?.hasJepScore) {
    utilityChips.push({
      id: 'visibility',
      label: 'Visibility',
      value: 'Check JEP',
      tone: 'default'
    });
  }

  if (weatherSummary) {
    utilityChips.push({
      id: 'weather',
      label: 'Weather',
      value: weatherSummary,
      tone: 'default'
    });
  }

  const recoveryLabel = normalizeText(
    recovery?.booster?.location || recovery?.booster?.type || recovery?.spacecraft?.summary || recovery?.spacecraft?.detail
  );
  if (recoveryLabel) {
    utilityChips.push({
      id: 'recovery',
      label: 'Recovery',
      value: recoveryLabel,
      tone: 'success'
    });
  }

  return {
    title,
    subtitle,
    statusLabel: normalizePrimaryLaunchStatus(rawStatusLabel),
    rawStatusLabel,
    missionSummary: normalizeText(getLaunchMissionDescription(detail)),
    net: launch?.net ?? detail.launch.net ?? null,
    watchUrl,
    utilityChips,
    nextEvent: getNextLaunchTimelineSummary(missionTimeline)
  };
}

export function getVisibleLaunchSections(detail: LaunchDetailV1 | null): VisibleLaunchSectionId[] {
  if (!detail) {
    return ['overview'];
  }

  const launch = getLaunchData(detail);
  const sections = new Set<VisibleLaunchSectionId>(['overview']);

  if (getLaunchMissionTimeline(detail).length > 0 || detail.launchUpdates.length > 0) {
    sections.add('timeline');
  }

  if (
    detail.enrichment?.hasJepScore ||
    detail.enrichment?.faaAdvisories?.length ||
    detail.weather?.summary ||
    detail.weather?.cards?.length ||
    detail.weather?.concerns?.length
  ) {
    sections.add('viewing');
  }

  if (
    detail.enrichment?.firstStages?.length ||
    detail.enrichment?.recovery?.length ||
    detail.vehicleTimeline.length ||
    detail.missionStats
  ) {
    sections.add('vehicle');
  }

  if (
    getLaunchWatchLinks(detail).length ||
    getLaunchSocialPosts(detail).length ||
    detail.relatedNews.length ||
    detail.relatedEvents.length ||
    detail.resources?.missionResources?.length ||
    detail.resources?.externalLinks?.length
  ) {
    sections.add('coverage');
  }

  return PRIMARY_LAUNCH_SECTION_ORDER.filter((sectionId) => sections.has(sectionId));
}

function normalizeText(value?: string | null) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

function summarizeText(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0];
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trimEnd()}...` : firstSentence;
}
