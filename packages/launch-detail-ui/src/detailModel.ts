import type { LaunchDetailV1 } from '@tminuszero/contracts';
import { selectPreferredResponsiveLaunchExternalResources } from './externalResources';

type LaunchDetailLaunchData = NonNullable<LaunchDetailV1['launchData']>;
type LaunchExternalContentItem = NonNullable<LaunchDetailV1['enrichment']>['externalContent'][number];
type LaunchExternalContentResource = LaunchExternalContentItem['resources'][number];

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

export type LaunchPayloadListSummary = {
  id: string;
  name: string;
  subtitle: string | null;
};

export type LaunchInventoryObjectSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  lines: string[];
};

export type LaunchObjectInventoryStatusSummary = {
  catalogState: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastNonEmptyAt: string | null;
  latestSnapshotHash: string | null;
  message: string | null;
};

export type LaunchObjectInventoryReconciliationSummary = {
  manifestPayloadCount: number | null;
  satcatPayloadCount: number | null;
  satcatPayloadsFilterCount: number | null;
  satcatTotalCount: number | null;
  satcatTypeCounts: {
    PAY: number | null;
    RB: number | null;
    DEB: number | null;
    UNK: number | null;
  } | null;
  deltaManifestVsSatcatPayload: number | null;
};

export type LaunchObjectInventorySummary = {
  launchDesignator: string | null;
  totalObjectCount: number;
  payloadObjectCount: number;
  nonPayloadObjectCount: number;
  status: LaunchObjectInventoryStatusSummary | null;
  reconciliation: LaunchObjectInventoryReconciliationSummary | null;
  summaryBadges: string[];
  payloadObjects: LaunchInventoryObjectSummary[];
  nonPayloadObjects: LaunchInventoryObjectSummary[];
};

export type LaunchRecoverySummary = {
  booster: {
    type: string | undefined;
    location: string | null;
  } | null;
  spacecraft: {
    summary: string;
    detail: string | null;
  } | null;
};

export type LaunchMissionStatsSummary = NonNullable<LaunchDetailV1['missionStats']>;

export type LaunchVehicleTimelineSummary = NonNullable<LaunchDetailV1['vehicleTimeline']>[number];

export type LaunchMediaItem = {
  type?: string | null;
  kind?: string | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  host?: string | null;
};

export type LaunchMissionTimelineItem = {
  id: string;
  label: string;
  time: string | null;
  description: string | null;
  kind: string | null;
  phase: 'prelaunch' | 'postlaunch' | 'timeline' | null;
  sourceTitle?: string | null;
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
  id: string;
  title: string;
  summary: string;
  url: string;
  image?: string;
  source: string;
  date: string;
  itemType?: 'article' | 'blog' | 'report' | null;
  authors: string[];
  featured: boolean;
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

function readInteger(record: Record<string, unknown>, key: string): number | null {
  const value = readNumber(record, key);
  return value == null ? null : Math.trunc(value);
}

function readNestedInteger(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeDisplayText(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'tbd' || lower === 'n/a' || lower === 'na' || lower === 'none') {
    return null;
  }

  return normalized;
}

function normalizeInventoryCatalogState(catalogState: string | null | undefined) {
  const normalizedState = String(catalogState || '').trim().toLowerCase();
  return normalizedState.length > 0 ? normalizedState : null;
}

export function buildLaunchInventoryStatusMessage({
  launchDesignator,
  catalogState,
  totalObjectCount
}: {
  launchDesignator: string | null;
  catalogState: string | null;
  totalObjectCount: number;
}) {
  const normalizedState = normalizeInventoryCatalogState(catalogState);
  if (!launchDesignator) {
    return 'No COSPAR launch designator is available for this launch yet.';
  }
  if (normalizedState === 'catalog_empty') {
    return 'Catalog query completed, but no SATCAT objects are available yet.';
  }
  if (normalizedState === 'error') {
    return 'The latest catalog refresh failed. We will try again during the next background refresh.';
  }
  if (normalizedState === 'pending') {
    return 'Catalog is not available yet for this launch.';
  }
  if (totalObjectCount === 0) {
    return 'SATCAT inventory has not populated yet.';
  }
  return null;
}

export function shouldShowLaunchInventoryCounts({
  catalogState,
  totalObjectCount
}: {
  catalogState: string | null;
  totalObjectCount: number;
}) {
  return normalizeInventoryCatalogState(catalogState) === 'catalog_available' || totalObjectCount > 0;
}

export function shouldShowLaunchInventorySection({
  launchNet,
  launchDesignator,
  catalogState,
  totalObjectCount,
  hasSummaryBadges = false,
  nowMs = Date.now()
}: {
  launchNet: string | null | undefined;
  launchDesignator: string | null;
  catalogState: string | null;
  totalObjectCount: number;
  hasSummaryBadges?: boolean;
  nowMs?: number;
}) {
  const normalizedState = normalizeInventoryCatalogState(catalogState);
  const netMs = Date.parse(String(launchNet || ''));
  const isFuture = Number.isFinite(netMs) ? netMs > nowMs : false;
  const hasCatalogData = shouldShowLaunchInventoryCounts({ catalogState: normalizedState, totalObjectCount }) || hasSummaryBadges;

  if (isFuture) {
    return hasCatalogData;
  }

  return Boolean(hasCatalogData || normalizedState || launchDesignator);
}

function normalizeUrl(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeComparableUrl(value: string | null | undefined): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    const normalizedHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const normalizedPath = parsed.pathname.replace(/\/+$/g, '') || '/';
    return `${parsed.protocol}//${normalizedHost}${normalizedPath}${parsed.search}`;
  } catch {
    return null;
  }
}

function formatUrlHost(value: string | null | undefined): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function formatLaunchNewsSourceLabel(source: string | null | undefined, url: string | null | undefined) {
  const normalizedSource = typeof source === 'string' && source.trim().length > 0 ? source.trim() : null;
  if (normalizedSource) return normalizedSource;
  return formatUrlHost(url) ?? 'Launch coverage';
}

function resolveLaunchMediaImageUrl(resource: LaunchExternalContentResource): string | null {
  const preferred = normalizeUrl(resource.previewUrl ?? null);
  if (preferred) {
    return preferred;
  }

  if (resource.kind === 'image' || resource.kind === 'infographic') {
    return normalizeUrl(resource.url);
  }

  return null;
}

function rankLaunchMediaKind(kind: LaunchExternalContentResource['kind'] | string | null | undefined) {
  if (kind === 'page') return 0;
  if (kind === 'infographic') return 1;
  if (kind === 'webcast') return 2;
  if (kind === 'image') return 3;
  if (kind === 'video') return 4;
  if (kind === 'document') return 5;
  return 6;
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

export function getLaunchPayloadSummary(detail: LaunchDetailV1): LaunchPayloadListSummary[] {
  const launch = getLaunchData(detail);
  const payloads = Array.isArray(launch?.payloads) ? launch.payloads : [];
  return payloads
    .map((payload, index) => {
      const name = normalizeDisplayText(payload?.name ?? null);
      if (!name) return null;
      const subtitle = [
        normalizeDisplayText(payload?.type ?? null),
        normalizeDisplayText(payload?.orbit ?? null),
        normalizeDisplayText(payload?.agency ?? null)
      ]
        .filter(Boolean)
        .join(' • ');
      return {
        id: `summary-payload:${index}:${name}`,
        name,
        subtitle: subtitle || null
      };
    })
    .filter((payload): payload is LaunchPayloadListSummary => Boolean(payload));
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
  const launch = getLaunchData(detail);
  const launchDesignator =
    normalizeDisplayText(detail.objectInventory.launchDesignator ?? null) ||
    normalizeDisplayText((launch as { launchDesignator?: string | null } | null)?.launchDesignator ?? null);
  const rawStatus = isRecord(detail.objectInventory.status) ? detail.objectInventory.status : null;
  const rawReconciliation = isRecord(detail.objectInventory.reconciliation) ? detail.objectInventory.reconciliation : null;
  const rawTypeCounts = isRecord(rawReconciliation?.satcatTypeCounts) ? rawReconciliation.satcatTypeCounts : null;
  const status = rawStatus
    ? {
        catalogState: readString(rawStatus, 'catalogState'),
        lastCheckedAt: readString(rawStatus, 'lastCheckedAt'),
        lastSuccessAt: readString(rawStatus, 'lastSuccessAt'),
        lastError: readString(rawStatus, 'lastError'),
        lastNonEmptyAt: readString(rawStatus, 'lastNonEmptyAt'),
        latestSnapshotHash: readString(rawStatus, 'latestSnapshotHash'),
        message: buildLaunchInventoryStatusMessage({
          launchDesignator,
          catalogState: readString(rawStatus, 'catalogState'),
          totalObjectCount
        })
      }
    : launchDesignator
      ? {
          catalogState: null,
          lastCheckedAt: null,
          lastSuccessAt: null,
          lastError: null,
          lastNonEmptyAt: null,
          latestSnapshotHash: null,
          message: buildLaunchInventoryStatusMessage({
            launchDesignator,
            catalogState: null,
            totalObjectCount
          })
        }
      : null;
  const reconciliation = rawReconciliation
    ? {
        manifestPayloadCount: readInteger(rawReconciliation, 'manifestPayloadCount'),
        satcatPayloadCount: readInteger(rawReconciliation, 'satcatPayloadCount'),
        satcatPayloadsFilterCount: readInteger(rawReconciliation, 'satcatPayloadsFilterCount'),
        satcatTotalCount: readInteger(rawReconciliation, 'satcatTotalCount'),
        satcatTypeCounts: rawTypeCounts
          ? {
              PAY: readNestedInteger(rawTypeCounts, 'PAY'),
              RB: readNestedInteger(rawTypeCounts, 'RB'),
              DEB: readNestedInteger(rawTypeCounts, 'DEB'),
              UNK: readNestedInteger(rawTypeCounts, 'UNK')
            }
          : null,
        deltaManifestVsSatcatPayload: readInteger(rawReconciliation, 'deltaManifestVsSatcatPayload')
      }
    : null;
  return {
    launchDesignator,
    totalObjectCount,
    payloadObjectCount: payloadObjects.length,
    nonPayloadObjectCount: nonPayloadObjects.length,
    status,
    reconciliation,
    summaryBadges: detail.objectInventory.summaryBadges,
    payloadObjects,
    nonPayloadObjects
  };
}

export function shouldShowLaunchInventorySectionForDetail(detail: LaunchDetailV1, nowMs = Date.now()) {
  const launch = getLaunchData(detail);
  const objectInventory = detail.objectInventory ?? null;
  const totalObjectCount = (objectInventory?.payloadObjects?.length ?? 0) + (objectInventory?.nonPayloadObjects?.length ?? 0);
  const catalogState = isRecord(objectInventory?.status) ? readString(objectInventory.status, 'catalogState') : null;
  const launchDesignator =
    normalizeDisplayText(objectInventory?.launchDesignator ?? null) ||
    normalizeDisplayText((launch as { launchDesignator?: string | null } | null)?.launchDesignator ?? null);

  return shouldShowLaunchInventorySection({
    launchNet: launch?.net ?? null,
    launchDesignator,
    catalogState,
    totalObjectCount,
    hasSummaryBadges: (objectInventory?.summaryBadges?.length ?? 0) > 0,
    nowMs
  });
}

export function getLaunchRecovery(detail: LaunchDetailV1): LaunchRecoverySummary | null {
  const recovery = detail.enrichment?.recovery ?? [];
  const booster =
    recovery.find((item) => item.role === 'booster' && hasMeaningfulRecovery(item)) ??
    recovery.find((item) => item.role === 'unknown' && hasMeaningfulRecovery(item)) ??
    null;
  const spacecraft = recovery.find((item) => item.role === 'spacecraft' && hasMeaningfulRecovery(item)) ?? null;
  if (!booster && !spacecraft) return null;

  const boosterLocation = booster ? buildRecoveryLocation(booster) : null;

  return {
    booster: booster
      ? {
          type: buildRecoveryType(booster, boosterLocation) ?? undefined,
          location: boosterLocation
        }
      : null,
    spacecraft: spacecraft
      ? {
          summary: buildRecoveryType(spacecraft, buildRecoveryLocation(spacecraft)) ?? buildRecoveryOutcome(spacecraft, 'Recovery planned'),
          detail: buildRecoveryLocation(spacecraft)
        }
      : null
  };
}

function buildRecoveryLocation(
  recovery: NonNullable<NonNullable<LaunchDetailV1['enrichment']>['recovery']>[number]
) {
  const name = normalizeDisplayText(recovery.landingLocationName ?? null);
  const context = normalizeDisplayText(recovery.landingLocationContext ?? null);
  if (name && context) return `${name} • ${context}`;
  return name ?? context ?? normalizeDisplayText(recovery.returnSite ?? null);
}

function buildRecoveryType(
  recovery: NonNullable<NonNullable<LaunchDetailV1['enrichment']>['recovery']>[number],
  location: string | null
) {
  const landingType = normalizeDisplayText(recovery.landingTypeName ?? recovery.landingTypeAbbrev ?? null);
  if (landingType) return landingType;

  const title = normalizeDisplayText(recovery.title ?? null);
  if (title && title !== location) return title;
  return null;
}

function buildRecoveryOutcome(
  recovery: NonNullable<NonNullable<LaunchDetailV1['enrichment']>['recovery']>[number],
  fallback: string
) {
  if (recovery.attempt === true) {
    if (recovery.success === true) return 'Successful recovery';
    if (recovery.success === false) return 'Recovery failed';
    return 'Recovery attempted';
  }

  if (recovery.attempt === false) return 'No recovery attempt listed';
  return fallback;
}

function hasMeaningfulRecovery(
  recovery: NonNullable<NonNullable<LaunchDetailV1['enrichment']>['recovery']>[number]
) {
  const location = buildRecoveryLocation(recovery);
  return Boolean(
    location ||
      buildRecoveryType(recovery, location) ||
      recovery.returnDateTime ||
      recovery.downrangeDistanceKm != null ||
      recovery.attempt != null ||
      recovery.success != null
  );
}

export function getLaunchMissionStats(detail: LaunchDetailV1): LaunchMissionStatsSummary | null {
  const stats = detail.missionStats;
  if (!stats) return null;
  return stats.cards.length > 0 || stats.boosterCards.length > 0 || stats.bonusInsights.length > 0 ? stats : null;
}

export function getLaunchMedia(detail: LaunchDetailV1): LaunchMediaItem[] {
  const deduped = new Map<string, LaunchMediaItem>();

  for (const item of detail.enrichment?.externalContent ?? []) {
    const resources = selectPreferredResponsiveLaunchExternalResources(item.resources, 'desktop');
    if (resources.length > 0) {
      for (const resource of resources) {
        const normalizedUrl = normalizeComparableUrl(resource.url) ?? resource.url;
        const key = `${resource.kind}:${normalizedUrl}`;
        if (deduped.has(key)) continue;

        const sourceTitle = item.title?.trim() || null;
        const resourceTitle = resource.label?.trim() || sourceTitle;

        deduped.set(key, {
          type: resource.kind ?? item.contentType,
          kind: resource.kind ?? null,
          title: resourceTitle,
          name: sourceTitle,
          description: sourceTitle && resourceTitle && sourceTitle !== resourceTitle ? sourceTitle : null,
          url: resource.url,
          imageUrl: resolveLaunchMediaImageUrl(resource),
          host: formatUrlHost(resource.url)
        });
      }
      continue;
    }

    const normalizedLaunchPageUrl = normalizeUrl(item.launchPageUrl ?? null);
    if (!normalizedLaunchPageUrl) continue;

    const key = `resource:${normalizeComparableUrl(normalizedLaunchPageUrl) ?? normalizedLaunchPageUrl}`;
    if (deduped.has(key)) continue;

    const sourceTitle = item.title?.trim() || null;
    deduped.set(key, {
      type: item.contentType,
      kind: null,
      title: sourceTitle,
      name: sourceTitle,
      description: null,
      url: normalizedLaunchPageUrl,
      imageUrl: null,
      host: formatUrlHost(normalizedLaunchPageUrl)
    });
  }

  return [...deduped.values()].sort((left, right) => {
    const kindDelta = rankLaunchMediaKind(left.kind ?? left.type) - rankLaunchMediaKind(right.kind ?? right.type);
    if (kindDelta !== 0) return kindDelta;
    return (left.title ?? left.name ?? '').localeCompare(right.title ?? right.name ?? '');
  });
}

export function getLaunchMissionTimeline(detail: LaunchDetailV1): LaunchMissionTimelineItem[] {
  const deduped = new Set<string>();
  const events: LaunchMissionTimelineItem[] = [];

  for (const item of detail.enrichment?.externalContent ?? []) {
    const sourceTitle = item.title?.trim() || null;
    for (const event of item.timelineEvents ?? []) {
      const key = `${event.phase ?? 'timeline'}:${event.time ?? ''}:${event.label}`;
      if (deduped.has(key)) continue;
      deduped.add(key);
      events.push({
        id: event.id,
        label: event.label,
        time: event.time ?? null,
        description: event.description ?? null,
        kind: event.kind ?? null,
        phase: event.phase ?? null,
        sourceTitle
      });
    }
  }

  return events;
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
    id: item.id,
    title: item.title,
    summary: item.summary ?? '',
    url: item.url,
    image: item.imageUrl ?? undefined,
    source: formatLaunchNewsSourceLabel(item.newsSite, item.url),
    date: item.publishedAt ?? '',
    itemType: item.itemType ?? null,
    authors: item.authors ?? [],
    featured: Boolean(item.featured)
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
