import type { LaunchDetailV1 } from '@tminuszero/contracts';

type LaunchDetailLaunchData = NonNullable<LaunchDetailV1['launchData']>;

export type LaunchProgramSummary = {
  id: string;
  name: string;
  description?: string;
};

export type LaunchCrewSummary = {
  name: string;
  role: string;
  nationality: string;
};

export type LaunchWatchLinkSummary = {
  title: string;
  label: string;
  url: string;
  meta: string | null;
  image?: string;
  imageUrl?: string | null;
  host?: string | null;
  kind?: string | null;
};

export type LaunchSocialPostSummary = {
  id: string;
  kind: 'matched' | 'feed';
  platform: string;
  url: string;
  postId?: string | null;
  handle?: string | null;
  matchedAt?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
};

export type LaunchUpdateSummary = {
  id: string;
  timestamp: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  details: string[];
  tags: string[];
};

export type LaunchResourceLinks = {
  pressKit?: string | null;
  missionPage?: string | null;
};

export type LaunchPayloadSummary = {
  id: string;
  kind: 'payload' | 'spacecraft';
  name: string;
  subtitle: string | null;
  destination: string | null;
  deploymentStatus: string | null;
  operator: string | null;
  manufacturer: string | null;
  description: string | null;
  landingSummary: string | null;
  dockingSummary: string | null;
  infoUrl: string | null;
  wikiUrl: string | null;
};

export type LaunchInventoryObjectSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  lines: string[];
};

export type LaunchObjectInventorySummary = {
  totalObjectCount: number;
  payloadObjectCount: number;
  nonPayloadObjectCount: number;
  summaryBadges: string[];
  payloadObjects: LaunchInventoryObjectSummary[];
  nonPayloadObjects: LaunchInventoryObjectSummary[];
};

export type LaunchRecoverySummary = {
  booster: {
    type: string | undefined;
    location: string | null;
  } | null;
  fairing: {
    recovery: boolean;
  } | null;
};

export type LaunchMissionStatsSummary = NonNullable<LaunchDetailV1['missionStats']>;

export type LaunchVehicleTimelineSummary = NonNullable<LaunchDetailV1['vehicleTimeline']>[number];

export type LaunchMediaItem = {
  type?: string | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  url?: string | null;
};

export type LaunchEventSummary = {
  name: string;
  type?: string;
  date?: string;
  location?: string;
  url?: string | null;
  image?: string | null;
  webcastLive?: boolean | null;
};

export type LaunchNewsSummary = {
  title: string;
  summary: string;
  url: string;
  image?: string;
  source: string;
  date: string;
};

export type LaunchHeroModel = {
  backgroundImage: string | null;
  launchName: string;
  provider: string | null;
  vehicle: string | null;
  status: string | null;
  tier: string | null;
  webcastLive: boolean;
  location: string | null;
  net: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeProgram(program: unknown, index: number): LaunchProgramSummary | null {
  if (!isRecord(program)) return null;
  const name = readString(program, 'name');
  if (!name) return null;
  const rawId = program.id;
  const id =
    typeof rawId === 'string' || typeof rawId === 'number'
      ? String(rawId)
      : `program-${index}`;
  const description = readString(program, 'description') ?? undefined;
  return description ? { id, name, description } : { id, name };
}

function normalizeCrewMember(member: unknown): LaunchCrewSummary | null {
  if (!isRecord(member)) return null;
  const name = readString(member, 'name');
  if (!name) return null;
  return {
    name,
    role: readString(member, 'role') ?? readString(member, 'type') ?? 'Crew member',
    nationality: readString(member, 'nationality') ?? 'Unknown'
  };
}

function findResourceUrl(
  detail: LaunchDetailV1,
  matchers: Array<(label: string) => boolean>
): string | null {
  const missionResources = detail.resources?.missionResources ?? [];
  for (const item of missionResources) {
    const title = String(item.title || '').trim().toLowerCase();
    if (title && matchers.some((matcher) => matcher(title))) {
      return item.url;
    }
  }

  const externalLinks = detail.resources?.externalLinks ?? [];
  for (const item of externalLinks) {
    const label = String(item.label || '').trim().toLowerCase();
    if (label && matchers.some((matcher) => matcher(label))) {
      return item.url;
    }
  }

  return null;
}

export function getLaunchData(detail: LaunchDetailV1): LaunchDetailLaunchData | null {
  return detail.launchData ?? null;
}

export function getLaunchVehicle(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.vehicle ?? detail.launch.rocketName ?? null;
}

export function getLaunchPadName(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.pad?.name ?? launch?.padName ?? detail.launch.padName ?? null;
}

export function getLaunchLocation(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.pad?.locationName ?? launch?.padLocation ?? detail.launch.padLocation ?? null;
}

export function getLaunchMissionName(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.mission?.name ?? detail.launch.name ?? null;
}

export function getLaunchMissionDescription(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.missionSummary ?? launch?.mission?.description ?? launch?.mission?.name ?? detail.launch.mission ?? null;
}

export function getLaunchOrbit(detail: LaunchDetailV1): string | null {
  return getLaunchData(detail)?.mission?.orbit ?? null;
}

export function getLaunchWeatherSummary(detail: LaunchDetailV1): string | null {
  const launch = getLaunchData(detail);
  return launch?.weatherSummary ?? detail.launch.weatherSummary ?? null;
}

export function getLaunchPrograms(detail: LaunchDetailV1): LaunchProgramSummary[] {
  const programs = getLaunchData(detail)?.programs ?? [];
  return programs
    .map((program, index) => normalizeProgram(program, index))
    .filter((program): program is LaunchProgramSummary => Boolean(program));
}

export function getLaunchCrew(detail: LaunchDetailV1): LaunchCrewSummary[] {
  const crew = getLaunchData(detail)?.crew ?? [];
  return crew
    .map((member) => normalizeCrewMember(member))
    .filter((member): member is LaunchCrewSummary => Boolean(member));
}

export function getLaunchWatchLinks(detail: LaunchDetailV1): LaunchWatchLinkSummary[] {
  return (detail.resources?.watchLinks ?? []).map((link) => ({
    title: link.label,
    label: link.label,
    url: link.url,
    meta: link.meta ?? null,
    image: link.imageUrl ?? undefined,
    imageUrl: link.imageUrl ?? null,
    host: link.host ?? null,
    kind: link.kind ?? null
  }));
}

export function getLaunchSocialPosts(detail: LaunchDetailV1): LaunchSocialPostSummary[] {
  const rows: LaunchSocialPostSummary[] = [];
  const matchedPost = detail.social?.matchedPost;
  if (matchedPost) {
    rows.push({
      id: matchedPost.url,
      kind: 'matched',
      platform: matchedPost.platform,
      url: matchedPost.url,
      postId: matchedPost.postId ?? null,
      handle: matchedPost.handle ?? null,
      matchedAt: matchedPost.matchedAt ?? null,
      title: matchedPost.title,
      subtitle: matchedPost.subtitle ?? null,
      description: matchedPost.description ?? null
    });
  }
  for (const feed of detail.social?.providerFeeds ?? []) {
    rows.push({
      id: feed.id,
      kind: 'feed',
      platform: feed.platform,
      url: feed.url,
      postId: null,
      handle: feed.handle ?? null,
      matchedAt: null,
      title: feed.title,
      subtitle: feed.subtitle ?? null,
      description: feed.description ?? null
    });
  }
  return rows;
}

export function getLaunchUpdates(detail: LaunchDetailV1): LaunchUpdateSummary[] {
  return detail.launchUpdates.map((update) => ({
    id: update.id,
    timestamp: update.detectedAt ?? null,
    field: update.title,
    oldValue: null,
    newValue: update.details[0] ?? null,
    details: update.details,
    tags: update.tags
  }));
}

export function getLaunchPayloadManifest(detail: LaunchDetailV1): LaunchPayloadSummary[] {
  return detail.payloadManifest.map((payload) => ({
    id: payload.id,
    kind: payload.kind,
    name: payload.title,
    subtitle: payload.subtitle ?? null,
    destination: payload.destination ?? null,
    deploymentStatus: payload.deploymentStatus ?? null,
    operator: payload.operator ?? null,
    manufacturer: payload.manufacturer ?? null,
    description: payload.description ?? null,
    landingSummary: payload.landingSummary ?? null,
    dockingSummary: payload.dockingSummary ?? null,
    infoUrl: payload.infoUrl ?? null,
    wikiUrl: payload.wikiUrl ?? null
  }));
}

export function getLaunchObjectInventory(detail: LaunchDetailV1): LaunchObjectInventorySummary | null {
  if (!detail.objectInventory) return null;
  const payloadObjects = detail.objectInventory.payloadObjects.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle ?? null,
    lines: item.lines ?? []
  }));
  const nonPayloadObjects = detail.objectInventory.nonPayloadObjects.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle ?? null,
    lines: item.lines ?? []
  }));
  const totalObjectCount = payloadObjects.length + nonPayloadObjects.length;
  return {
    totalObjectCount,
    payloadObjectCount: payloadObjects.length,
    nonPayloadObjectCount: nonPayloadObjects.length,
    summaryBadges: detail.objectInventory.summaryBadges,
    payloadObjects,
    nonPayloadObjects
  };
}

export function getLaunchRecovery(detail: LaunchDetailV1): LaunchRecoverySummary | null {
  const recovery = detail.enrichment?.recovery ?? [];
  const booster = recovery.find((item) => item.role === 'booster');
  const fairing = recovery.find((item) => item.role !== 'booster');
  if (!booster && !fairing) return null;
  return {
    booster: booster
      ? {
          type: booster.landingTypeName ?? booster.title ?? undefined,
          location: booster.landingLocationName ?? booster.returnSite ?? null
        }
      : null,
    fairing: fairing
      ? {
          recovery: Boolean(fairing.attempt ?? fairing.success)
        }
      : null
  };
}

export function getLaunchMissionStats(detail: LaunchDetailV1): LaunchMissionStatsSummary | null {
  const stats = detail.missionStats;
  if (!stats) return null;
  return stats.cards.length > 0 || stats.boosterCards.length > 0 || stats.bonusInsights.length > 0 ? stats : null;
}

export function getLaunchMedia(detail: LaunchDetailV1): LaunchMediaItem[] {
  return (detail.enrichment?.externalContent ?? []).flatMap((item) => {
    if (item.resources.length > 0) {
      return item.resources.map((resource) => ({
        type: resource.kind ?? item.contentType,
        title: resource.label ?? item.title ?? null,
        name: item.title ?? null,
        description: null,
        url: resource.url
      }));
    }
    return [
      {
        type: item.contentType,
        title: item.title ?? null,
        name: item.title ?? null,
        description: null,
        url: item.launchPageUrl ?? null
      }
    ];
  });
}

export function getLaunchEvents(detail: LaunchDetailV1): LaunchEventSummary[] {
  return detail.relatedEvents.map((event) => ({
    name: event.name,
    type: event.typeName ?? undefined,
    date: event.date ?? undefined,
    location: event.locationName ?? undefined,
    url: event.url ?? null,
    image: event.imageUrl ?? null,
    webcastLive: event.webcastLive ?? null
  }));
}

export function getLaunchNews(detail: LaunchDetailV1): LaunchNewsSummary[] {
  return detail.relatedNews.map((item) => ({
    title: item.title,
    summary: item.summary ?? '',
    url: item.url,
    image: item.imageUrl ?? undefined,
    source: item.newsSite ?? 'News',
    date: item.publishedAt ?? ''
  }));
}

export function getLaunchResourceLinks(detail: LaunchDetailV1): LaunchResourceLinks | null {
  const pressKit = findResourceUrl(detail, [
    (label) => label.includes('press kit'),
    (label) => label.includes('media kit')
  ]);
  const missionPage = findResourceUrl(detail, [
    (label) => label.includes('mission page'),
    (label) => label.includes('launch page'),
    (label) => label.includes('mission overview')
  ]);
  if (!pressKit && !missionPage) return null;
  return { pressKit, missionPage };
}

export function getLaunchVehicleTimeline(detail: LaunchDetailV1): LaunchVehicleTimelineSummary[] {
  return detail.vehicleTimeline ?? [];
}

export function getLaunchHeroModel(detail: LaunchDetailV1): LaunchHeroModel {
  const launch = getLaunchData(detail);
  return {
    backgroundImage: launch?.image?.full ?? launch?.image?.thumbnail ?? launch?.imageUrl ?? detail.launch.imageUrl ?? null,
    launchName: launch?.name ?? detail.launch.name,
    provider: launch?.provider ?? detail.launch.provider ?? null,
    vehicle: getLaunchVehicle(detail),
    status: launch?.status ?? detail.launch.status ?? null,
    tier: launch?.tier ?? null,
    webcastLive: Boolean(launch?.webcastLive),
    location: getLaunchLocation(detail),
    net: launch?.net ?? detail.launch.net ?? null
  };
}
