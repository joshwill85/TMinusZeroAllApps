import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchLaunchBoosterStats, type LaunchBoosterStats } from '@/lib/server/launchBoosterStats';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  LaunchDetailEnrichment,
  LaunchExternalContent,
  LaunchExternalResource,
  LaunchExternalResourceKind,
  LaunchRecoveryDetail,
  LaunchRecoveryRole,
  LaunchStageSummary,
  LaunchTimelineResourceEvent
} from '@/lib/types/launch';

type LaunchExternalResourceRow = {
  source?: string | null;
  content_type?: string | null;
  source_id?: string | null;
  confidence?: number | null;
  data?: unknown;
  fetched_at?: string | null;
};

type Ll2LandingRecord = {
  ll2_landing_id?: number | null;
  attempt?: boolean | null;
  success?: boolean | null;
  description?: string | null;
  downrange_distance_km?: number | null;
  landing_location?: unknown;
  landing_type?: unknown;
};

type LaunchLandingRow = {
  ll2_launch_uuid?: string | null;
  launch_id?: string | null;
  ll2_landing_id?: number | null;
  landing_role?: string | null;
  fetched_at?: string | null;
  ll2_landings?: Ll2LandingRecord | Ll2LandingRecord[] | null;
};

const MAX_EXTERNAL_CONTENT_ROWS = 12;
const MAX_LANDING_ROWS = 24;

export const fetchLaunchDetailEnrichment = cache(
  async (launchId: string, ll2LaunchUuid?: string | null): Promise<LaunchDetailEnrichment> => {
    const normalizedLaunchId = normalizeText(launchId);
    const normalizedLl2LaunchUuid = normalizeText(ll2LaunchUuid);
    if (!normalizedLaunchId && !normalizedLl2LaunchUuid) {
      return { firstStages: [], recovery: [], externalContent: [] };
    }

    const [boosters, recovery, externalContent] = await Promise.all([
      fetchLaunchBoosterStats(normalizedLaunchId, normalizedLl2LaunchUuid || null),
      fetchLaunchRecoveryDetails(normalizedLaunchId, normalizedLl2LaunchUuid || null),
      fetchLaunchExternalContent(normalizedLaunchId)
    ]);
    const recoveryHints = mapExternalContentToRecoveryHints(externalContent);

    return {
      firstStages: mapBoosterStatsToStages(boosters),
      recovery: [...recovery, ...recoveryHints].sort(compareRecoveryDetails),
      externalContent
    };
  }
);

export const fetchLaunchRecoveryDetails = cache(
  async (launchId: string, ll2LaunchUuid?: string | null): Promise<LaunchRecoveryDetail[]> => {
    const normalizedLaunchId = normalizeText(launchId);
    const normalizedLl2LaunchUuid = normalizeText(ll2LaunchUuid);
    if ((!normalizedLaunchId && !normalizedLl2LaunchUuid) || !isSupabaseConfigured()) return [];

    const supabase = createSupabasePublicClient();
    const rows = await fetchLaunchLandingRows({
      supabase,
      launchId: normalizedLaunchId,
      ll2LaunchUuid: normalizedLl2LaunchUuid
    });
    if (!rows.length) return [];

    const deduped = new Map<string, LaunchRecoveryDetail>();
    for (const row of rows) {
      const normalized = normalizeLaunchRecoveryRow(row);
      if (!normalized) continue;
      deduped.set(normalized.id, normalized);
    }

    return [...deduped.values()].sort(compareRecoveryDetails);
  }
);

export const fetchLaunchExternalContent = cache(async (launchId: string): Promise<LaunchExternalContent[]> => {
  const normalizedLaunchId = normalizeText(launchId);
  if (!normalizedLaunchId || !isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('launch_external_resources')
    .select('source, content_type, source_id, confidence, data, fetched_at')
    .eq('launch_id', normalizedLaunchId)
    .order('fetched_at', { ascending: false })
    .limit(MAX_EXTERNAL_CONTENT_ROWS);

  if (error || !Array.isArray(data)) return [];

  const normalizedRows = data
    .map((row) => normalizeLaunchExternalContentRow(row as LaunchExternalResourceRow))
    .filter((row): row is LaunchExternalContent => Boolean(row));

  return normalizedRows.sort((left, right) => {
    const fetchedDelta = (right.fetchedAt || '').localeCompare(left.fetchedAt || '');
    if (fetchedDelta !== 0) return fetchedDelta;
    return left.id.localeCompare(right.id);
  });
});

export function mapBoosterStatsToStages(boosters: LaunchBoosterStats[]): LaunchStageSummary[] {
  return boosters.map((booster) => ({
    id: `launcher:${booster.ll2LauncherId}`,
    kind: 'launcher_stage',
    title: booster.serialNumber || `Launcher ${booster.ll2LauncherId}`,
    serialNumber: booster.serialNumber,
    status: booster.status,
    description: booster.details,
    imageUrl: booster.imageUrl,
    launcherConfigId: booster.launcherConfigId,
    totalMissions: booster.totalMissions,
    trackedMissions: booster.trackedMissions,
    missionsThisYear: booster.missionsThisYear,
    lastMissionNet: booster.lastMissionNet,
    firstLaunchDate: booster.firstLaunchDate,
    lastLaunchDate: booster.lastLaunchDate,
    source: 'll2'
  }));
}

export function mapExternalContentToRecoveryHints(items: LaunchExternalContent[]): LaunchRecoveryDetail[] {
  return items.flatMap((item) => {
    if (!item.returnSite && !item.returnDateTime) return [];
    return [
      {
        id: `${item.id}:recovery_hint`,
        role: 'unknown',
        source: 'spacex_content',
        sourceId: item.sourceId,
        title: 'Recovery hint',
        attempt: null,
        success: null,
        description: null,
        downrangeDistanceKm: null,
        landingLocationName: null,
        landingLocationAbbrev: null,
        landingLocationContext: null,
        latitude: null,
        longitude: null,
        landingTypeName: null,
        landingTypeAbbrev: null,
        returnSite: item.returnSite || null,
        returnDateTime: item.returnDateTime || null,
        fetchedAt: item.fetchedAt || null
      } satisfies LaunchRecoveryDetail
    ];
  });
}

async function fetchLaunchLandingRows({
  supabase,
  launchId,
  ll2LaunchUuid
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  launchId: string;
  ll2LaunchUuid: string;
}) {
  const select =
    'll2_launch_uuid,launch_id,ll2_landing_id,landing_role,fetched_at,ll2_landings(ll2_landing_id,attempt,success,description,downrange_distance_km,landing_location,landing_type)';

  if (launchId) {
    const { data, error } = await supabase
      .from('ll2_launch_landings')
      .select(select)
      .eq('launch_id', launchId)
      .limit(MAX_LANDING_ROWS);
    if (!error && Array.isArray(data) && data.length > 0) return data as LaunchLandingRow[];
  }

  if (ll2LaunchUuid) {
    const { data, error } = await supabase
      .from('ll2_launch_landings')
      .select(select)
      .eq('ll2_launch_uuid', ll2LaunchUuid)
      .limit(MAX_LANDING_ROWS);
    if (!error && Array.isArray(data) && data.length > 0) return data as LaunchLandingRow[];
  }

  return [] as LaunchLandingRow[];
}

function normalizeLaunchRecoveryRow(row: LaunchLandingRow): LaunchRecoveryDetail | null {
  const landingId = toFiniteNumber(row.ll2_landing_id);
  if (landingId == null) return null;

  const landing = unwrapLandingRecord(row.ll2_landings);
  const landingLocation = asObject(landing?.landing_location);
  const landingType = asObject(landing?.landing_type);
  const role = normalizeRecoveryRole(row.landing_role);
  const landingLocationContext = asObject(landingLocation.location);

  const landingLocationName =
    normalizeText(landingLocation.name) ||
    normalizeText(landingLocation.abbrev) ||
    normalizeText(landingLocation.location_name) ||
    '';

  const landingTypeName =
    normalizeText(landingType.name) ||
    normalizeText(landingType.abbrev) ||
    normalizeText(landingType.description) ||
    '';

  const title = [landingTypeName, landingLocationName].filter(Boolean).join(' • ');

  return {
    id: `${role}:${landingId}`,
    role,
    source: 'll2',
    sourceId: String(landingId),
    title: title || `Landing ${landingId}`,
    attempt: typeof landing?.attempt === 'boolean' ? landing.attempt : null,
    success: typeof landing?.success === 'boolean' ? landing.success : null,
    description: normalizeText(landing?.description) || null,
    downrangeDistanceKm: readNumber(landing?.downrange_distance_km),
    landingLocationName: landingLocationName || null,
    landingLocationAbbrev: normalizeText(landingLocation.abbrev) || null,
    landingLocationContext: normalizeText(landingLocationContext.name) || null,
    latitude: readNumber(landingLocation.latitude),
    longitude: readNumber(landingLocation.longitude),
    landingTypeName: landingTypeName || null,
    landingTypeAbbrev: normalizeText(landingType.abbrev) || null,
    fetchedAt: normalizeText(row.fetched_at) || null,
    returnSite: null,
    returnDateTime: null
  };
}

function normalizeLaunchExternalContentRow(row: LaunchExternalResourceRow): LaunchExternalContent | null {
  const source = normalizeText(row.source) || 'unknown';
  const contentType = normalizeText(row.content_type) || 'resource_bundle';
  const data = asObject(row.data);
  const sourceId =
    normalizeText(row.source_id) ||
    normalizeText(data.missionId) ||
    normalizeText(data.sourceId) ||
    `${source}:${contentType}`;

  const title =
    normalizeText(data.missionTitle) ||
    normalizeText(data.title) ||
    normalizeText(asObject(data.mission).title) ||
    normalizeText(asObject(data.tile).title) ||
    null;

  const launchPageUrl =
    normalizeUrl(data.launchPageUrl) ||
    normalizeUrl(data.launch_page_url) ||
    normalizeUrl(asObject(data.page).url) ||
    normalizeUrl(asObject(data.tile).pageUrl) ||
    normalizeUrl(asObject(data.tile).launchPageUrl) ||
    buildSpaceXLaunchPageUrl(source, sourceId);

  const returnSite =
    normalizeText(data.returnSite) ||
    normalizeText(data.return_site) ||
    normalizeText(asObject(data.recovery).returnSite) ||
    normalizeText(asObject(data.tile).returnSite) ||
    null;

  const returnDateTime =
    normalizeText(data.returnDateTime) ||
    normalizeText(data.return_date_time) ||
    normalizeText(asObject(data.recovery).returnDateTime) ||
    normalizeText(asObject(data.tile).returnDateTime) ||
    null;

  const resources = dedupeResources([
    ...(launchPageUrl
      ? [
          {
            id: `page:${sourceId}`,
            kind: 'page',
            label: 'Launch page',
            url: launchPageUrl,
            previewUrl: null,
            mime: null,
            width: null,
            height: null,
            source: 'spacex_content',
            sourceId
          } satisfies LaunchExternalResource
        ]
      : []),
    ...normalizeResourceList(data.resources, sourceId),
    ...extractAssetResources(data, sourceId),
    ...extractAssetResources(asObject(data.tile), sourceId, 'tile'),
    ...extractAssetResources(asObject(data.mission), sourceId, 'mission'),
    ...normalizeWebcastResources(data.webcasts, sourceId),
    ...normalizeWebcastResources(asObject(data.mission).webcasts, sourceId),
    ...normalizeCarouselResources(data.carousel, sourceId),
    ...normalizeCarouselResources(asObject(data.mission).carousel, sourceId)
  ]);

  const timelineEvents = dedupeTimelineEvents([
    ...normalizeTimelineEvents(data.timelineEvents, 'timeline'),
    ...normalizeTimelineEvents(data.timeline, 'timeline'),
    ...normalizeTimelineEvents(data.preLaunchTimeline, 'prelaunch'),
    ...normalizeTimelineEvents(data.postLaunchTimeline, 'postlaunch'),
    ...normalizeTimelineEvents(asObject(data.mission).preLaunchTimeline, 'prelaunch'),
    ...normalizeTimelineEvents(asObject(data.mission).postLaunchTimeline, 'postlaunch')
  ]);

  if (!resources.length && !returnSite && !returnDateTime && !launchPageUrl) return null;

  return {
    id: `${source}:${contentType}:${sourceId}`,
    source,
    contentType,
    sourceId,
    title,
    launchPageUrl,
    confidence: readNumber(row.confidence),
    fetchedAt: normalizeText(row.fetched_at) || null,
    returnSite,
    returnDateTime,
    resources,
    timelineEvents
  };
}

function extractAssetResources(
  value: Record<string, unknown>,
  sourceId: string,
  prefix?: 'tile' | 'mission'
): LaunchExternalResource[] {
  if (!Object.keys(value).length) return [];

  const candidates: Array<{
    primaryKey: string;
    fallbackKey: string;
    label: string;
    kind: LaunchExternalResourceKind;
  }> = [
    { primaryKey: 'infographicDesktop', fallbackKey: 'infographicMobile', label: 'Mission profile', kind: 'infographic' },
    { primaryKey: 'imageDesktop', fallbackKey: 'imageMobile', label: 'Mission image', kind: 'image' },
    { primaryKey: 'videoDesktop', fallbackKey: 'videoMobile', label: 'Mission video', kind: 'video' }
  ];

  return candidates
    .map(({ primaryKey, fallbackKey, label, kind }) =>
      normalizeAssetResource(value[primaryKey] ?? value[fallbackKey], {
        id: `${prefix || 'bundle'}:${primaryKey}:${sourceId}`,
        label,
        kind,
        sourceId
      })
    )
    .filter((resource): resource is LaunchExternalResource => Boolean(resource));
}

function normalizeAssetResource(
  asset: unknown,
  {
    id,
    label,
    kind,
    sourceId
  }: {
    id: string;
    label: string;
    kind: LaunchExternalResourceKind;
    sourceId: string;
  }
): LaunchExternalResource | null {
  if (!asset) return null;
  if (typeof asset === 'string') {
    const url = normalizeUrl(asset);
    if (!url) return null;
    return {
      id,
      kind,
      label,
      url,
      previewUrl: null,
      mime: null,
      width: null,
      height: null,
      source: 'spacex_content',
      sourceId
    };
  }

  const object = asObject(asset);
  const url = normalizeUrl(object.url) || normalizeUrl(object.href) || normalizeUrl(object.link);
  if (!url) return null;

  return {
    id,
    kind,
    label,
    url,
    previewUrl: normalizeUrl(object.previewUrl) || normalizeUrl(object.preview_url) || null,
    mime: normalizeText(object.mime) || null,
    width: toFiniteNumber(object.width),
    height: toFiniteNumber(object.height),
    source: 'spacex_content',
    sourceId
  };
}

function normalizeResourceList(value: unknown, sourceId: string): LaunchExternalResource[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => normalizeGenericResource(entry, sourceId, index))
    .filter((resource): resource is LaunchExternalResource => Boolean(resource));
}

function normalizeGenericResource(entry: unknown, sourceId: string, index: number): LaunchExternalResource | null {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const url = normalizeUrl(entry);
    if (!url) return null;
    return {
      id: `resource:${sourceId}:${index}`,
      kind: 'resource',
      label: `Resource ${index + 1}`,
      url,
      previewUrl: null,
      mime: null,
      width: null,
      height: null,
      source: 'spacex_content',
      sourceId
    };
  }

  const object = asObject(entry);
  const url = normalizeUrl(object.url) || normalizeUrl(object.href) || normalizeUrl(object.link);
  if (!url) return null;

  const kind = normalizeResourceKind(object.kind) || normalizeResourceKind(object.type) || inferResourceKind(url);
  const label =
    normalizeText(object.label) ||
    normalizeText(object.title) ||
    normalizeText(object.name) ||
    normalizeText(object.description) ||
    `${kind === 'resource' ? 'Resource' : capitalize(kind)} ${index + 1}`;

  return {
    id: `resource:${sourceId}:${index}:${url}`,
    kind,
    label,
    url,
    previewUrl:
      normalizeUrl(object.previewUrl) ||
      normalizeUrl(object.preview_url) ||
      normalizeUrl(object.imageUrl) ||
      normalizeUrl(object.image_url) ||
      null,
    mime: normalizeText(object.mime) || null,
    width: toFiniteNumber(object.width),
    height: toFiniteNumber(object.height),
    source: 'spacex_content',
    sourceId
  };
}

function normalizeWebcastResources(value: unknown, sourceId: string): LaunchExternalResource[] {
  if (!Array.isArray(value)) return [];

  const resources: LaunchExternalResource[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const object = asObject(value[index]);
    const url = normalizeUrl(object.url) || normalizeUrl(object.link) || normalizeUrl(object.href);
    if (!url) continue;
    const label =
      normalizeText(object.title) ||
      normalizeText(object.label) ||
      normalizeText(object.name) ||
      `Webcast ${index + 1}`;
    resources.push({
      id: `webcast:${sourceId}:${index}:${url}`,
      kind: 'webcast',
      label,
      url,
      previewUrl: normalizeUrl(object.imageUrl) || normalizeUrl(object.image_url) || null,
      mime: normalizeText(object.mime) || null,
      width: toFiniteNumber(object.width),
      height: toFiniteNumber(object.height),
      source: 'spacex_content',
      sourceId
    });
  }

  return resources;
}

function normalizeCarouselResources(value: unknown, sourceId: string): LaunchExternalResource[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((entry, index) => {
      const object = asObject(entry);
      const title = normalizeText(object.title) || normalizeText(object.label) || `Carousel ${index + 1}`;

      return [
        normalizeAssetResource(object.image || object.imageDesktop || object.imageMobile || object.media, {
          id: `carousel:image:${sourceId}:${index}`,
          label: title,
          kind: 'image',
          sourceId
        }),
        normalizeAssetResource(object.video || object.videoDesktop || object.videoMobile, {
          id: `carousel:video:${sourceId}:${index}`,
          label: `${title} video`,
          kind: 'video',
          sourceId
        })
      ].filter((resource): resource is LaunchExternalResource => Boolean(resource));
    });
}

function normalizeTimelineEvents(
  value: unknown,
  phase: 'prelaunch' | 'postlaunch' | 'timeline'
): LaunchTimelineResourceEvent[] {
  if (!Array.isArray(value)) return [];

  const events: LaunchTimelineResourceEvent[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry) continue;
    if (typeof entry === 'string') {
      const label = normalizeText(entry);
      if (!label) continue;
      events.push({
        id: `${phase}:${index}:${label}`,
        label,
        time: null,
        description: null,
        kind: null,
        phase
      });
      continue;
    }

    const object = asObject(entry);
    const label =
      normalizeText(object.label) ||
      normalizeText(object.title) ||
      normalizeText(object.name) ||
      normalizeText(object.event) ||
      normalizeText(object.relative_time) ||
      normalizeText(object.relativeTime);
    if (!label) continue;

    events.push({
      id: `${phase}:${index}:${label}`,
      label,
      time:
        normalizeText(object.time) ||
        normalizeText(object.relative_time) ||
        normalizeText(object.relativeTime) ||
        normalizeText(object.datetime) ||
        normalizeText(object.dateTime) ||
        normalizeText(object.date) ||
        null,
      description:
        normalizeText(object.description) ||
        normalizeText(object.text) ||
        normalizeText(object.subtitle) ||
        normalizeText(object.body) ||
        normalizeText(object.details) ||
        null,
      kind: normalizeText(object.kind) || normalizeText(object.type) || null,
      phase
    });
  }

  return events;
}

function dedupeResources(resources: LaunchExternalResource[]) {
  const deduped = new Map<string, LaunchExternalResource>();
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.url}`;
    if (!deduped.has(key)) deduped.set(key, resource);
  }
  return [...deduped.values()];
}

function dedupeTimelineEvents(events: LaunchTimelineResourceEvent[]) {
  const deduped = new Map<string, LaunchTimelineResourceEvent>();
  for (const event of events) {
    const key = `${event.phase || 'timeline'}:${event.label}:${event.time || ''}`;
    if (!deduped.has(key)) deduped.set(key, event);
  }
  return [...deduped.values()];
}

function compareRecoveryDetails(left: LaunchRecoveryDetail, right: LaunchRecoveryDetail) {
  const roleDelta = recoveryRoleRank(left.role) - recoveryRoleRank(right.role);
  if (roleDelta !== 0) return roleDelta;
  const titleDelta = (left.title || '').localeCompare(right.title || '');
  if (titleDelta !== 0) return titleDelta;
  return left.id.localeCompare(right.id);
}

function recoveryRoleRank(role: LaunchRecoveryRole) {
  switch (role) {
    case 'booster':
      return 0;
    case 'spacecraft':
      return 1;
    default:
      return 2;
  }
}

function unwrapLandingRecord(value: unknown): Ll2LandingRecord | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? (first as Ll2LandingRecord) : null;
  }
  return value && typeof value === 'object' ? (value as Ll2LandingRecord) : null;
}

function normalizeRecoveryRole(value: unknown): LaunchRecoveryRole {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'booster') return 'booster';
  if (normalized === 'spacecraft') return 'spacecraft';
  return 'unknown';
}

function normalizeResourceKind(value: unknown): LaunchExternalResourceKind | null {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  switch (normalized) {
    case 'page':
    case 'infographic':
    case 'image':
    case 'video':
    case 'webcast':
    case 'document':
    case 'timeline':
    case 'resource':
      return normalized;
    default:
      return null;
  }
}

function inferResourceKind(url: string): LaunchExternalResourceKind {
  const normalized = url.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|svg)(?:[?#].*)?$/.test(normalized)) return 'image';
  if (/\.(mp4|mov|m4v|webm)(?:[?#].*)?$/.test(normalized)) return 'video';
  if (/\.(pdf)(?:[?#].*)?$/.test(normalized)) return 'document';
  return 'resource';
}

function buildSpaceXLaunchPageUrl(source: string, sourceId: string) {
  if (!source.toLowerCase().includes('spacex') || !sourceId) return null;
  return `https://www.spacex.com/launches/${encodeURIComponent(sourceId)}`;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFiniteNumber(value: unknown) {
  const numeric = readNumber(value);
  if (numeric == null) return null;
  return Math.trunc(numeric);
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
