import { createApiClient } from '@tminuszero/api-client';
import { selectPreferredResponsiveLaunchExternalContent, selectPreferredResponsiveLaunchExternalResources } from '@tminuszero/launch-detail-ui';
import { z } from 'zod';
import {
  adminAccessOverrideSchemaV1,
  adminAccessOverrideUpdateSchemaV1,
  basicFollowsSchemaV1,
  accountExportSchemaV1,
  alertRuleCreateSchemaV1,
  alertRuleEnvelopeSchemaV1,
  alertRulesSchemaV1,
  authContextUpsertSchemaV1,
  calendarFeedCreateSchemaV1,
  calendarFeedEnvelopeSchemaV1,
  calendarFeedsSchemaV1,
  calendarFeedUpdateSchemaV1,
  embedWidgetCreateSchemaV1,
  embedWidgetEnvelopeSchemaV1,
  embedWidgetsSchemaV1,
  embedWidgetUpdateSchemaV1,
  entitlementSchemaV1,
  filterPresetCreateSchemaV1,
  filterPresetEnvelopeSchemaV1,
  filterPresetsSchemaV1,
  filterPresetUpdateSchemaV1,
  launchDetailSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  launchNotificationPreferenceUpdateSchemaV1,
  marketingEmailSchemaV1,
  marketingEmailUpdateSchemaV1,
  notificationPreferencesSchemaV1,
  notificationPreferencesUpdateSchemaV1,
  privacyPreferencesSchemaV1,
  privacyPreferencesUpdateSchemaV1,
  profileSchemaV1,
  profileUpdateSchemaV1,
  pushDeliveryTestSchemaV1,
  pushDeviceRegistrationSchemaV1,
  pushDeviceRemovalSchemaV1,
  searchResponseSchemaV1,
  successResponseSchemaV1,
  viewerSessionSchemaV1,
  rssFeedCreateSchemaV1,
  rssFeedEnvelopeSchemaV1,
  rssFeedsSchemaV1,
  rssFeedUpdateSchemaV1,
  watchlistCreateSchemaV1,
  watchlistEnvelopeSchemaV1,
  watchlistRuleCreateSchemaV1,
  watchlistRuleEnvelopeSchemaV1,
  watchlistRuleTypeSchemaV1,
  watchlistUpdateSchemaV1,
  watchlistsSchemaV1
} from '@tminuszero/contracts';
import { AccountDeletionError, deleteAccountWithGuards } from '@/lib/server/accountDeletion';
import { loadArTrajectorySummary } from '@/lib/server/arTrajectory';
import { fetchBlueOriginPassengersDatabaseOnly, fetchBlueOriginPayloads } from '@/lib/server/blueOriginPeoplePayloads';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerEntitlement, type ViewerEntitlement } from '@/lib/server/entitlements';
import { fetchLaunchFaaAirspace } from '@/lib/server/faaAirspace';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import { fetchLaunchBoosterStats } from '@/lib/server/launchBoosterStats';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { fetchLaunchDetailEnrichment } from '@/lib/server/launchDetailEnrichment';
import { loadMobileHubRollout } from '@/lib/server/mobileHubRollout';
import {
  buildLaunchMissionTimeline,
  normalizeLaunchFilterValue,
  parseSiteSearchInput,
  parseSiteSearchTypesParam,
  type SearchResultType
} from '@tminuszero/domain';
import { NATIVE_MOBILE_PUSH_ONLY_ERROR } from '@/lib/notifications/pushOnly';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabasePublicClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import {
  buildRuleLabel,
  clearUnifiedFollowIntent,
  deactivatePushDestinations,
  deleteUnifiedRuleByScope,
  normalizeWatchScope,
  removeChannelsFromUnifiedRule,
  upsertUnifiedPushDestination,
  upsertUnifiedRule,
  type NotificationRuleScope
} from '@/lib/server/notificationsV3';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import { isArtemisLaunch } from '@/lib/utils/launchArtemis';
import { parseIsoDurationToMs } from '@/lib/utils/launchMilestones';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { isStarshipLaunch } from '@/lib/utils/launchStarship';
import {
  buildBlueOriginTravelerSlug,
  extractBlueOriginFlightCode,
  getBlueOriginMissionKeyFromLaunch,
  isBlueOriginNonHumanCrewEntry,
  isBlueOriginProgramLaunch,
  normalizeBlueOriginTravelerRole
} from '@/lib/utils/blueOrigin';
import { loadVersionedLaunchFeedPayload } from '@/lib/server/v1/launchFeedApi';

type PrivilegedClient =
  | ReturnType<typeof createSupabaseAccessTokenClient>
  | ReturnType<typeof createSupabaseAdminClient>
  | ReturnType<typeof createSupabaseServerClient>;
type AdminSelfServiceClient = PrivilegedClient;

type SearchRpcRow = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  subtitle?: unknown;
  summary?: unknown;
  url?: unknown;
  image_url?: unknown;
  published_at?: unknown;
  badge?: unknown;
};

type RelatedNewsRow = {
  snapi_uid?: string | null;
  item_type?: 'article' | 'blog' | 'report' | null;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  news_site?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  featured?: boolean | null;
};

type RelatedEventRow = {
  ll2_event_id?: number | null;
  name?: string | null;
  description?: string | null;
  type_name?: string | null;
  date?: string | null;
  date_precision?: string | null;
  location_name?: string | null;
  url?: string | null;
  image_url?: string | null;
  webcast_live?: boolean | null;
};

type Ws45ForecastScenario = {
  label?: string;
  povPercent?: number;
  primaryConcerns?: string[];
  weatherVisibility?: string;
  tempF?: number;
  humidityPercent?: number;
  liftoffWinds?: { directionDeg?: number; speedMphMin?: number; speedMphMax?: number; raw?: string };
  additionalRiskCriteria?: {
    upperLevelWindShear?: string;
    boosterRecoveryWeather?: string;
    solarActivity?: string;
  };
  clouds?: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }>;
};

type Ws45Forecast = {
  id: string;
  source_label?: string | null;
  forecast_kind?: string | null;
  pdf_url: string;
  issued_at?: string | null;
  valid_start?: string | null;
  valid_end?: string | null;
  mission_name?: string | null;
  match_status?: string | null;
  match_confidence?: number | null;
  forecast_discussion?: string | null;
  launch_day_pov_percent?: number | null;
  delay_24h_pov_percent?: number | null;
  launch_day_primary_concerns?: string[] | null;
  delay_24h_primary_concerns?: string[] | null;
  launch_day?: Ws45ForecastScenario | null;
  delay_24h?: Ws45ForecastScenario | null;
};

type NwsLaunchWeather = {
  id: string;
  issued_at?: string | null;
  valid_start?: string | null;
  valid_end?: string | null;
  summary?: string | null;
  probability?: number | null;
  data?: any;
};

type RocketOutcomeStats = {
  successAllTime: number;
  failureAllTime: number;
  successYear: number;
  failureYear: number;
};

type PayloadManifestEntry = {
  kind?: 'payload_flight' | 'spacecraft_flight';
  id: number;
  destination?: string | null;
  deployment_status?: 'confirmed' | 'unconfirmed' | 'unknown' | string | null;
  deployment_notes?: string | null;
  payload?: {
    id: number;
    name: string;
    description?: string | null;
    wiki_link?: string | null;
    info_link?: string | null;
    type?: { id: number; name: string } | null;
    manufacturer?: { id: number; name: string; abbrev?: string | null } | null;
    operator?: { id: number; name: string; abbrev?: string | null } | null;
    image?: {
      image_url?: string | null;
      thumbnail_url?: string | null;
    } | null;
  } | null;
  landing?: {
    attempt?: boolean | null;
    success?: boolean | null;
    description?: string | null;
    downrange_distance_km?: number | null;
    landing_location?: { name?: string | null; abbrev?: string | null } | null;
    landing_type?: { name?: string | null; abbrev?: string | null } | null;
  } | null;
  docking_events?: Array<{
    docking?: string | null;
    departure?: string | null;
    space_station_target?: { name?: string | null } | null;
  }> | null;
};

type LaunchInventoryOrbit = {
  source?: string | null;
  epoch?: string | null;
  inclination_deg?: number | null;
  raan_deg?: number | null;
  eccentricity?: number | null;
  arg_perigee_deg?: number | null;
  mean_anomaly_deg?: number | null;
  mean_motion_rev_per_day?: number | null;
  bstar?: number | null;
  fetched_at?: string | null;
};

type LaunchInventoryObject = {
  object_id?: string | null;
  norad_cat_id?: number | null;
  intl_des?: string | null;
  name?: string | null;
  object_type?: string | null;
  ops_status_code?: string | null;
  owner?: string | null;
  launch_date?: string | null;
  launch_site?: string | null;
  decay_date?: string | null;
  period_min?: number | null;
  inclination_deg?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  orbit_center?: string | null;
  orbit_type?: string | null;
  orbit?: LaunchInventoryOrbit | null;
};

type LaunchObjectInventory = {
  launch_designator?: string | null;
  inventory_status?: {
    catalog_state?: 'pending' | 'catalog_available' | 'catalog_empty' | 'error' | string | null;
    last_checked_at?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
    last_non_empty_at?: string | null;
    latest_snapshot_hash?: string | null;
  } | null;
  reconciliation?: {
    ll2_manifest_payload_count?: number | null;
    satcat_payload_count?: number | null;
    satcat_payloads_filter_count?: number | null;
    satcat_total_count?: number | null;
    satcat_type_counts?: {
      PAY?: number | null;
      RB?: number | null;
      DEB?: number | null;
      UNK?: number | null;
    } | null;
    delta_manifest_vs_satcat_payload?: number | null;
  } | null;
  satcat_payload_objects?: LaunchInventoryObject[] | null;
  satcat_non_payload_objects?: LaunchInventoryObject[] | null;
};

type BlueOriginConstraintRow = {
  constraint_type?: string | null;
  data?: any;
  fetched_at?: string | null;
};

type Ll2SpacecraftFlightRow = {
  ll2_spacecraft_flight_id: number;
  ll2_launch_uuid: string;
  launch_crew: unknown;
  onboard_crew: unknown;
  landing_crew: unknown;
  active: boolean | null;
};

const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY = 'mission_summary';
const BLUE_ORIGIN_FAILURE_REASON_FACT_KEY = 'failure_reason';
const BLUE_ORIGIN_NOISE_PASSENGER_TOKEN =
  /\b(?:mission|launch|payload|news|timeline|profile|booster|capsule|spacecraft|vehicle|status|public|media|pod|video|image|gallery|infographic|patch|update|updates|share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|experiment|installation|device|deorbit|program|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i;
const BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN =
  /\b(?:mission|launch|flight|blue origin|new shepard|new glenn|booster|capsule|crew|people|passengers|spaceflight|suborbital|orbital|news|timeline|statistics|profile|infographic|update|updates)\b/i;
const BLUE_ORIGIN_UNVERIFIED_SOURCE_PATTERN = /\b(?:launches_public_cache\.(?:crew|payloads))\b/i;
const BLUE_ORIGIN_MISSION_ARTIFACTS: Record<
  string,
  {
    missionUrl: string;
    patchProductUrl?: string;
    patchImageUrl?: string;
  }
> = {
  'ns-36': {
    missionUrl: 'https://www.blueorigin.com/news/new-shepard-ns-36-mission',
    patchProductUrl: 'https://shop.blueorigin.com/products/pre-sale-ns-36-mission-patch',
    patchImageUrl: 'https://shop.blueorigin.com/cdn/shop/files/FinalpatchNS-36forshop.png?v=1759793737'
  }
};

type AlertRuleRow = {
  id?: string | null;
  kind?: 'region_us' | 'state' | 'filter_preset' | 'follow' | null;
  state?: string | null;
  filter_preset_id?: string | null;
  follow_rule_type?: z.infer<typeof watchlistRuleTypeSchemaV1> | null;
  follow_rule_value?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  launch_filter_presets?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

type BasicLaunchRow = {
  id?: string | null;
  name?: string | null;
  net?: string | null;
  hidden?: boolean | null;
};

type BasicLaunchFollowSummary = {
  launchId: string;
  launchName: string;
  net: string | null;
};

function isMissingAdminAccessOverrideRelationCode(code: string | null | undefined) {
  return code === '42P01' || code === 'PGRST205';
}

const SAVED_INTEGRATION_LIMIT = 10;

const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: false,
  emailEnabled: false,
  launchDayEmailEnabled: false,
  launchDayEmailProviders: [] as string[],
  launchDayEmailStates: [] as string[],
  quietHoursEnabled: false,
  quietStartLocal: null,
  quietEndLocal: null
};

const DEFAULT_LAUNCH_NOTIFICATION_PREFERENCE = {
  enabled: false,
  preference: {
    launchId: '',
    channel: 'push' as const,
    mode: 't_minus' as const,
    timezone: 'UTC',
    tMinusMinutes: [],
    localTimes: [],
    notifyStatusChange: false,
    notifyNetChange: false
  }
};

function retiredNotificationPreferencesPayload() {
  return notificationPreferencesSchemaV1.parse({
    ...DEFAULT_NOTIFICATION_PREFERENCES
  });
}

function retiredLaunchNotificationPreferencePayload(launchId: string) {
  return launchNotificationPreferenceEnvelopeSchemaV1.parse({
    ...DEFAULT_LAUNCH_NOTIFICATION_PREFERENCE,
    preference: {
      ...DEFAULT_LAUNCH_NOTIFICATION_PREFERENCE.preference,
      launchId
    },
    pushStatus: {
      enabled: false,
      subscribed: false
    }
  });
}

function throwRetiredLegacyNotifications() {
  throw new MobileApiRouteError(410, NATIVE_MOBILE_PUSH_ONLY_ERROR);
}

const pushDeviceRemovalInputSchema = pushDeviceRemovalSchemaV1.pick({
  platform: true,
  installationId: true
});

const deleteAccountSchema = z.object({
  confirm: z.string().min(1)
});

export class MobileApiRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'MobileApiRouteError';
    this.status = status;
    this.code = code;
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function mapWatchlistRulePayload(data: any) {
  return watchlistRuleEnvelopeSchemaV1.shape.rule.parse({
    id: String(data?.id || ''),
    ruleType: data?.rule_type ?? 'launch',
    ruleValue: String(data?.rule_value || ''),
    createdAt: normalizeText(data?.created_at)
  });
}

function mapWatchlistPayload(data: any) {
  const rules = Array.isArray(data?.watchlist_rules) ? data.watchlist_rules.map(mapWatchlistRulePayload) : [];

  return watchlistEnvelopeSchemaV1.shape.watchlist.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    ruleCount: rules.length,
    createdAt: normalizeText(data?.created_at),
    rules
  });
}

function mapFilterPresetPayload(data: any) {
  return filterPresetEnvelopeSchemaV1.shape.preset.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    filters: (data?.filters as Record<string, unknown>) || {},
    isDefault: data?.is_default === true,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function normalizeAlertRuleStateValue(value: string) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function formatFollowAlertLabel(ruleType: z.infer<typeof watchlistRuleTypeSchemaV1>, ruleValue: string) {
  if (ruleType === 'provider') return `Followed provider: ${ruleValue}`;
  if (ruleType === 'pad') return `Followed pad: ${ruleValue}`;
  if (ruleType === 'rocket') return `Followed rocket: ${ruleValue}`;
  if (ruleType === 'launch_site') return `Followed launch site: ${ruleValue}`;
  if (ruleType === 'state') return `State launches: ${ruleValue}`;
  if (ruleType === 'tier') return `Followed tier: ${ruleValue}`;
  return `Followed launch: ${ruleValue}`;
}

function mapAlertRulePayload(data: AlertRuleRow) {
  const id = String(data?.id || '');
  const createdAt = normalizeText(data?.created_at);
  const updatedAt = normalizeText(data?.updated_at);
  const kind = data?.kind;

  if (kind === 'state') {
    const state = normalizeAlertRuleStateValue(String(data?.state || ''));
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      state,
      label: `State launches: ${state}`,
      createdAt,
      updatedAt
    });
  }

  if (kind === 'filter_preset') {
    const presetId = String(data?.filter_preset_id || '');
    const presetName = normalizeText(data?.launch_filter_presets?.name) ?? 'Saved filter';
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      presetId,
      label: `Saved filter: ${presetName}`,
      createdAt,
      updatedAt
    });
  }

  if (kind === 'follow') {
    const followRuleType = data?.follow_rule_type ?? 'provider';
    const followRuleValue = String(data?.follow_rule_value || '');
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      followRuleType,
      followRuleValue,
      label: formatFollowAlertLabel(followRuleType, followRuleValue),
      createdAt,
      updatedAt
    });
  }

  return alertRuleEnvelopeSchemaV1.shape.rule.parse({
    id,
    kind: 'region_us',
    label: 'All US launches',
    createdAt,
    updatedAt
  });
}

function mapCalendarFeedPayload(data: any) {
  return calendarFeedEnvelopeSchemaV1.shape.feed.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    filters: (data?.filters as Record<string, unknown>) || {},
    sourceKind: normalizeText(data?.source_kind),
    presetId: normalizeText(data?.source_preset_id),
    followRuleType: normalizeText(data?.source_follow_rule_type),
    followRuleValue: normalizeText(data?.source_follow_rule_value),
    alarmMinutesBefore:
      typeof data?.alarm_minutes_before === 'number' && Number.isFinite(data.alarm_minutes_before)
        ? Math.trunc(data.alarm_minutes_before)
        : data?.alarm_minutes_before == null
          ? null
          : null,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

type CalendarFeedSourceInput = {
  sourceKind?: 'all_launches' | 'preset' | 'follow';
  presetId?: string | null;
  followRuleType?: z.infer<typeof watchlistRuleTypeSchemaV1> | null;
  followRuleValue?: string | null;
  filters?: Record<string, unknown>;
};

type CalendarFeedSourceRow = {
  source_kind?: string | null;
  source_preset_id?: string | null;
  source_follow_rule_type?: z.infer<typeof watchlistRuleTypeSchemaV1> | null;
  source_follow_rule_value?: string | null;
  filters?: Record<string, unknown> | null;
};

async function resolveCalendarFeedSourcePayload(
  client: PrivilegedClient,
  userId: string,
  input: CalendarFeedSourceInput,
  current?: CalendarFeedSourceRow | null
) {
  const sourceKind = input.sourceKind ?? (normalizeText(current?.source_kind) as 'all_launches' | 'preset' | 'follow' | null) ?? 'all_launches';
  const presetId =
    input.presetId !== undefined ? normalizeText(input.presetId) : normalizeText(current?.source_preset_id);
  const followRuleType =
    input.followRuleType !== undefined ? input.followRuleType ?? null : current?.source_follow_rule_type ?? null;
  const followRuleValue =
    input.followRuleValue !== undefined ? normalizeText(input.followRuleValue) : normalizeText(current?.source_follow_rule_value);

  if (sourceKind === 'preset') {
    if (!presetId) {
      throw new MobileApiRouteError(400, 'invalid_feed_source');
    }
    await requireOwnedPreset(client, userId, presetId);
    const { data, error } = await client.from('launch_filter_presets').select('filters').eq('id', presetId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new MobileApiRouteError(404, 'preset_not_found');

    return {
      sourceKind,
      presetId,
      followRuleType: null,
      followRuleValue: null,
      filters: normalizeLaunchFilterValue((input.filters as Record<string, unknown> | undefined) ?? ((data as any).filters ?? {}))
    };
  }

  if (sourceKind === 'follow') {
    if (!followRuleType || !followRuleValue) {
      throw new MobileApiRouteError(400, 'invalid_feed_source');
    }
    const normalizedFollow = normalizeWatchlistRule(followRuleType, followRuleValue);
    if (!normalizedFollow) {
      throw new MobileApiRouteError(400, 'invalid_rule_value');
    }
    await requireUserOwnedFollowRule(client, userId, normalizedFollow.rule_type, normalizedFollow.rule_value);

    const baseFilters =
      input.filters !== undefined
        ? normalizeLaunchFilterValue(input.filters)
        : normalizedFollow.rule_type === 'provider'
          ? normalizeLaunchFilterValue({ range: 'all', region: 'all', sort: 'soonest', provider: normalizedFollow.rule_value })
          : normalizeLaunchFilterValue({ range: 'all', region: 'all', sort: 'soonest' });

    return {
      sourceKind,
      presetId: null,
      followRuleType: normalizedFollow.rule_type,
      followRuleValue: normalizedFollow.rule_value,
      filters: baseFilters
    };
  }

  return {
    sourceKind: 'all_launches' as const,
    presetId: null,
    followRuleType: null,
    followRuleValue: null,
    filters: normalizeLaunchFilterValue(
      input.filters !== undefined ? input.filters : (current?.filters as Record<string, unknown> | undefined) ?? { range: 'all', region: 'all', sort: 'soonest' }
    )
  };
}

function mapRssFeedPayload(data: any) {
  return rssFeedEnvelopeSchemaV1.shape.feed.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    filters: (data?.filters as Record<string, unknown>) || {},
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function mapEmbedWidgetPayload(data: any) {
  return embedWidgetEnvelopeSchemaV1.shape.widget.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    widgetType: String(data?.widget_type || 'next_launch_card'),
    filters: (data?.filters as Record<string, unknown>) || {},
    presetId: normalizeText(data?.preset_id),
    watchlistId: normalizeText(data?.watchlist_id),
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function parseUuidOrThrow(value: string, code: string) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new MobileApiRouteError(400, code);
  }
  return normalized;
}

function normalizeWatchlistRule(
  ruleType: 'launch' | 'pad' | 'provider' | 'rocket' | 'launch_site' | 'state' | 'tier',
  ruleValue: string
): { rule_type: 'launch' | 'pad' | 'provider' | 'rocket' | 'launch_site' | 'state' | 'tier'; rule_value: string } | null {
  const scope = normalizeWatchScope(ruleType, ruleValue);
  if (!scope) return null;
  if (scope.scopeKind === 'launch') return { rule_type: 'launch', rule_value: scope.launchId };
  if (scope.scopeKind === 'pad') return { rule_type: 'pad', rule_value: scope.padKey };
  if (scope.scopeKind === 'provider') return { rule_type: 'provider', rule_value: scope.provider };
  if (scope.scopeKind === 'rocket') {
    return { rule_type: 'rocket', rule_value: scope.rocketId ? `ll2:${scope.rocketId}` : scope.rocketLabel ?? scope.scopeKey };
  }
  if (scope.scopeKind === 'launch_site') return { rule_type: 'launch_site', rule_value: scope.launchSite };
  if (scope.scopeKind === 'state') return { rule_type: 'state', rule_value: scope.state };
  if (scope.scopeKind === 'tier') return { rule_type: 'tier', rule_value: scope.tier };
  return null;
}

function mapNotificationPreferencesPayload(data: any) {
  return notificationPreferencesSchemaV1.parse({
    pushEnabled: data?.push_enabled === true,
    emailEnabled: data?.email_enabled !== false,
    launchDayEmailEnabled: data?.launch_day_email_enabled === true,
    launchDayEmailProviders: normalizeStringList(data?.launch_day_email_providers, 80),
    launchDayEmailStates: normalizeStringList(data?.launch_day_email_states, 80),
    quietHoursEnabled: data?.quiet_hours_enabled === true,
    quietStartLocal: normalizeText(data?.quiet_start_local),
    quietEndLocal: normalizeText(data?.quiet_end_local)
  });
}

function mapPrivacyPreferencesPayload(data: any) {
  return privacyPreferencesSchemaV1.parse({
    optOutSaleShare: data?.opt_out_sale_share === true,
    limitSensitive: data?.limit_sensitive === true,
    blockThirdPartyEmbeds: data?.block_third_party_embeds === true,
    gpcEnabled: data?.gpc_enabled === true,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function normalizeStringList(values: unknown, max: number) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .slice(0, max)
    .sort((left, right) => left.localeCompare(right));
}

function mapPushDevicePayload(data: any, fallback: any) {
  return pushDeviceRegistrationSchemaV1.parse({
    platform: data?.platform ?? fallback.platform,
    installationId: data?.installation_id ?? fallback.installationId,
    token: data?.token ?? fallback.token,
    appVersion: data?.app_version ?? fallback.appVersion ?? null,
    deviceName: data?.device_name ?? fallback.deviceName ?? null,
    pushProvider: data?.push_provider ?? fallback.pushProvider ?? null,
    active: data?.is_active ?? fallback.active ?? true,
    registeredAt: normalizeText(data?.last_registered_at) ?? normalizeText(data?.updated_at) ?? fallback.registeredAt ?? null,
    lastSentAt: normalizeText(data?.last_sent_at),
    lastReceiptAt: normalizeText(data?.last_receipt_at),
    lastFailureReason: normalizeText(data?.last_failure_reason),
    disabledAt: normalizeText(data?.disabled_at)
  });
}

function sortByPublishedAtDesc<T extends { publishedAt: string | null }>(items: T[]) {
  return items.sort((left, right) => {
    const leftMs = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
    const rightMs = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
    return rightMs - leftMs;
  });
}

function buildWeatherSummary(launch: ReturnType<typeof mapPublicCacheRow>) {
  if (!Array.isArray(launch.weatherConcerns) || launch.weatherConcerns.length === 0) {
    return null;
  }
  return launch.weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean).join(' • ') || null;
}

function normalizeUrlString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function normalizeRelatedNewsItemType(value: unknown): 'article' | 'blog' | 'report' | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'article' || normalized === 'blog' || normalized === 'report' ? normalized : null;
}

function formatUrlHost(value: string | null | undefined) {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./i, '').trim();
    return host || null;
  } catch {
    return null;
  }
}

function extractXStatusId(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const match = raw.match(/\/status\/(\d+)/i);
  return match?.[1] ? match[1] : null;
}

function buildGoogleMapsUrl(launch: ReturnType<typeof mapPublicCacheRow>) {
  const latitude = launch.pad?.latitude;
  const longitude = launch.pad?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function normalizeInfoLinks(
  primary: Array<{ url?: string; title?: string; source?: string; type?: { name?: string } }> = [],
  secondary: Array<{ url?: string; title?: string; source?: string; type?: { name?: string } }> = []
) {
  const items = [...primary, ...secondary];
  const seen = new Set<string>();
  const normalized: Array<{ url: string; label: string; meta: string }> = [];

  for (const item of items) {
    const url = normalizeUrlString(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      url,
      label: item?.title?.trim() || item?.source?.trim() || item?.type?.name?.trim() || 'Mission info',
      meta: item?.source?.trim() || item?.type?.name?.trim() || 'Info'
    });
  }

  return normalized;
}

function normalizeVidLinks(
  primary: Array<{ url?: string; title?: string; publisher?: string; source?: string; type?: { name?: string }; feature_image?: string }> = [],
  secondary: Array<{ url?: string; title?: string; publisher?: string; source?: string; type?: { name?: string }; feature_image?: string }> = []
) {
  const items = [...primary, ...secondary];
  const seen = new Set<string>();
  const normalized: Array<{ url: string; label: string; meta: string; imageUrl: string | null }> = [];

  for (const item of items) {
    const url = normalizeUrlString(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      url,
      label: item?.title?.trim() || item?.publisher?.trim() || item?.source?.trim() || 'Video',
      meta: item?.type?.name?.trim() || 'Video',
      imageUrl: normalizeUrlString(item?.feature_image) || null
    });
  }

  return normalized;
}

function buildWatchLinks(launch: ReturnType<typeof mapPublicCacheRow>) {
  const items: Array<{ url: string; label: string; meta: string; imageUrl: string | null; host: string | null; kind: string }> = [];
  const seen = new Set<string>();
  const fallbackImage = normalizeUrlString(launch.image.full) || normalizeUrlString(launch.image.thumbnail) || null;
  const missionVidLinks = normalizeVidLinks(launch.launchVidUrls || [], launch.mission?.vidUrls || []);

  const add = (url: string | null | undefined, label: string | null | undefined, meta: string | null | undefined, imageUrl?: string | null) => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    items.push({
      url: normalizedUrl,
      label: String(label || 'Watch coverage').trim() || 'Watch coverage',
      meta: String(meta || formatUrlHost(normalizedUrl) || 'Live/Replay').trim() || 'Live/Replay',
      imageUrl: normalizeUrlString(imageUrl) || fallbackImage,
      host: formatUrlHost(normalizedUrl),
      kind: 'watch'
    });
  };

  add(launch.videoUrl, 'Watch coverage', 'Live/Replay', fallbackImage);
  for (const item of missionVidLinks) {
    add(item.url, item.label, item.meta, item.imageUrl || fallbackImage);
  }

  return items;
}

function buildExternalLinks(launch: ReturnType<typeof mapPublicCacheRow>) {
  const seen = new Set<string>();
  const links: Array<{ url: string; label: string; meta: string; imageUrl: null; host: string | null; kind: string }> = [];
  const infoLinks = normalizeInfoLinks(launch.launchInfoUrls || [], launch.mission?.infoUrls || []);
  const googleMapsUrl = buildGoogleMapsUrl(launch);
  const padMapUrl = googleMapsUrl || normalizeUrlString(launch.pad?.mapUrl) || null;

  const add = (url: string | null | undefined, label: string | null | undefined, meta: string | null | undefined, kind = 'resource') => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    links.push({
      url: normalizedUrl,
      label: String(label || formatUrlHost(normalizedUrl) || 'Source').trim() || 'Source',
      meta: String(meta || 'External link').trim() || 'External link',
      imageUrl: null,
      host: formatUrlHost(normalizedUrl),
      kind
    });
  };

  for (const item of infoLinks) {
    add(item.url, item.label, item.meta, 'resource');
  }
  if (padMapUrl) {
    add(padMapUrl, googleMapsUrl ? 'Pad satellite map' : 'Pad map', googleMapsUrl ? 'Satellite' : 'Location', 'map');
  }
  add(launch.rocket?.infoUrl, 'Vehicle info', 'Vehicle', 'rocket');
  add(launch.rocket?.wikiUrl, 'Vehicle wiki', 'Reference', 'rocket');
  add(launch.flightclubUrl, 'Trajectory (Flight Club)', 'Trajectory', 'trajectory');

  return links;
}

function flattenMissionResources(enrichment: Awaited<ReturnType<typeof fetchLaunchDetailEnrichment>>) {
  const rows: Array<{ id: string; title: string; subtitle: string | null; url: string }> = [];
  const seen = new Set<string>();
  for (const item of enrichment.externalContent || []) {
    const resources = selectPreferredResponsiveLaunchExternalResources(item.resources || [], 'mobile');
    for (const resource of resources) {
      const url = normalizeUrlString(resource?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push({
        id: resource.id,
        title: resource.label || item.title || 'Mission resource',
        subtitle: resource.kind || item.contentType || null,
        url
      });
    }
  }
  return rows;
}

function flattenMissionTimeline({
  launchTimeline,
  enrichment
}: {
  launchTimeline?: unknown[] | null;
  enrichment: Awaited<ReturnType<typeof fetchLaunchDetailEnrichment>>;
}) {
  return buildLaunchMissionTimeline({
    ll2Timeline: launchTimeline,
    providerExternalContent: enrichment.externalContent || [],
    includeFamilyTemplate: false
  }).map((event) => ({
    id: event.id,
    label: event.label,
    time: event.time,
    description: event.description,
    phase: event.phase
  }));
}

async function loadRelatedNewsItems(launchId: string) {
  if (!isSupabaseConfigured()) return [] as Array<{
    id: string;
    title: string;
    url: string;
    newsSite: string | null;
    summary: string | null;
    imageUrl: string | null;
    publishedAt: string | null;
    itemType: 'article' | 'blog' | 'report' | null;
    authors: string[];
    featured: boolean | null;
  }>;

  const supabase = createSupabasePublicClient();
  const newsJoinRes = await supabase.from('snapi_item_launches').select('snapi_uid').eq('launch_id', launchId);
  if (newsJoinRes.error) throw newsJoinRes.error;

  const newsIds = Array.from(new Set((newsJoinRes.data || []).map((row: any) => normalizeText(row.snapi_uid)).filter(Boolean)));
  if (!newsIds.length) return [];

  const newsRes = await supabase
    .from('snapi_items')
    .select('snapi_uid, item_type, title, summary, url, news_site, image_url, published_at, authors, featured')
    .in('snapi_uid', newsIds)
    .order('published_at', { ascending: false })
    .limit(8);

  if (newsRes.error) throw newsRes.error;

  return ((newsRes.data || []) as RelatedNewsRow[]).map((row) => ({
    id: String(row.snapi_uid || ''),
    title: String(row.title || 'Untitled article'),
    url: String(row.url || ''),
    newsSite: normalizeText(row.news_site),
    summary: normalizeText(row.summary),
    imageUrl: normalizeText(row.image_url),
    publishedAt: normalizeText(row.published_at),
    itemType: normalizeRelatedNewsItemType(row.item_type),
    authors: Array.isArray(row.authors)
      ? row.authors.map((author) => String(author?.name || '').trim()).filter(Boolean)
      : [],
    featured: typeof row.featured === 'boolean' ? row.featured : null
  }));
}

async function loadRelatedEventItems(launchId: string) {
  if (!isSupabaseConfigured()) return [] as Array<{
    id: number;
    name: string;
    description: string | null;
    typeName: string | null;
    date: string | null;
    datePrecision: string | null;
    locationName: string | null;
    url: string | null;
    imageUrl: string | null;
    webcastLive: boolean | null;
  }>;

  const supabase = createSupabasePublicClient();
  const eventJoinRes = await supabase.from('ll2_event_launches').select('ll2_event_id').eq('launch_id', launchId);
  if (eventJoinRes.error) throw eventJoinRes.error;

  const eventIds = Array.from(new Set((eventJoinRes.data || []).map((row: any) => row.ll2_event_id).filter((value) => Number.isFinite(value))));
  if (!eventIds.length) return [];

  const eventRes = await supabase
    .from('ll2_events')
    .select('ll2_event_id, name, description, type_name, date, date_precision, location_name, url, image_url, webcast_live')
    .in('ll2_event_id', eventIds)
    .limit(8);

  if (eventRes.error) throw eventRes.error;

  return ((eventRes.data || []) as RelatedEventRow[]).map((row) => ({
    id: Number(row.ll2_event_id || 0),
    name: String(row.name || 'Related event'),
    description: normalizeText(row.description),
    typeName: normalizeText(row.type_name),
    date: normalizeText(row.date),
    datePrecision: normalizeText(row.date_precision),
    locationName: normalizeText(row.location_name),
    url: normalizeUrlString(row.url),
    imageUrl: normalizeText(row.image_url),
    webcastLive: typeof row.webcast_live === 'boolean' ? row.webcast_live : null
  }));
}

async function fetchWs45Forecast(launchId: string, isEasternRange: boolean) {
  if (!isSupabaseConfigured() || !isEasternRange) return null as Ws45Forecast | null;
  const client = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : createSupabaseServerClient();
  const { data, error } = await client
    .from('ws45_launch_forecasts')
    .select(
      'id, source_label, forecast_kind, pdf_url, issued_at, valid_start, valid_end, mission_name, match_status, match_confidence, forecast_discussion, launch_day_pov_percent, delay_24h_pov_percent, launch_day_primary_concerns, delay_24h_primary_concerns, launch_day, delay_24h'
    )
    .eq('matched_launch_id', launchId)
    .eq('publish_eligible', true)
    .or('forecast_kind.is.null,forecast_kind.neq.faq')
    .order('issued_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(1);

  if (error) return null;
  return (data?.[0] as Ws45Forecast | undefined) ?? null;
}

async function fetchNwsForecast(launchId: string, isUsPad: boolean, within14Days: boolean) {
  if (!isSupabaseConfigured() || !isUsPad || !within14Days) return null as NwsLaunchWeather | null;
  const client = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : createSupabaseServerClient();
  const { data, error } = await client
    .from('launch_weather')
    .select('id, issued_at, valid_start, valid_end, summary, probability, data')
    .eq('launch_id', launchId)
    .eq('source', 'nws')
    .maybeSingle();

  if (error) return null;
  return (data as NwsLaunchWeather | null) ?? null;
}

function buildWeatherModule(
  launch: ReturnType<typeof mapPublicCacheRow>,
  ws45Forecast: Ws45Forecast | null,
  nwsForecast: NwsLaunchWeather | null
) {
  const concerns = Array.isArray(launch.weatherConcerns)
    ? launch.weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const cards: Array<{
    id: string;
    source: 'ws45' | 'nws';
    title: string;
    subtitle: string | null;
    issuedAt: string | null;
    validStart: string | null;
    validEnd: string | null;
    headline: string | null;
    detail: string | null;
    badges: string[];
    metrics: Array<{ label: string; value: string }>;
    actionLabel: string | null;
    actionUrl: string | null;
  }> = [];

  if (ws45Forecast) {
    const launchDayPov =
      typeof ws45Forecast.launch_day?.povPercent === 'number'
        ? ws45Forecast.launch_day.povPercent
        : typeof ws45Forecast.launch_day_pov_percent === 'number'
          ? ws45Forecast.launch_day_pov_percent
          : null;
    const delayPov =
      typeof ws45Forecast.delay_24h?.povPercent === 'number'
        ? ws45Forecast.delay_24h.povPercent
        : typeof ws45Forecast.delay_24h_pov_percent === 'number'
          ? ws45Forecast.delay_24h_pov_percent
          : null;
    const launchDayConcerns =
      ws45Forecast.launch_day?.primaryConcerns ||
      ws45Forecast.launch_day_primary_concerns ||
      [];
    const badges = [
      ws45Forecast.forecast_kind || null,
      ws45Forecast.match_status
        ? ws45Forecast.match_confidence != null
          ? `Match ${ws45Forecast.match_status} (${Math.round(ws45Forecast.match_confidence)}%)`
          : `Match ${ws45Forecast.match_status}`
        : null,
      ...launchDayConcerns.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 3)
    ].filter(Boolean) as string[];
    const metrics = [
      launchDayPov != null ? { label: 'Launch Day PoV', value: `${Math.round(launchDayPov)}%` } : null,
      delayPov != null ? { label: '24h Delay PoV', value: `${Math.round(delayPov)}%` } : null,
      ws45Forecast.launch_day?.weatherVisibility
        ? { label: 'Weather', value: ws45Forecast.launch_day.weatherVisibility }
        : null,
      ws45Forecast.launch_day?.tempF != null
        ? { label: 'Temp', value: `${Math.round(ws45Forecast.launch_day.tempF)}°F` }
        : null
    ].filter(Boolean) as Array<{ label: string; value: string }>;
    cards.push({
      id: `ws45:${ws45Forecast.id}`,
      source: 'ws45',
      title: '45 WS enhanced forecast',
      subtitle: ws45Forecast.source_label || ws45Forecast.mission_name || null,
      issuedAt: ws45Forecast.issued_at || null,
      validStart: ws45Forecast.valid_start || null,
      validEnd: ws45Forecast.valid_end || null,
      headline: launchDayPov != null ? `Launch Day PoV ${Math.round(launchDayPov)}%` : 'Launch weather brief',
      detail: ws45Forecast.forecast_discussion || null,
      badges,
      metrics,
      actionLabel: normalizeUrlString(ws45Forecast.pdf_url) ? 'View PDF' : null,
      actionUrl: normalizeUrlString(ws45Forecast.pdf_url)
    });
  }

  if (nwsForecast) {
    const period = nwsForecast.data?.period ?? null;
    const shortForecast =
      normalizeText(nwsForecast.summary) ||
      (typeof period?.shortForecast === 'string' ? period.shortForecast.trim() : null);
    const detailedForecast =
      typeof period?.detailedForecast === 'string' && period.detailedForecast.trim()
        ? period.detailedForecast.trim()
        : null;
    const wind = [
      typeof period?.windDirection === 'string' ? period.windDirection.trim() : null,
      typeof period?.windSpeed === 'string' ? period.windSpeed.trim() : null
    ]
      .filter(Boolean)
      .join(' ');
    const metrics = [
      typeof period?.temperature === 'number'
        ? { label: 'Temp', value: `${Math.round(period.temperature)}°${String(period.temperatureUnit || 'F').trim() || 'F'}` }
        : null,
      nwsForecast.probability != null ? { label: 'Precip', value: `${Math.round(Number(nwsForecast.probability) || 0)}%` } : null,
      wind ? { label: 'Wind', value: wind } : null,
      period?.relativeHumidity?.value != null
        ? { label: 'Humidity', value: `${Math.round(Number(period.relativeHumidity.value) || 0)}%` }
        : null
    ].filter(Boolean) as Array<{ label: string; value: string }>;
    const badges = [
      typeof period?.name === 'string' ? period.name.trim() : null,
      typeof period?.isDaytime === 'boolean' ? (period.isDaytime ? 'Daytime' : 'Night') : null,
      typeof nwsForecast.data?.forecastKind === 'string' ? `${nwsForecast.data.forecastKind} match` : null
    ].filter(Boolean) as string[];
    cards.push({
      id: `nws:${nwsForecast.id}`,
      source: 'nws',
      title: 'National Weather Service',
      subtitle: 'Forecast at the pad',
      issuedAt: nwsForecast.issued_at || null,
      validStart: nwsForecast.valid_start || null,
      validEnd: nwsForecast.valid_end || null,
      headline: shortForecast,
      detail: detailedForecast,
      badges,
      metrics,
      actionLabel: null,
      actionUrl: null
    });
  }

  if (!cards.length && concerns.length === 0) {
    return null;
  }

  return {
    summary: buildWeatherSummary(launch),
    concerns,
    cards
  };
}

async function fetchPayloadManifest(ll2LaunchUuid: string) {
  if (!ll2LaunchUuid || !isSupabaseConfigured()) return [] as PayloadManifestEntry[];
  const supabase = createSupabaseServerClient();

  let { data, error } = await supabase.rpc('get_launch_payload_manifest_v2', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_raw: false
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await supabase.rpc('get_launch_payload_manifest', { ll2_launch_uuid_in: ll2LaunchUuid });
    data = fallback.data;
    error = fallback.error;
  }

  if (error || data == null) return [] as PayloadManifestEntry[];
  return parseRpcArray<PayloadManifestEntry>(data);
}

async function fetchLaunchObjectInventory(ll2LaunchUuid: string) {
  if (!ll2LaunchUuid || !isSupabaseConfigured()) return null as LaunchObjectInventory | null;
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_launch_object_inventory_v1', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_orbit: true,
    history_limit: 5
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await supabase.rpc('get_launch_satellite_payloads_v2', {
      ll2_launch_uuid_in: ll2LaunchUuid,
      include_raw: false
    });
    if (fallback.error || fallback.data == null) return null as LaunchObjectInventory | null;
    const payloads = parseRpcArray<LaunchInventoryObject>(fallback.data);
    return {
      reconciliation: {
        ll2_manifest_payload_count: null,
        satcat_payload_count: payloads.length,
        satcat_total_count: payloads.length,
        satcat_type_counts: { PAY: payloads.length, RB: 0, DEB: 0, UNK: 0 },
        delta_manifest_vs_satcat_payload: null
      },
      satcat_payload_objects: payloads,
      satcat_non_payload_objects: []
    } satisfies LaunchObjectInventory;
  }

  if (error || data == null) return null as LaunchObjectInventory | null;
  return parseRpcObject<LaunchObjectInventory>(data);
}

function parseRpcArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as T[]) : ([] as T[]);
    } catch {
      return [] as T[];
    }
  }
  return [] as T[];
}

function parseRpcObject<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as T;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isMissingRpcFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === '42883') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('function') && msg.includes('does not exist');
}

function buildManifestLandingSummary(landing: PayloadManifestEntry['landing']) {
  if (!landing) return null;
  const outcome =
    landing.attempt === true
      ? landing.success === true
        ? 'Successful landing'
        : landing.success === false
          ? 'Failed landing'
          : 'Landing attempted'
      : landing.attempt === false
        ? 'No landing attempt'
        : null;
  const location =
    landing.landing_location && typeof landing.landing_location === 'object'
      ? ((landing.landing_location as Record<string, unknown>).name ||
          (landing.landing_location as Record<string, unknown>).abbrev ||
          null)
      : null;
  return [outcome, location ? `@ ${location}` : null].filter(Boolean).join(' • ') || null;
}

function buildDockingSummary(events: PayloadManifestEntry['docking_events']) {
  const rows = Array.isArray(events) ? events : [];
  if (!rows.length) return null;
  if (rows.length === 1) {
    const row = rows[0] || null;
    const station =
      row?.space_station_target && typeof row.space_station_target === 'object'
        ? row.space_station_target.name || null
        : null;
    return station ? `Docking @ ${station}` : 'Docking event';
  }
  return `${rows.length} docking events`;
}

function buildPayloadManifestModule(manifest: PayloadManifestEntry[]) {
  return (Array.isArray(manifest) ? manifest : []).map((entry) => {
    const payload = entry.payload || null;
    const title = payload?.name || `${entry.kind === 'spacecraft_flight' ? 'Spacecraft' : 'Payload'} ${entry.id}`;
    const subtitle = [payload?.type?.name || null, payload?.operator?.name || payload?.manufacturer?.name || null]
      .filter(Boolean)
      .join(' • ');
    return {
      id: `${entry.kind || 'payload'}:${entry.id}`,
      kind: entry.kind === 'spacecraft_flight' ? 'spacecraft' : 'payload',
      title,
      subtitle: subtitle || null,
      description: payload?.description || normalizeText(entry.deployment_notes),
      imageUrl: normalizeUrlString(payload?.image?.thumbnail_url || payload?.image?.image_url || null),
      destination: normalizeText(entry.destination),
      deploymentStatus: normalizeText(entry.deployment_status),
      operator: normalizeText(payload?.operator?.name),
      manufacturer: normalizeText(payload?.manufacturer?.name),
      infoUrl: normalizeUrlString(payload?.info_link),
      wikiUrl: normalizeUrlString(payload?.wiki_link),
      landingSummary: buildManifestLandingSummary(entry.landing || null),
      dockingSummary: buildDockingSummary(entry.docking_events || [])
    };
  });
}

function formatCount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US').format(value);
}

function readInventoryCount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function formatSignedCount(value: number) {
  if (!Number.isFinite(value) || value === 0) return '0';
  const formatted = formatCount(Math.abs(value));
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}

function buildObjectInventoryCard(obj: LaunchInventoryObject) {
  const id = String(obj.object_id || obj.intl_des || obj.norad_cat_id || obj.name || 'object');
  const title = String(obj.name || obj.intl_des || obj.object_id || `Object ${obj.norad_cat_id || ''}`).trim() || 'Object';
  const subtitle = [normalizeText(obj.object_type), normalizeText(obj.owner)].filter(Boolean).join(' • ') || null;
  const lines = [
    obj.norad_cat_id != null ? `NORAD ${obj.norad_cat_id}` : null,
    obj.orbit_type ? `Orbit ${obj.orbit_type}` : null,
    obj.launch_date ? `Launch ${obj.launch_date}` : null,
    obj.apogee_km != null ? `Apogee ${Math.round(obj.apogee_km)} km` : null,
    obj.perigee_km != null ? `Perigee ${Math.round(obj.perigee_km)} km` : null,
    obj.period_min != null ? `Period ${Math.round(obj.period_min)} min` : null,
    obj.orbit?.epoch ? `Epoch ${obj.orbit.epoch}` : null
  ].filter(Boolean) as string[];
  return { id, title, subtitle, lines };
}

function buildObjectInventoryModule(inventory: LaunchObjectInventory | null) {
  if (!inventory) return null;
  const status = inventory.inventory_status || null;
  const reconciliation = inventory.reconciliation || null;
  const typeCounts = reconciliation?.satcat_type_counts || null;
  const payloadObjects = Array.isArray(inventory.satcat_payload_objects)
    ? inventory.satcat_payload_objects.map(buildObjectInventoryCard)
    : [];
  const nonPayloadObjects = Array.isArray(inventory.satcat_non_payload_objects)
    ? inventory.satcat_non_payload_objects.map(buildObjectInventoryCard)
    : [];
  const catalogState = normalizeText(status?.catalog_state);
  const manifestPayloadCount = readInventoryCount(reconciliation?.ll2_manifest_payload_count);
  const satcatPayloadCount = readInventoryCount(reconciliation?.satcat_payload_count);
  const satcatPayloadsFilterCount = readInventoryCount(reconciliation?.satcat_payloads_filter_count);
  const satcatTotalCount = readInventoryCount(reconciliation?.satcat_total_count);
  const payCount = readInventoryCount(typeCounts?.PAY);
  const rbCount = readInventoryCount(typeCounts?.RB);
  const debCount = readInventoryCount(typeCounts?.DEB);
  const unkCount = readInventoryCount(typeCounts?.UNK);
  const deltaManifestVsSatcatPayload = readInventoryCount(reconciliation?.delta_manifest_vs_satcat_payload);
  const hasCatalogEvidence =
    catalogState === 'catalog_available' ||
    payloadObjects.length > 0 ||
    nonPayloadObjects.length > 0;
  const summaryBadges = [
    hasCatalogEvidence && manifestPayloadCount != null ? `Manifest ${formatCount(manifestPayloadCount)}` : null,
    hasCatalogEvidence && satcatPayloadCount != null ? `SATCAT payloads ${formatCount(satcatPayloadCount)}` : null,
    hasCatalogEvidence && satcatTotalCount != null ? `Total objects ${formatCount(satcatTotalCount)}` : null,
    hasCatalogEvidence && rbCount != null && rbCount > 0 ? `RB ${formatCount(rbCount)}` : null,
    hasCatalogEvidence && debCount != null && debCount > 0 ? `Debris ${formatCount(debCount)}` : null,
    hasCatalogEvidence && unkCount != null && unkCount > 0 ? `Unknown ${formatCount(unkCount)}` : null,
    hasCatalogEvidence && deltaManifestVsSatcatPayload != null && deltaManifestVsSatcatPayload !== 0
      ? `Delta ${formatSignedCount(deltaManifestVsSatcatPayload)}`
      : null
  ].filter(Boolean) as string[];
  const normalizedStatus =
    catalogState ||
    status?.last_checked_at ||
    status?.last_success_at ||
    status?.last_error ||
    status?.last_non_empty_at ||
    status?.latest_snapshot_hash
      ? {
          catalogState: catalogState ?? null,
          lastCheckedAt: normalizeText(status?.last_checked_at),
          lastSuccessAt: normalizeText(status?.last_success_at),
          lastError: normalizeText(status?.last_error),
          lastNonEmptyAt: normalizeText(status?.last_non_empty_at),
          latestSnapshotHash: normalizeText(status?.latest_snapshot_hash)
        }
      : null;
  const normalizedReconciliation =
    manifestPayloadCount != null ||
    satcatPayloadCount != null ||
    satcatPayloadsFilterCount != null ||
    satcatTotalCount != null ||
    payCount != null ||
    rbCount != null ||
    debCount != null ||
    unkCount != null ||
    deltaManifestVsSatcatPayload != null
      ? {
          manifestPayloadCount,
          satcatPayloadCount,
          satcatPayloadsFilterCount,
          satcatTotalCount,
          satcatTypeCounts:
            payCount != null || rbCount != null || debCount != null || unkCount != null
              ? {
                  PAY: payCount,
                  RB: rbCount,
                  DEB: debCount,
                  UNK: unkCount
                }
              : null,
          deltaManifestVsSatcatPayload
        }
      : null;
  if (
    !summaryBadges.length &&
    !payloadObjects.length &&
    !nonPayloadObjects.length &&
    !normalizedStatus &&
    !normalizedReconciliation &&
    !normalizeText(inventory.launch_designator)
  ) {
    return null;
  }
  return {
    launchDesignator: normalizeText(inventory.launch_designator),
    status: normalizedStatus,
    reconciliation: normalizedReconciliation,
    summaryBadges,
    payloadObjects,
    nonPayloadObjects
  };
}

function escapeOrValue(value: string) {
  return value.replace(/[(),]/g, '').replace(/"/g, '\\"');
}

function buildVehicleOrFilter(values: string[]) {
  const normalized = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  if (!normalized.length) return null;
  return normalized
    .map((value) => `vehicle.eq."${escapeOrValue(value)}",rocket_full_name.eq."${escapeOrValue(value)}"`)
    .join(',');
}

function classifyLaunchOutcome(statusName?: string | null, statusAbbrev?: string | null) {
  const combined = `${statusName ?? ''} ${statusAbbrev ?? ''}`.toLowerCase();
  const isSuccess = combined.includes('success') || combined.includes('successful');
  const isFailure = combined.includes('fail') || combined.includes('anomaly') || combined.includes('partial');
  return { isSuccess: isSuccess && !isFailure, isFailure };
}

async function fetchRocketOutcomeStats(rocketFullName?: string, vehicle?: string) {
  if (!isSupabaseConfigured()) return null as RocketOutcomeStats | null;
  const filters = [rocketFullName, vehicle]
    .map((value) => value?.trim())
    .filter((value) => value && value.toLowerCase() !== 'unknown') as string[];
  if (filters.length === 0) return null;
  const supabase = createSupabaseServerClient();
  const orFilter = buildVehicleOrFilter(filters);
  if (!orFilter) return null;
  const { data, error } = await supabase.from('launches_public_cache').select('status_name, status_abbrev, net').or(orFilter);
  if (error || !data) return null;

  const year = new Date().getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  let successAllTime = 0;
  let failureAllTime = 0;
  let successYear = 0;
  let failureYear = 0;

  for (const row of data as Array<Record<string, any>>) {
    const statusMeta = classifyLaunchOutcome(row.status_name, row.status_abbrev);
    if (!statusMeta.isSuccess && !statusMeta.isFailure) continue;
    const netMs = row.net ? Date.parse(row.net) : NaN;
    const isYear = Number.isFinite(netMs) && netMs >= yearStart && netMs < yearEnd;

    if (statusMeta.isSuccess) {
      successAllTime += 1;
      if (isYear) successYear += 1;
    }
    if (statusMeta.isFailure) {
      failureAllTime += 1;
      if (isYear) failureYear += 1;
    }
  }

  return { successAllTime, failureAllTime, successYear, failureYear };
}

async function fetchVehicleTimelineRows(launch: ReturnType<typeof mapPublicCacheRow>) {
  if (!isSupabaseConfigured()) return [] as Array<Record<string, any>>;
  const filters = [launch.vehicle, launch.rocket?.fullName]
    .map((value) => value?.trim())
    .filter((value) => value && value.toLowerCase() !== 'unknown') as string[];
  if (filters.length === 0) return [] as Array<Record<string, any>>;

  const supabase = createSupabaseServerClient();
  const orFilter = buildVehicleOrFilter(filters);
  if (!orFilter) return [] as Array<Record<string, any>>;

  const select = 'launch_id, name, mission_name, net, status_name, status_abbrev, vehicle, rocket_full_name';
  const currentNetMs = launch.net ? Date.parse(launch.net) : NaN;
  const currentNet = Number.isFinite(currentNetMs) ? launch.net : null;

  if (!currentNet) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(select)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .or(orFilter)
      .order('net', { ascending: false })
      .limit(24);
    if (error || !data) return [] as Array<Record<string, any>>;
    return (data as Array<Record<string, any>>).sort((a, b) => {
      const aTime = a.net ? Date.parse(a.net) : NaN;
      const bTime = b.net ? Date.parse(b.net) : NaN;
      return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
    });
  }

  const [pastResponse, futureResponse] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select(select)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .or(orFilter)
      .lte('net', currentNet)
      .order('net', { ascending: false })
      .limit(18),
    supabase
      .from('launches_public_cache')
      .select(select)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .or(orFilter)
      .gt('net', currentNet)
      .order('net', { ascending: true })
      .limit(8)
  ]);

  const pastRows = pastResponse.error || !pastResponse.data ? [] : (pastResponse.data as Array<Record<string, any>>);
  const futureRows = futureResponse.error || !futureResponse.data ? [] : (futureResponse.data as Array<Record<string, any>>);
  const merged = new Map<string, Record<string, any>>();

  for (const row of [...pastRows, ...futureRows]) {
    const launchId = String(row.launch_id || '').trim();
    if (!launchId) continue;
    merged.set(launchId, row);
  }

  return [...merged.values()].sort((a, b) => {
    const aTime = a.net ? Date.parse(a.net) : NaN;
    const bTime = b.net ? Date.parse(b.net) : NaN;
    return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
  });
}

function formatRate(success: number, total: number) {
  if (total <= 0) return '0%';
  return `${Math.round((success / total) * 100)}%`;
}

function formatDurationMs(ms: number) {
  const totalSeconds = Math.round(Math.abs(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && days === 0) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${totalSeconds}s`);
  return parts.join(' ');
}

function formatWindowLength(windowStart?: string | null, windowEnd?: string | null) {
  if (!windowStart || !windowEnd) return null;
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return formatDurationMs(endMs - startMs);
}

function formatPadTurnaround(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = parseIsoDurationToMs(trimmed);
  if (ms == null) return trimmed;
  return formatDurationMs(ms);
}

function buildStoryLine(subject: string, allTime: number | null, year: number | null, unit: string, yearLabel: string) {
  if (allTime != null && year != null) {
    return `${subject} has ${formatCount(allTime)} ${unit} on record, with ${formatCount(year)} in ${yearLabel}.`;
  }
  if (allTime != null) {
    return `${subject} has ${formatCount(allTime)} ${unit} on record.`;
  }
  if (year != null) {
    return `${subject} has ${formatCount(year)} ${unit} in ${yearLabel}.`;
  }
  return `Catalog counts for ${subject} are still loading.`;
}

function buildMissionStatsModule(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rocketStats: RocketOutcomeStats | null,
  boosterStats: Awaited<ReturnType<typeof fetchLaunchBoosterStats>>
) {
  const currentYear = new Date().getUTCFullYear();
  const yearLabel = String(currentYear);
  const providerAllTime = typeof launch.agencyLaunchAttemptCount === 'number' ? launch.agencyLaunchAttemptCount : null;
  const providerYear = typeof launch.agencyLaunchAttemptCountYear === 'number' ? launch.agencyLaunchAttemptCountYear : null;
  const padAllTime = typeof launch.padLaunchAttemptCount === 'number' ? launch.padLaunchAttemptCount : null;
  const padYear = typeof launch.padLaunchAttemptCountYear === 'number' ? launch.padLaunchAttemptCountYear : null;
  const rocketLabel = launch.rocket?.fullName || launch.vehicle;
  const cards = [
    {
      id: 'provider',
      eyebrow: 'Provider legacy',
      title: launch.provider,
      allTime: providerAllTime,
      year: providerYear,
      yearLabel,
      allTimeLabel: 'Lifetime launches',
      story: buildStoryLine(launch.provider, providerAllTime, providerYear, 'launches', yearLabel)
    },
    {
      id: 'rocket',
      eyebrow: 'Rocket track record',
      title: rocketLabel,
      allTime: rocketStats ? rocketStats.successAllTime : null,
      year: rocketStats ? rocketStats.successYear : null,
      yearLabel,
      allTimeLabel: 'Successful missions',
      story: buildStoryLine(rocketLabel, rocketStats ? rocketStats.successAllTime : null, rocketStats ? rocketStats.successYear : null, 'successful missions', yearLabel)
    },
    {
      id: 'pad',
      eyebrow: 'Pad history',
      title: launch.pad.name,
      allTime: padAllTime,
      year: padYear,
      yearLabel,
      allTimeLabel: 'Pad launches',
      story: buildStoryLine(launch.pad.name, padAllTime, padYear, 'launches from this pad', yearLabel)
    }
  ];

  const bonusInsights: Array<{ label: string; value: string; detail: string | null }> = [];
  if (rocketStats) {
    const totalAllTime = rocketStats.successAllTime + rocketStats.failureAllTime;
    if (totalAllTime > 0) {
      const yearTotal = rocketStats.successYear + rocketStats.failureYear;
      bonusInsights.push({
        label: 'Rocket reliability',
        value: `${formatRate(rocketStats.successAllTime, totalAllTime)} all time`,
        detail: yearTotal
          ? `${yearLabel}: ${formatRate(rocketStats.successYear, yearTotal)} (${formatCount(rocketStats.successYear)}/${formatCount(yearTotal)})`
          : `${yearLabel}: no completed missions yet`
      });
    }
  }
  const padTurnaround = formatPadTurnaround(launch.padTurnaround);
  if (padTurnaround) {
    bonusInsights.push({
      label: 'Pad turnaround',
      value: padTurnaround,
      detail: 'Reported pad reuse cadence.'
    });
  }
  const windowLength = formatWindowLength(launch.windowStart, launch.windowEnd);
  bonusInsights.push({
    label: 'Launch window',
    value: windowLength || 'TBD',
    detail: windowLength ? 'Planned window length for liftoff.' : 'Window length not published yet.'
  });

  const boosterCards = (Array.isArray(boosterStats) ? boosterStats : []).map((booster) => ({
    id: String(booster.ll2LauncherId),
    title: booster.serialNumber || `Core ${booster.ll2LauncherId}`,
    subtitle: booster.status || null,
    allTime: booster.totalMissions,
    year: booster.missionsThisYear,
    yearLabel,
    allTimeLabel: 'Total missions',
    detailLines: [
      booster.flightProven === true ? 'Flight proven' : booster.flightProven === false ? 'Not flight proven' : 'Provenance unknown',
      booster.firstLaunchDate ? `First flight: ${booster.firstLaunchDate}` : null,
      booster.lastMissionNet ? `Last mission: ${booster.lastMissionNet}` : booster.lastLaunchDate ? `Last mission: ${booster.lastLaunchDate}` : null,
      `Tracked missions: ${formatCount(booster.trackedMissions)}`
    ].filter(Boolean) as string[],
    imageUrl: normalizeUrlString(booster.imageUrl)
  }));

  return { cards, boosterCards, bonusInsights: bonusInsights.slice(0, 3) };
}

function buildVehicleTimelineModule(
  rows: Array<Record<string, any>>,
  currentLaunch: ReturnType<typeof mapPublicCacheRow>
) {
  const items = rows.map((row) => mapVehicleTimelineRow(row, currentLaunch.id));
  if (!items.some((item) => item.launchId === currentLaunch.id)) {
    items.push(mapVehicleTimelineFromLaunch(currentLaunch));
  }

  const unique = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    unique.set(item.launchId, item);
  }

  return [...unique.values()].sort((a, b) => {
    const aTime = a.date ? Date.parse(a.date) : NaN;
    const bTime = b.date ? Date.parse(b.date) : NaN;
    return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
  });
}

function mapVehicleTimelineRow(row: Record<string, any>, currentLaunchId: string) {
  const statusLabel = normalizeText(row.status_abbrev || row.status_name);
  const launchId = String(row.launch_id || '').trim();
  return {
    id: launchId || `${String(row.mission_name || row.name || 'launch').trim()}:${String(row.net || '').trim()}`,
    launchId: launchId || currentLaunchId,
    missionName: normalizeText(row.mission_name || row.name) || 'Launch',
    date: normalizeText(row.net),
    status: inferVehicleTimelineStatus(statusLabel, normalizeText(row.net)),
    statusLabel,
    vehicleName: normalizeText(row.rocket_full_name || row.vehicle),
    isCurrent: launchId === currentLaunchId
  };
}

function mapVehicleTimelineFromLaunch(launch: ReturnType<typeof mapPublicCacheRow>) {
  return {
    id: launch.id,
    launchId: launch.id,
    missionName: normalizeText(launch.mission?.name || launch.name) || 'Launch',
    date: normalizeText(launch.net),
    status: inferVehicleTimelineStatus(normalizeText(launch.statusText), normalizeText(launch.net)),
    statusLabel: normalizeText(launch.statusText),
    vehicleName: normalizeText(launch.rocket?.fullName || launch.vehicle),
    isCurrent: true
  };
}

function inferVehicleTimelineStatus(statusLabel?: string | null, netIso?: string | null) {
  const normalized = String(statusLabel || '').toLowerCase();
  if (normalized.includes('success')) return 'success' as const;
  if (normalized.includes('failure') || normalized.includes('fail') || normalized.includes('scrub') || normalized.includes('abort')) {
    return 'failure' as const;
  }
  if (normalized.includes('hold') || normalized.includes('tbd') || normalized.includes('go')) return 'upcoming' as const;
  if (netIso) {
    const netMs = Date.parse(netIso);
    if (Number.isFinite(netMs) && netMs > Date.now()) return 'upcoming' as const;
  }
  return 'failure' as const;
}

function buildSocialModule(launch: ReturnType<typeof mapPublicCacheRow>) {
  const matchedPostUrl = normalizeUrlString(launch.socialPrimaryPostUrl || launch.spacexXPostUrl);
  const matchedPostId =
    normalizeText(launch.socialPrimaryPostId || launch.spacexXPostId) || extractXStatusId(matchedPostUrl);
  const matchedPostHandle = normalizeText(launch.socialPrimaryPostHandle) ||
    (matchedPostUrl ? `@${formatUrlHost(matchedPostUrl)?.split('.')[0] || ''}` : null);
  const matchedPost =
    (matchedPostUrl || matchedPostId) && ((launch.socialPrimaryPostPlatform || '').toLowerCase() === 'x' || launch.spacexXPostUrl)
      ? {
          platform: 'x' as const,
          title: 'Matched post on X',
          subtitle: matchedPostHandle,
          description: `Official post matched to this launch.`,
          url:
            matchedPostUrl ||
            (matchedPostId && matchedPostHandle
              ? `https://x.com/${encodeURIComponent(matchedPostHandle.replace(/^@+/, ''))}/status/${encodeURIComponent(matchedPostId)}`
              : matchedPostId
                ? `https://x.com/i/web/status/${encodeURIComponent(matchedPostId)}`
                : ''),
          postId: matchedPostId,
          handle: matchedPostHandle,
          matchedAt: normalizeText(launch.socialPrimaryPostMatchedAt || launch.spacexXPostCapturedAt)
        }
      : null;

  const providerFeeds: Array<{
    id: string;
    platform: 'x';
    title: string;
    subtitle: string;
    description: string;
    url: string;
    handle: string;
  }> = [];
  if (isArtemisLaunch(launch)) {
    providerFeeds.push({
      id: 'x:nasartemis',
      platform: 'x' as const,
      title: 'Artemis updates',
      subtitle: '@NASAArtemis',
      description: 'Latest posts from the Artemis program account.',
      url: 'https://x.com/NASAArtemis',
      handle: '@NASAArtemis'
    });
  }
  if (isStarshipLaunch(launch)) {
    providerFeeds.push({
      id: 'x:spacex',
      platform: 'x' as const,
      title: 'Starship updates',
      subtitle: '@SpaceX',
      description: 'Latest posts from SpaceX.',
      url: 'https://x.com/SpaceX',
      handle: '@SpaceX'
    });
  }

  if (!matchedPost && providerFeeds.length === 0) return null;
  return { matchedPost, providerFeeds };
}

function buildLaunchUpdatesModule(launch: ReturnType<typeof mapPublicCacheRow>) {
  if (!Array.isArray(launch.updates) || launch.updates.length === 0) return [];
  return launch.updates.slice(0, 5).map((update, index) => ({
    id: String(update.id || `launch-update-${index}`),
    title: String(update.comment || 'Launch update'),
    detectedAt: normalizeText(update.created_on),
    details: [normalizeText(update.created_by), normalizeUrlString(update.info_url)].filter(Boolean) as string[],
    tags: []
  }));
}

function normalizeCompactText(value: unknown) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeLower(value: unknown) {
  const normalized = normalizeCompactText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function pickLongerText(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;
  return next.length > current.length ? next : current;
}

function pickRicherText(current: string | null, next: string | null, genericValues: string[] = ['unknown', 'tbd', 'n/a']) {
  if (!next) return current;
  if (!current) return next;

  const currentValue = current.trim();
  const nextValue = next.trim();
  if (!currentValue) return nextValue || null;
  if (!nextValue) return currentValue || null;

  const generic = new Set(genericValues.map((value) => value.toLowerCase()));
  const currentIsGeneric = generic.has(currentValue.toLowerCase());
  const nextIsGeneric = generic.has(nextValue.toLowerCase());

  if (currentIsGeneric && !nextIsGeneric) return nextValue;
  if (!currentIsGeneric && nextIsGeneric) return currentValue;
  return nextValue.length > currentValue.length ? nextValue : currentValue;
}

function isLikelyBlueOriginEnhancementCrewName(value: string | null | undefined) {
  const normalized = normalizeCompactText(value);
  if (!normalized) return false;
  if (/\b(ns-\d+|mission|launch|flight|payload)\b/i.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 90) return false;
  if (BLUE_ORIGIN_NOISE_PASSENGER_TOKEN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  return words.some((word) => /^[A-Z][A-Za-z.'’-]*$/.test(word));
}

function isLikelyBlueOriginEnhancementPayloadName(value: string | null | undefined) {
  const normalized = normalizeCompactText(value);
  if (!normalized) return false;
  if (normalized.length < 3 || normalized.length > 90) return false;
  if (BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (normalized.split(/\s+/).filter(Boolean).length > 8) return false;
  return true;
}

function isExcludedBlueOriginManifestSource(value: string | null | undefined) {
  const normalized = normalizeCompactText(value);
  if (!normalized) return false;
  return BLUE_ORIGIN_UNVERIFIED_SOURCE_PATTERN.test(normalized.toLowerCase());
}

function isVerifiedBlueOriginPassengerRow(row: {
  name?: string | null;
  source?: string | null;
  confidence?: string | null;
}) {
  const name = normalizeCompactText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginEnhancementCrewName(name)) return false;
  if (isLikelyBlueOriginEnhancementPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source || null)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isVerifiedBlueOriginPayloadRow(row: {
  name?: string | null;
  source?: string | null;
  confidence?: string | null;
}) {
  const name = normalizeCompactText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginEnhancementPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source || null)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function shouldTreatBlueOriginPassengerAsPayload(row: { name?: string | null; role?: string | null }) {
  const role = normalizeCompactText(row.role || null) || '';
  const name = normalizeCompactText(row.name || null) || '';

  if (!role && !name) return false;
  if (/\b(?:anthropomorphic|test\s+device|atd|dummy)\b/i.test(role)) return true;
  if (/\bmannequin\b/i.test(name)) return true;
  return false;
}

function matchesBlueOriginLaunchRecord(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rowLaunchId: string | null | undefined,
  rowFlightCode: string | null | undefined
) {
  const launchId = normalizeLower(launch.id);
  const flightCode = normalizeLower(extractBlueOriginFlightCode(launch));
  const normalizedLaunchId = normalizeLower(rowLaunchId);
  if (launchId && normalizedLaunchId && launchId === normalizedLaunchId) return true;

  const normalizedFlightCode = normalizeLower(rowFlightCode);
  if (flightCode && normalizedFlightCode && flightCode === normalizedFlightCode) return true;
  return false;
}

function dedupeBlueOriginCrewRows(rows: NonNullable<ReturnType<typeof mapPublicCacheRow>['crew']>) {
  const byAstronaut = new Map<string, NonNullable<ReturnType<typeof mapPublicCacheRow>['crew']>[number]>();

  for (const row of rows) {
    const astronaut = normalizeCompactText(row?.astronaut);
    if (!astronaut) continue;
    const key = astronaut.toLowerCase();
    const role = normalizeBlueOriginTravelerRole(normalizeCompactText(row?.role)) || undefined;
    const nationality = normalizeCompactText(row?.nationality) || undefined;
    const existing = byAstronaut.get(key);

    if (!existing) {
      byAstronaut.set(key, {
        ...row,
        astronaut,
        role,
        nationality
      });
      continue;
    }

    byAstronaut.set(key, {
      ...existing,
      astronaut,
      role: pickRicherText(existing.role || null, role || null, ['passenger', 'crew']) || undefined,
      nationality: pickRicherText(existing.nationality || null, nationality || null, ['unknown', 'n/a']) || undefined
    });
  }

  return [...byAstronaut.values()];
}

function dedupeBlueOriginPayloadRows(rows: NonNullable<ReturnType<typeof mapPublicCacheRow>['payloads']>) {
  const byName = new Map<string, NonNullable<ReturnType<typeof mapPublicCacheRow>['payloads']>[number]>();

  for (const row of rows) {
    const name = normalizeCompactText(row?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const type = normalizeCompactText(row?.type) || undefined;
    const orbit = normalizeCompactText(row?.orbit) || undefined;
    const agency = normalizeCompactText(row?.agency) || undefined;
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        ...row,
        name,
        type,
        orbit,
        agency
      });
      continue;
    }

    byName.set(key, {
      ...existing,
      name,
      type: pickRicherText(existing.type || null, type || null, ['payload', 'unknown', 'tbd', 'n/a']) || undefined,
      orbit: pickRicherText(existing.orbit || null, orbit || null, ['unknown', 'tbd', 'n/a']) || undefined,
      agency: pickRicherText(existing.agency || null, agency || null, ['unknown', 'tbd', 'n/a']) || undefined
    });
  }

  return [...byName.values()];
}

function filterBlueOriginCrewRows(rows: NonNullable<ReturnType<typeof mapPublicCacheRow>['crew']>) {
  return dedupeBlueOriginCrewRows(
    rows
      .filter((row) => {
        const astronaut = normalizeCompactText(row?.astronaut);
        if (!astronaut) return false;
        if (!isLikelyBlueOriginEnhancementCrewName(astronaut)) return false;
        if (isLikelyBlueOriginEnhancementPayloadName(astronaut)) return false;
        return true;
      })
      .map((row) => ({
        ...row,
        role: normalizeBlueOriginTravelerRole(normalizeCompactText(row?.role)) || 'Crew'
      }))
  );
}

function filterBlueOriginPayloadRows(rows: NonNullable<ReturnType<typeof mapPublicCacheRow>['payloads']>) {
  return dedupeBlueOriginPayloadRows(
    rows.filter((row) => {
      const name = normalizeCompactText(row?.name);
      if (!name) return false;
      return isLikelyBlueOriginEnhancementPayloadName(name);
    })
  );
}

function resolveBlueOriginCrewRows(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
) {
  return dedupeBlueOriginCrewRows(
    rows
      .filter((row) => matchesBlueOriginLaunchRecord(launch, row.launchId, row.flightCode))
      .filter((row) => isVerifiedBlueOriginPassengerRow(row))
      .filter((row) => !shouldTreatBlueOriginPassengerAsPayload(row))
      .map((row) => ({
        astronaut: row.name,
        role: row.role || 'Crew',
        nationality: row.nationality || undefined
      }))
  );
}

function resolveBlueOriginPayloadRows(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPayloads>>['items']
) {
  return dedupeBlueOriginPayloadRows(
    rows
      .filter((row) => matchesBlueOriginLaunchRecord(launch, row.launchId, row.flightCode))
      .filter((row) => isVerifiedBlueOriginPayloadRow(row))
      .map((row) => ({
        name: row.name,
        type: row.payloadType || undefined,
        orbit: row.orbit || undefined,
        agency: row.agency || undefined
      }))
  );
}

function resolveBlueOriginPassengerPayloadRows(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
) {
  return dedupeBlueOriginPayloadRows(
    rows
      .filter((row) => matchesBlueOriginLaunchRecord(launch, row.launchId, row.flightCode))
      .filter((row) => isVerifiedBlueOriginPassengerRow(row))
      .filter((row) => shouldTreatBlueOriginPassengerAsPayload(row))
      .map((row) => ({
        name: row.name,
        type: row.role || 'Payload',
        orbit: undefined,
        agency: undefined
      }))
  );
}

function deriveBlueOriginSyntheticLaunchPayloadRows(missionSummary: string | null) {
  const summary = normalizeCompactText(missionSummary);
  if (!summary) return [];

  const lower = summary.toLowerCase();
  const experimentMatch = summary.match(/\b(\d{1,4})\s+experiments?\b/i);
  if (experimentMatch?.[1]) {
    const count = Number(experimentMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      return dedupeBlueOriginPayloadRows([{ name: `Experiments (${count})`, type: 'Experiment' }]);
    }
  }

  const payloadCountMatch = summary.match(
    /\b(?:more\s+than\s+|over\s+|around\s+|approximately\s+|roughly\s+)?(\d{1,4})\s+[^.\n]{0,60}?\bpayloads?\b/i
  );
  if (payloadCountMatch?.[1]) {
    const count = Number(payloadCountMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      const label = lower.includes('microgravity')
        ? 'Microgravity research payloads'
        : lower.includes('commercial')
          ? 'Commercial payloads'
          : lower.includes('research') || lower.includes('science') || lower.includes('scientific')
            ? 'Research payloads'
            : 'Payloads';
      return dedupeBlueOriginPayloadRows([{ name: `${label} (${count})`, type: label }]);
    }
  }

  if (lower.includes('blue ring') && lower.includes('payload')) {
    return dedupeBlueOriginPayloadRows([{ name: 'Blue Ring prototype payload', type: 'Payload' }]);
  }

  if (/\bpayloads?\b/i.test(summary)) {
    const label = lower.includes('lunar gravity')
      ? 'Lunar gravity payloads'
      : lower.includes('microgravity') || lower.includes('weightlessness')
        ? 'Microgravity research payloads'
        : lower.includes('commercial') || lower.includes('customer')
          ? 'Commercial payloads'
          : lower.includes('postcard')
            ? 'Postcards payload'
            : lower.includes('payload mission')
              ? 'Mission payload set'
              : 'Mission payloads';
    return dedupeBlueOriginPayloadRows([{ name: label, type: label }]);
  }

  return [];
}

function getBlueOriginMissionArtifacts(launch: ReturnType<typeof mapPublicCacheRow>) {
  const flightCode = extractBlueOriginFlightCode(launch);
  if (!flightCode) return null;

  const normalizedCode = flightCode.trim().toLowerCase();
  const curated = BLUE_ORIGIN_MISSION_ARTIFACTS[normalizedCode];
  if (curated) return curated;

  if (normalizedCode.startsWith('ns-')) {
    return {
      missionUrl: `https://www.blueorigin.com/news/new-shepard-${normalizedCode}-mission`
    };
  }

  if (normalizedCode.startsWith('ng-')) {
    return {
      missionUrl: `https://www.blueorigin.com/news/new-glenn-${normalizedCode}-mission`
    };
  }

  return null;
}

async function loadBlueOriginConstraintRows(launchId: string) {
  if (!isSupabaseAdminConfigured()) return [] as BlueOriginConstraintRow[];
  const client = createSupabaseAdminClient();
  const { data, error } = await client
    .from('launch_trajectory_constraints')
    .select('constraint_type, data, fetched_at')
    .eq('launch_id', launchId)
    .eq('source', BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE)
    .in('constraint_type', ['bo_official_sources', 'bo_mission_facts', 'bo_manifest_payloads'])
    .order('fetched_at', { ascending: false });

  if (error || !Array.isArray(data)) return [] as BlueOriginConstraintRow[];
  return data as BlueOriginConstraintRow[];
}

async function loadLl2SpacecraftFlights(ll2LaunchUuid: string | null | undefined) {
  const normalized = normalizeCompactText(ll2LaunchUuid);
  if (!normalized || !isSupabaseConfigured()) return [] as Ll2SpacecraftFlightRow[];

  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from('ll2_spacecraft_flights')
    .select('ll2_spacecraft_flight_id,ll2_launch_uuid,launch_crew,onboard_crew,landing_crew,active')
    .eq('ll2_launch_uuid', normalized)
    .limit(12);

  if (error || !Array.isArray(data)) return [] as Ll2SpacecraftFlightRow[];
  return data as Ll2SpacecraftFlightRow[];
}

function formatLl2Nationality(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return normalizeCompactText(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const record = entry as Record<string, unknown>;
        return (
          normalizeCompactText(record.nationality_name_composed) ||
          normalizeCompactText(record.nationality_name) ||
          normalizeCompactText(record.name) ||
          ''
        );
      })
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].join(', ') : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      normalizeCompactText(record.nationality_name_composed) ||
      normalizeCompactText(record.nationality_name) ||
      normalizeCompactText(record.name) ||
      null
    );
  }
  return null;
}

function shouldTreatLl2CrewMemberAsPayload(name: string, role: string | null | undefined) {
  return isBlueOriginNonHumanCrewEntry(name, role);
}

function resolveCrewAndDevicePayloadsFromLl2SpacecraftFlights(flights: Ll2SpacecraftFlightRow[]) {
  const crew: NonNullable<ReturnType<typeof mapPublicCacheRow>['crew']> = [];
  const devicePayloads: NonNullable<ReturnType<typeof mapPublicCacheRow>['payloads']> = [];

  const ingestCrewBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, any>;
      const astronautObject =
        row.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as Record<string, any>) : null;
      const astronautName = normalizeCompactText(astronautObject?.name ?? row.astronaut ?? null);
      if (!astronautName) continue;

      const role = normalizeBlueOriginTravelerRole(normalizeCompactText(row?.role?.role ?? row?.role ?? null));
      if (shouldTreatLl2CrewMemberAsPayload(astronautName, role)) {
        devicePayloads.push({
          name: astronautName,
          type: role || 'Payload',
          orbit: undefined,
          agency: undefined
        });
        continue;
      }

      const astronautIdRaw = astronautObject?.id;
      const astronautId =
        typeof astronautIdRaw === 'number' && Number.isFinite(astronautIdRaw) ? astronautIdRaw : null;

      crew.push({
        astronaut: astronautName,
        astronaut_id: astronautId,
        role: role || 'Crew',
        nationality: formatLl2Nationality(astronautObject?.nationality) || undefined
      });
    }
  };

  for (const flight of flights) {
    ingestCrewBucket(flight.launch_crew);
    ingestCrewBucket(flight.onboard_crew);
    ingestCrewBucket(flight.landing_crew);
  }

  return {
    crew: dedupeBlueOriginCrewRows(crew),
    devicePayloads: dedupeBlueOriginPayloadRows(devicePayloads)
  };
}

function buildBlueOriginTravelerProfilesFromLl2SpacecraftFlights(flights: Ll2SpacecraftFlightRow[]) {
  const byName = new Map<
    string,
    {
      name: string;
      travelerSlug: string;
      role: string | null;
      nationality: string | null;
      bio: string | null;
      imageUrl: string | null;
      profileUrl: string | null;
    }
  >();

  const ingestCrewBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, any>;
      const astronautObject =
        row.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as Record<string, any>) : null;
      const name = normalizeCompactText(astronautObject?.name ?? row.astronaut ?? null);
      if (!name) continue;

      const role = normalizeBlueOriginTravelerRole(normalizeCompactText(row?.role?.role ?? row?.role ?? null));
      if (shouldTreatLl2CrewMemberAsPayload(name, role)) continue;

      const key = name.toLowerCase();
      const existing = byName.get(key);
      const profileUrl = normalizeUrlString(astronautObject?.wiki) || normalizeUrlString(astronautObject?.url);
      const imageUrl =
        normalizeUrlString(astronautObject?.image?.thumbnail_url) ||
        normalizeUrlString(astronautObject?.image?.thumbnailUrl) ||
        normalizeUrlString(astronautObject?.profile_image_thumbnail) ||
        normalizeUrlString(astronautObject?.profileImageThumbnail) ||
        normalizeUrlString(astronautObject?.image?.image_url) ||
        normalizeUrlString(astronautObject?.image?.imageUrl) ||
        normalizeUrlString(astronautObject?.profile_image) ||
        normalizeUrlString(astronautObject?.profileImage);
      const nationality = formatLl2Nationality(astronautObject?.nationality);
      const bio = normalizeCompactText(astronautObject?.bio);

      if (!existing) {
        byName.set(key, {
          name,
          travelerSlug: buildBlueOriginTravelerSlug(name),
          role: role || 'Crew',
          nationality,
          bio,
          imageUrl,
          profileUrl
        });
        continue;
      }

      existing.role = pickRicherText(existing.role, role, ['passenger', 'crew']);
      existing.nationality = pickRicherText(existing.nationality, nationality, ['unknown', 'n/a']);
      existing.bio = pickLongerText(existing.bio, bio);
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
      if (!existing.profileUrl && profileUrl) existing.profileUrl = profileUrl;
    }
  };

  for (const flight of flights) {
    ingestCrewBucket(flight.launch_crew);
    ingestCrewBucket(flight.onboard_crew);
    ingestCrewBucket(flight.landing_crew);
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeBlueOriginTravelerProfiles(
  base: Array<{
    name: string;
    travelerSlug: string;
    role: string | null;
    nationality: string | null;
    bio: string | null;
    imageUrl: string | null;
    profileUrl: string | null;
  }>,
  supplement: Array<{
    name: string;
    travelerSlug: string;
    role: string | null;
    nationality: string | null;
    bio: string | null;
    imageUrl: string | null;
    profileUrl: string | null;
  }>
) {
  const byName = new Map<string, (typeof base)[number]>();

  for (const row of [...base, ...supplement]) {
    const key = row.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...row });
      continue;
    }

    existing.role = pickRicherText(existing.role, row.role, ['passenger', 'crew']);
    existing.nationality = pickRicherText(existing.nationality, row.nationality, ['unknown', 'n/a']);
    existing.bio = pickLongerText(existing.bio, row.bio);
    if (!existing.imageUrl && row.imageUrl) existing.imageUrl = row.imageUrl;
    if (!existing.profileUrl && row.profileUrl) existing.profileUrl = row.profileUrl;
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function loadBlueOriginMissionGraphics(launchId: string) {
  if (!isSupabaseAdminConfigured()) {
    return {
      missionUrl: null,
      graphics: [] as Array<{
        url: string;
        label: string;
        meta: string | null;
        imageUrl: string | null;
        host: string | null;
        kind: string;
      }>
    };
  }

  const client = createSupabaseAdminClient();
  const { data, error } = await client
    .from('launch_trajectory_constraints')
    .select('data')
    .eq('launch_id', launchId)
    .eq('source', 'blueorigin_mission_page')
    .eq('constraint_type', 'mission_infographic')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      missionUrl: null,
      graphics: [] as Array<{
        url: string;
        label: string;
        meta: string | null;
        imageUrl: string | null;
        host: string | null;
        kind: string;
      }>
    };
  }

  const payload = data.data as any;
  const rawGraphics = Array.isArray(payload?.graphics) ? payload.graphics : [];
  const byUrl = new Map<string, { url: string; label: string; meta: string | null; imageUrl: string | null; host: string | null; kind: string }>();

  for (const rawGraphic of rawGraphics) {
    const rawUrl =
      typeof rawGraphic === 'string'
        ? rawGraphic
        : rawGraphic && typeof rawGraphic === 'object' && typeof rawGraphic.url === 'string'
          ? rawGraphic.url
          : null;
    const normalizedUrl = normalizeUrlString(rawUrl);
    if (!normalizedUrl) continue;
    const dedupeKey = normalizedUrl.toLowerCase();
    if (byUrl.has(dedupeKey)) continue;
    byUrl.set(dedupeKey, {
      url: normalizedUrl,
      label: normalizeCompactText(typeof rawGraphic === 'object' ? (rawGraphic as { label?: string }).label : null) || formatBlueOriginSourcePageLabel(normalizedUrl),
      meta: 'Mission graphic',
      imageUrl: normalizedUrl,
      host: formatUrlHost(normalizedUrl),
      kind: 'image'
    });
  }

  return {
    missionUrl: normalizeUrlString(payload?.missionUrl || payload?.launchPageUrl),
    graphics: [...byUrl.values()]
  };
}

function formatMissionFactLabel(key: string | null) {
  const normalized = normalizeCompactText(key);
  if (!normalized) return 'Mission fact';
  return normalized
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((token) => (token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : token))
    .join(' ');
}

function formatBlueOriginSourcePageLabel(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const tail = parts[parts.length - 1];
    if (!tail) return formatUrlHost(url) || 'Official source';
    return tail
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return 'Official source';
  }
}

function resolveBlueOriginFactValue(
  facts: Array<{ key?: string | null; label: string; value: string; sourceUrl?: string | null }>,
  factKey: string
) {
  const normalizedFactKey = normalizeLower(factKey);
  if (!normalizedFactKey) return null;

  const normalizedFactLabel = normalizedFactKey.replace(/_/g, ' ');
  let resolved: string | null = null;
  for (const fact of facts) {
    const key = normalizeLower(fact.key);
    const label = normalizeLower(fact.label);
    if (key !== normalizedFactKey && label !== normalizedFactLabel) continue;
    resolved = pickRicherText(resolved, normalizeCompactText(fact.value));
  }
  return resolved;
}

function buildBlueOriginTravelerProfiles(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
) {
  const byName = new Map<
    string,
    {
      name: string;
      travelerSlug: string;
      role: string | null;
      nationality: string | null;
      bio: string | null;
      imageUrl: string | null;
      profileUrl: string | null;
    }
  >();

  for (const row of rows) {
    if (!matchesBlueOriginLaunchRecord(launch, row.launchId, row.flightCode)) continue;
    if (!isVerifiedBlueOriginPassengerRow(row)) continue;
    if (shouldTreatBlueOriginPassengerAsPayload(row)) continue;
    const name = normalizeCompactText(row.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const profileUrl = normalizeUrlString(row.profileUrl);
    const imageUrl = normalizeUrlString(row.imageUrl);
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        name,
        travelerSlug: row.travelerSlug || buildBlueOriginTravelerSlug(name),
        role: normalizeBlueOriginTravelerRole(normalizeCompactText(row.role)) || null,
        nationality: normalizeCompactText(row.nationality),
        bio: normalizeCompactText(row.bio),
        imageUrl,
        profileUrl
      });
      continue;
    }

    existing.role = pickRicherText(existing.role, normalizeBlueOriginTravelerRole(normalizeCompactText(row.role)), ['passenger', 'crew']);
    existing.nationality = pickRicherText(existing.nationality, normalizeCompactText(row.nationality), ['unknown', 'n/a']);
    existing.bio = pickLongerText(existing.bio, normalizeCompactText(row.bio));
    if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
    if (!existing.profileUrl && profileUrl) existing.profileUrl = profileUrl;
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function buildBlueOriginMissionGraphics(
  launch: ReturnType<typeof mapPublicCacheRow>,
  artifacts: ReturnType<typeof getBlueOriginMissionArtifacts>,
  persistedGraphics: Awaited<ReturnType<typeof loadBlueOriginMissionGraphics>>
) {
  const byUrl = new Map<
    string,
    {
      url: string;
      label: string;
      meta: string | null;
      imageUrl: string | null;
      host: string | null;
      kind: string;
    }
  >();
  const pushGraphic = (url: string | null | undefined, label: string, meta: string | null) => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl) return;
    const dedupeKey = normalizedUrl.toLowerCase();
    if (byUrl.has(dedupeKey)) return;
    byUrl.set(dedupeKey, {
      url: normalizedUrl,
      label,
      meta,
      imageUrl: normalizedUrl,
      host: formatUrlHost(normalizedUrl),
      kind: 'image'
    });
  };

  for (const graphic of persistedGraphics.graphics) {
    pushGraphic(graphic.url, graphic.label, graphic.meta);
  }

  for (const patch of Array.isArray(launch.missionPatches) ? launch.missionPatches : []) {
    pushGraphic(
      patch.image_url,
      normalizeCompactText(patch.name) || 'Mission patch',
      normalizeCompactText(typeof patch.agency === 'object' && patch.agency ? (patch.agency as { name?: string }).name : null) || 'Patch artwork'
    );
  }

  pushGraphic(artifacts?.patchImageUrl, 'Mission patch image', 'Official store artwork');
  return [...byUrl.values()];
}

function buildBlueOriginEnhancementData(
  launch: ReturnType<typeof mapPublicCacheRow>,
  rows: BlueOriginConstraintRow[],
  artifacts: ReturnType<typeof getBlueOriginMissionArtifacts>
) {
  const resourceLinksByUrl = new Map<
    string,
    {
      url: string;
      label: string;
      meta: string | null;
      imageUrl: string | null;
      host: string | null;
      kind: string;
    }
  >();
  const factsByKey = new Map<string, { key: string | null; label: string; value: string; sourceUrl: string | null }>();
  const payloadNotesByName = new Map<string, { name: string; description: string; sourceUrl: string | null }>();

  const pushLink = (url: string | null | undefined, label: string, meta: string | null, kind = 'page', imageUrl: string | null = null) => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl) return;
    const dedupeKey = normalizedUrl.toLowerCase();
    if (resourceLinksByUrl.has(dedupeKey)) return;
    resourceLinksByUrl.set(dedupeKey, {
      url: normalizedUrl,
      label,
      meta,
      imageUrl,
      host: formatUrlHost(normalizedUrl),
      kind
    });
  };

  pushLink(artifacts?.missionUrl, 'Blue Origin mission page', 'Official mission page');
  pushLink(artifacts?.patchProductUrl, 'Mission patch page', 'Official store');

  for (const row of rows) {
    const constraintType = normalizeCompactText(row.constraint_type || '');
    const payload = row.data as any;
    if (constraintType === 'bo_official_sources') {
      const sourcePages = Array.isArray(payload?.sourcePages) ? payload.sourcePages : [];
      for (const rawSource of sourcePages) {
        const sourceObject = rawSource && typeof rawSource === 'object' ? (rawSource as Record<string, unknown>) : null;
        const provenance = normalizeLower(sourceObject?.provenance);
        const canonicalUrl = normalizeUrlString(sourceObject?.canonicalUrl);
        const archiveSnapshotUrl = normalizeUrlString(sourceObject?.archiveSnapshotUrl);
        const sourceUrl = normalizeUrlString(sourceObject?.url) || canonicalUrl || archiveSnapshotUrl || normalizeUrlString(rawSource);
        const openUrl = provenance === 'wayback' ? archiveSnapshotUrl || sourceUrl || canonicalUrl : sourceUrl || canonicalUrl || archiveSnapshotUrl;
        if (!openUrl) continue;
        pushLink(
          openUrl,
          normalizeCompactText(sourceObject?.title) || formatBlueOriginSourcePageLabel(canonicalUrl || openUrl),
          provenance === 'wayback' ? 'Wayback snapshot' : formatUrlHost(openUrl) || 'Official source'
        );
      }
    }

    if (constraintType === 'bo_mission_facts') {
      const rawFacts = Array.isArray(payload?.facts) ? payload.facts : [];
      for (const rawFact of rawFacts) {
        if (!rawFact || typeof rawFact !== 'object') continue;
        const factRow = rawFact as Record<string, unknown>;
        const key = normalizeCompactText(factRow.key);
        const label = normalizeCompactText(factRow.label) || formatMissionFactLabel(key);
        const rawValue = normalizeCompactText(String(factRow.value ?? ''));
        if (!rawValue) continue;
        const unit = normalizeCompactText(factRow.unit);
        const value = [rawValue, unit].filter(Boolean).join(' ');
        const sourceUrl = normalizeUrlString(factRow.sourceUrl);
        const dedupeKey = `${(key || label).toLowerCase()}|${value.toLowerCase()}`;
        const existing = factsByKey.get(dedupeKey);

        if (!existing) {
          factsByKey.set(dedupeKey, {
            key,
            label,
            value,
            sourceUrl
          });
          continue;
        }

        existing.value = pickRicherText(existing.value, value) || existing.value;
        if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
      }
    }

    if (constraintType === 'bo_manifest_payloads') {
      const rawPayloads = Array.isArray(payload?.payloads) ? payload.payloads : [];
      for (const rawPayload of rawPayloads) {
        if (!rawPayload || typeof rawPayload !== 'object') continue;
        const payloadRow = rawPayload as Record<string, unknown>;
        const name = normalizeCompactText(payloadRow.name);
        const description = normalizeCompactText(payloadRow.description);
        if (!name || !description) continue;

        const sourceUrl = normalizeUrlString(payloadRow.sourceUrl);
        const existing = payloadNotesByName.get(name.toLowerCase());
        if (!existing) {
          payloadNotesByName.set(name.toLowerCase(), {
            name,
            description,
            sourceUrl
          });
          continue;
        }

        existing.description = pickLongerText(existing.description, description) || existing.description;
        if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
      }
    }
  }

  const facts = [...factsByKey.values()].sort((left, right) => {
    const labelDelta = left.label.localeCompare(right.label);
    if (labelDelta !== 0) return labelDelta;
    return left.value.localeCompare(right.value);
  });
  const payloadNotes = [...payloadNotesByName.values()].sort((left, right) => left.name.localeCompare(right.name));

  return {
    resourceLinks: [...resourceLinksByUrl.values()],
    facts,
    payloadNotes,
    missionSummary: resolveBlueOriginFactValue(facts, BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY),
    failureReason: resolveBlueOriginFactValue(facts, BLUE_ORIGIN_FAILURE_REASON_FACT_KEY)
  };
}

function buildBlueOriginModule(
  launch: ReturnType<typeof mapPublicCacheRow>,
  passengersResponse: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>> | null,
  payloadsResponse: Awaited<ReturnType<typeof fetchBlueOriginPayloads>> | null,
  constraintRows: BlueOriginConstraintRow[],
  ll2SpacecraftFlights: Ll2SpacecraftFlightRow[],
  persistedMissionGraphics: Awaited<ReturnType<typeof loadBlueOriginMissionGraphics>>
) {
  if (!isBlueOriginProgramLaunch(launch)) {
    return {
      blueOrigin: null,
      crew: launch.crew || [],
      payloads: launch.payloads || [],
      missionSummary: launch.mission?.description ?? launch.mission?.name ?? null,
      failureReason: launch.failReason ?? null
    };
  }

  const artifacts = getBlueOriginMissionArtifacts(launch);
  const enhancementData = buildBlueOriginEnhancementData(launch, constraintRows, artifacts);
  const ll2CrewBundle = resolveCrewAndDevicePayloadsFromLl2SpacecraftFlights(ll2SpacecraftFlights);
  const travelerProfiles = mergeBlueOriginTravelerProfiles(
    passengersResponse ? buildBlueOriginTravelerProfiles(launch, passengersResponse.items) : [],
    buildBlueOriginTravelerProfilesFromLl2SpacecraftFlights(ll2SpacecraftFlights)
  );
  const missionGraphics = buildBlueOriginMissionGraphics(launch, artifacts, persistedMissionGraphics);
  const resourceLinks = (() => {
    const byUrl = new Map<string, (typeof enhancementData.resourceLinks)[number]>();
    const pushLink = (link: (typeof enhancementData.resourceLinks)[number]) => {
      const key = link.url.toLowerCase();
      if (byUrl.has(key)) return;
      byUrl.set(key, link);
    };
    for (const link of enhancementData.resourceLinks) pushLink(link);
    if (persistedMissionGraphics.missionUrl) {
      pushLink({
        url: persistedMissionGraphics.missionUrl,
        label: 'Blue Origin mission page',
        meta: 'Mission infographic source',
        imageUrl: null,
        host: formatUrlHost(persistedMissionGraphics.missionUrl),
        kind: 'page'
      });
    }
    return [...byUrl.values()];
  })();
  const crew = dedupeBlueOriginCrewRows([
    ...filterBlueOriginCrewRows(launch.crew || []),
    ...(passengersResponse ? resolveBlueOriginCrewRows(launch, passengersResponse.items) : []),
    ...ll2CrewBundle.crew
  ]);
  let payloads = dedupeBlueOriginPayloadRows([
    ...filterBlueOriginPayloadRows(launch.payloads || []),
    ...(payloadsResponse ? resolveBlueOriginPayloadRows(launch, payloadsResponse.items) : []),
    ...(passengersResponse ? resolveBlueOriginPassengerPayloadRows(launch, passengersResponse.items) : []),
    ...ll2CrewBundle.devicePayloads
  ]);
  const missionSummary = enhancementData.missionSummary || launch.mission?.description || launch.mission?.name || null;
  if (payloads.length === 0) {
    payloads = dedupeBlueOriginPayloadRows(deriveBlueOriginSyntheticLaunchPayloadRows(missionSummary));
  }

  const blueOrigin =
    resourceLinks.length || travelerProfiles.length || missionGraphics.length || enhancementData.facts.length || enhancementData.payloadNotes.length
      ? {
          resourceLinks,
          travelerProfiles,
          missionGraphics,
          facts: enhancementData.facts.map((fact) => ({
            label: fact.label,
            value: fact.value,
            sourceUrl: fact.sourceUrl
          })),
          payloadNotes: enhancementData.payloadNotes
        }
      : null;

  return {
    blueOrigin,
    crew,
    payloads,
    missionSummary,
    failureReason: enhancementData.failureReason || launch.failReason || null
  };
}

function mapLaunchCardPayload(launch: ReturnType<typeof mapPublicCacheRow>) {
  return {
    id: launch.id,
    slug: launch.slug ?? null,
    name: launch.name,
    net: launch.net ?? null,
    status: launch.statusText ?? null,
    provider: launch.provider ?? null,
    imageUrl: normalizeUrlString(launch.image.full) || normalizeUrlString(launch.image.thumbnail) || null
  };
}

function getPrivilegedClient(session: ResolvedViewerSession): PrivilegedClient | null {
  if (isSupabaseAdminConfigured()) {
    return createSupabaseAdminClient();
  }

  if (session.authMode === 'bearer' && session.accessToken) {
    return createSupabaseAccessTokenClient(session.accessToken);
  }

  if (session.authMode === 'cookie') {
    return createSupabaseServerClient();
  }

  return null;
}

function getAdminSelfServiceClient(session: ResolvedViewerSession): AdminSelfServiceClient | null {
  if (session.authMode === 'bearer' && session.accessToken) {
    return createSupabaseAccessTokenClient(session.accessToken);
  }

  if (session.authMode === 'cookie') {
    return createSupabaseServerClient();
  }

  if (isSupabaseAdminConfigured()) {
    return createSupabaseAdminClient();
  }

  return null;
}

async function requirePremiumNotificationAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (entitlement.tier !== 'premium') {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requireAuthedEntitlement(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  return entitlement;
}

async function requireSavedItemsAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (!entitlement.capabilities.canUseSavedItems) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  return entitlement;
}

async function requireBasicAlertRuleAccess(session: ResolvedViewerSession) {
  const entitlement = await requireAuthedEntitlement(session);
  if (!entitlement.capabilities.canUseBasicAlertRules) {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requireAdvancedAlertRuleAccess(session: ResolvedViewerSession) {
  const entitlement = await requireBasicAlertRuleAccess(session);
  if (!entitlement.capabilities.canUseAdvancedAlertRules) {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requirePremiumIntegrationsAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (entitlement.tier !== 'premium') {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  return entitlement;
}

function assertAlertRuleCreationAccess(
  entitlement: Awaited<ReturnType<typeof requireAuthedEntitlement>>,
  kind: z.infer<typeof alertRuleCreateSchemaV1>['kind']
) {
  if (kind === 'region_us') {
    if (!entitlement.capabilities.canUseAllUsLaunchAlerts) {
      throw new MobileApiRouteError(402, 'payment_required');
    }
    return;
  }

  if (kind === 'state') {
    if (!entitlement.capabilities.canUseStateLaunchAlerts) {
      throw new MobileApiRouteError(402, 'payment_required');
    }
    return;
  }

  if (!entitlement.capabilities.canUseAdvancedAlertRules) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
}

async function pruneBasicLaunchNotificationPreferences(
  client: PrivilegedClient,
  userId: string,
  options: {
    preferredLaunchId?: string | null;
    nowMs?: number;
  } = {}
): Promise<{ activeLaunchFollow: BasicLaunchFollowSummary | null }> {
  const { data: prefRows, error: prefError } = await client
    .from('launch_notification_preferences')
    .select('launch_id')
    .eq('user_id', userId)
    .eq('channel', 'push');

  if (prefError) {
    throw prefError;
  }

  const launchIds = Array.from(
    new Set((prefRows ?? []).map((row: any) => String(row?.launch_id || '').trim()).filter(Boolean))
  );
  if (!launchIds.length) {
    return { activeLaunchFollow: null };
  }

  const { data: launches, error: launchesError } = await client
    .from('launches')
    .select('id, name, net, hidden')
    .in('id', launchIds);

  if (launchesError) {
    throw launchesError;
  }

  const nowMs = options.nowMs ?? Date.now();
  const preferredLaunchId = String(options.preferredLaunchId || '').trim().toLowerCase() || null;
  const launchById = new Map<string, BasicLaunchRow>();
  ((launches ?? []) as BasicLaunchRow[]).forEach((row) => {
    const launchId = String(row.id || '').trim().toLowerCase();
    if (!launchId) return;
    launchById.set(launchId, row);
  });

  const futureLaunches = launchIds
    .map((launchId) => {
      const launch = launchById.get(launchId.toLowerCase());
      const net = String(launch?.net || '').trim() || null;
      const netMs = net ? Date.parse(net) : Number.NaN;
      return {
        launchId: launchId.toLowerCase(),
        launchName: String(launch?.name || '').trim() || 'Launch alert',
        net,
        hidden: launch?.hidden === true,
        netMs
      };
    })
    .filter((row) => !row.hidden && Number.isFinite(row.netMs) && row.netMs > nowMs)
    .sort((left, right) => left.netMs - right.netMs);

  const activeLaunch =
    (preferredLaunchId ? futureLaunches.find((row) => row.launchId === preferredLaunchId) : null) ?? futureLaunches[0] ?? null;

  const retainedLaunchId = activeLaunch?.launchId ?? null;
  const launchIdsToDelete = launchIds.filter((launchId) => launchId.toLowerCase() !== retainedLaunchId);

  if (launchIdsToDelete.length) {
    const { error: deleteError } = await client
      .from('launch_notification_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('channel', 'push')
      .in('launch_id', launchIdsToDelete);

    if (deleteError) {
      throw deleteError;
    }

    await Promise.all(
      launchIdsToDelete.map((launchId) =>
        removeChannelsFromUnifiedRule(
          client,
          { ownerKind: 'user', userId },
          {
            scopeKind: 'launch',
            scopeKey: launchId.toLowerCase(),
            launchId: launchId.toLowerCase()
          },
          ['push']
        )
      )
    );
  }

  if (!activeLaunch) {
    return { activeLaunchFollow: null };
  }

  return {
    activeLaunchFollow: {
      launchId: activeLaunch.launchId,
      launchName: activeLaunch.launchName,
      net: activeLaunch.net
    }
  };
}

export async function recordAuthContextPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = authContextUpsertSchemaV1.parse(await request.json().catch(() => undefined));
  const now = new Date().toISOString();
  const riskSessionId = normalizeText(parsedBody.riskSessionId);
  const { data: existingSummary, error: summaryLoadError } = await client
    .from('user_surface_summary')
    .select('first_mobile_platform, ever_used_web, ever_used_ios, ever_used_android, last_mobile_sign_in_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (summaryLoadError) {
    throw summaryLoadError;
  }

  const firstMobilePlatform =
    existingSummary?.first_mobile_platform ??
    (parsedBody.platform === 'ios' || parsedBody.platform === 'android' ? parsedBody.platform : null);

  const { error: summaryUpsertError } = await client.from('user_surface_summary').upsert(
    {
      user_id: session.userId,
      first_mobile_platform: firstMobilePlatform,
      last_sign_in_platform: parsedBody.platform,
      ever_used_web: (existingSummary?.ever_used_web ?? false) || parsedBody.platform === 'web',
      ever_used_ios: (existingSummary?.ever_used_ios ?? false) || parsedBody.platform === 'ios',
      ever_used_android: (existingSummary?.ever_used_android ?? false) || parsedBody.platform === 'android',
      last_mobile_sign_in_at:
        parsedBody.platform === 'ios' || parsedBody.platform === 'android'
          ? now
          : (existingSummary?.last_mobile_sign_in_at ?? null),
      updated_at: now
    },
    { onConflict: 'user_id' }
  );

  if (summaryUpsertError) {
    throw summaryUpsertError;
  }

  const { error: eventInsertError } = await client.from('user_sign_in_events').insert({
    user_id: session.userId,
    provider: parsedBody.provider,
    platform: parsedBody.platform,
    event_type: parsedBody.eventType,
    display_name: normalizeText(parsedBody.displayName),
    avatar_url: normalizeText(parsedBody.avatarUrl),
    email_is_private_relay: parsedBody.emailIsPrivateRelay === true,
    app_version: normalizeText(parsedBody.appVersion),
    build_profile: normalizeText(parsedBody.buildProfile),
    risk_session_id: riskSessionId,
    result: 'success',
    created_at: now
  });

  if (eventInsertError) {
    throw eventInsertError;
  }

  if (riskSessionId) {
    const { error: riskSessionUpdateError } = await client
      .from('mobile_auth_risk_sessions')
      .update({
        user_id: session.userId,
        updated_at: now
      })
      .eq('id', riskSessionId);

    if (riskSessionUpdateError) {
      throw riskSessionUpdateError;
    }
  }

  return successResponseSchemaV1.parse({ ok: true });
}

async function loadRelatedLaunchResults(launchId: string) {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const [newsJoinRes, eventJoinRes] = await Promise.all([
    supabase.from('snapi_item_launches').select('snapi_uid').eq('launch_id', launchId),
    supabase.from('ll2_event_launches').select('ll2_event_id').eq('launch_id', launchId)
  ]);

  if (newsJoinRes.error) throw newsJoinRes.error;
  if (eventJoinRes.error) throw eventJoinRes.error;

  const newsIds = Array.from(new Set((newsJoinRes.data || []).map((row: any) => normalizeText(row.snapi_uid)).filter(Boolean)));
  const eventIds = Array.from(new Set((eventJoinRes.data || []).map((row: any) => row.ll2_event_id).filter((value) => Number.isFinite(value))));

  const [newsRes, eventRes] = await Promise.all([
    newsIds.length
      ? supabase
          .from('snapi_items')
          .select('snapi_uid, title, summary, url, news_site, image_url, published_at')
          .in('snapi_uid', newsIds)
          .order('published_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? supabase
          .from('ll2_events')
          .select('ll2_event_id, name, description, type_name, date, location_name, url, image_url')
          .in('ll2_event_id', eventIds)
          .limit(8)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (newsRes.error) throw newsRes.error;
  if (eventRes.error) throw eventRes.error;

  const newsResults = ((newsRes.data || []) as RelatedNewsRow[]).map((row) => ({
    id: String(row.snapi_uid || ''),
    type: 'news',
    title: String(row.title || 'Untitled article'),
    subtitle: normalizeText(row.news_site),
    summary: normalizeText(row.summary),
    href: String(row.url || '/news'),
    imageUrl: normalizeText(row.image_url),
    badge: 'News',
    publishedAt: normalizeText(row.published_at)
  }));

  const eventResults = ((eventRes.data || []) as RelatedEventRow[]).map((row) => ({
    id: String(row.ll2_event_id || ''),
    type: 'page',
    title: String(row.name || 'Related event'),
    subtitle: [normalizeText(row.type_name), normalizeText(row.location_name)].filter(Boolean).join(' • ') || null,
    summary: normalizeText(row.description),
    href: String(row.url || '/'),
    imageUrl: normalizeText(row.image_url),
    badge: 'Event',
    publishedAt: normalizeText(row.date)
  }));

  return sortByPublishedAtDesc([...newsResults, ...eventResults]).slice(0, 10);
}

export async function buildViewerSessionPayload(session: ResolvedViewerSession) {
  const mobileHubRollout = await loadMobileHubRollout();

  return viewerSessionSchemaV1.parse({
    viewerId: session.userId,
    email: session.email,
    role: session.role,
    accessToken: session.authMode === 'bearer' ? session.accessToken : null,
    expiresAt: session.expiresAt,
    authMode: session.authMode,
    mobileHubRollout
  });
}

export async function buildViewerEntitlementPayload(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  return buildViewerEntitlementEnvelope(entitlement);
}

function buildViewerEntitlementEnvelope(entitlement: ViewerEntitlement) {
  return entitlementSchemaV1.parse({
    tier: entitlement.tier,
    status: entitlement.status,
    source: entitlement.source,
    isPaid: entitlement.isPaid,
    billingIsPaid: entitlement.billingIsPaid,
    isAdmin: entitlement.isAdmin,
    isAuthed: entitlement.isAuthed,
    mode: entitlement.mode,
    effectiveTierSource: entitlement.effectiveTierSource,
    adminAccessOverride: entitlement.adminAccessOverride,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    stripePriceId: entitlement.stripePriceId,
    reconciled: entitlement.reconciled,
    reconcileThrottled: entitlement.reconcileThrottled
  });
}

function buildAdminAccessOverrideEnvelope({
  entitlement,
  adminAccessOverride,
  updatedAt
}: {
  entitlement: ViewerEntitlement;
  adminAccessOverride: 'anon' | 'premium' | null;
  updatedAt: string | null;
}) {
  return adminAccessOverrideSchemaV1.parse({
    adminAccessOverride,
    effectiveTier: entitlement.tier,
    effectiveTierSource: entitlement.effectiveTierSource,
    isAdmin: entitlement.isAdmin,
    billingIsPaid: entitlement.billingIsPaid,
    updatedAt
  });
}

async function requireAdminSelfServiceSession(session: ResolvedViewerSession) {
  if (!session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }

  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAdmin) {
    throw new MobileApiRouteError(403, 'forbidden');
  }

  const client = getAdminSelfServiceClient(session);
  if (!client) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }

  return {
    entitlement,
    client
  };
}

async function loadAdminAccessOverrideState(
  client: AdminSelfServiceClient,
  userId: string
): Promise<{ adminAccessOverride: 'anon' | 'premium' | null; updatedAt: string | null }> {
  const { data, error } = await client
    .from('admin_access_overrides')
    .select('effective_tier_override, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    const code = typeof error.code === 'string' ? error.code : '';
    if (code === 'PGRST116' || isMissingAdminAccessOverrideRelationCode(code)) {
      return { adminAccessOverride: null, updatedAt: null };
    }
    throw error;
  }

  const override = String(data?.effective_tier_override || '').trim().toLowerCase();
  return {
    adminAccessOverride: override === 'anon' || override === 'premium' ? (override as 'anon' | 'premium') : null,
    updatedAt: normalizeText(data?.updated_at)
  };
}

export async function loadAdminAccessOverridePayload(session: ResolvedViewerSession) {
  const { entitlement, client } = await requireAdminSelfServiceSession(session);
  const state = await loadAdminAccessOverrideState(client, session.userId as string);
  return buildAdminAccessOverrideEnvelope({
    entitlement,
    adminAccessOverride: state.adminAccessOverride,
    updatedAt: state.updatedAt
  });
}

export async function updateAdminAccessOverridePayload(session: ResolvedViewerSession, request: Request) {
  const { client } = await requireAdminSelfServiceSession(session);
  const userId = session.userId as string;
  const parsedBody = adminAccessOverrideUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const nextOverride = parsedBody.adminAccessOverride;
  const previous = await loadAdminAccessOverrideState(client, userId);
  const now = new Date().toISOString();

  if (previous.adminAccessOverride !== nextOverride) {
    if (nextOverride) {
      const { error } = await client.from('admin_access_overrides').upsert({
        user_id: userId,
        effective_tier_override: nextOverride,
        updated_at: now,
        updated_by: userId
      });
      if (error) {
        const code = typeof error.code === 'string' ? error.code : '';
        if (isMissingAdminAccessOverrideRelationCode(code)) {
          throw new MobileApiRouteError(503, 'admin_access_override_not_configured');
        }
        throw error;
      }
    } else {
      const { error } = await client.from('admin_access_overrides').delete().eq('user_id', userId);
      if (error) {
        const code = typeof error.code === 'string' ? error.code : '';
        if (isMissingAdminAccessOverrideRelationCode(code)) {
          throw new MobileApiRouteError(503, 'admin_access_override_not_configured');
        }
        throw error;
      }
    }

    const { error: eventError } = await client.from('admin_access_override_events').insert({
      user_id: userId,
      updated_by: userId,
      previous_override: previous.adminAccessOverride,
      next_override: nextOverride,
      created_at: now
    });
    if (eventError) {
      const code = typeof eventError.code === 'string' ? eventError.code : '';
      if (isMissingAdminAccessOverrideRelationCode(code)) {
        console.warn('admin access override audit table missing; continuing without event log');
      } else {
        console.error('admin access override event log error', eventError);
      }
    }
  }

  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  const state = await loadAdminAccessOverrideState(client, userId);
  return buildAdminAccessOverrideEnvelope({
    entitlement,
    adminAccessOverride: state.adminAccessOverride,
    updatedAt: state.updatedAt
  });
}

export async function loadLaunchFeedPayload(request: Request) {
  return loadVersionedLaunchFeedPayload(request);
}

export async function loadLaunchDetailPayload(id: string, session: ResolvedViewerSession, entitlementOverride?: Awaited<ReturnType<typeof getViewerEntitlement>>['entitlement']) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(id);
  if (!parsedLaunch) {
    return null;
  }

  const entitlement = entitlementOverride ?? (await getViewerEntitlement({ session, reconcileStripe: false })).entitlement;
  const wantsLiveDetail = entitlement.isAuthed && entitlement.tier === 'premium';
  const liveClient = wantsLiveDetail ? getPrivilegedClient(session) : null;
  const useLiveDetail = Boolean(liveClient);
  let sourceQuery;
  if (liveClient) {
    sourceQuery = liveClient.from('launches').select('*').eq('id', parsedLaunch.launchId).eq('hidden', false);
  } else {
    sourceQuery = createSupabasePublicClient().from('launches_public_cache').select('*').eq('launch_id', parsedLaunch.launchId);
  }
  const { data, error } = await sourceQuery.maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const launch = useLiveDetail ? mapLiveLaunchRow(data) : mapPublicCacheRow(data);
  const entitlements = buildViewerEntitlementEnvelope(entitlement);
  const netMs = Date.parse(launch.net);
  const nowMs = Date.now();
  const isEasternRange = launch.pad?.state === 'FL';
  const padCountry = String(launch.pad?.countryCode || '').toUpperCase();
  const isUsPad = padCountry === 'USA' || padCountry === 'US';
  const within14Days =
    Number.isFinite(netMs) &&
    netMs > nowMs &&
    netMs <= nowMs + 14 * 24 * 60 * 60 * 1000;
  const blueOriginMissionKey = isBlueOriginProgramLaunch(launch) ? getBlueOriginMissionKeyFromLaunch(launch) || 'all' : null;

  const [
    related,
    enrichment,
    jepScore,
    faaAirspace,
    arTrajectory,
    relatedNews,
    relatedEvents,
    ws45Forecast,
    nwsForecast,
    payloadManifest,
    objectInventory,
    rocketStats,
    boosterStats,
    vehicleTimelineRows,
    ll2SpacecraftFlights,
    blueOriginPassengers,
    blueOriginPayloads,
    blueOriginConstraintRows,
    blueOriginMissionGraphics
  ] = await Promise.all([
    loadRelatedLaunchResults(launch.id),
    fetchLaunchDetailEnrichment(launch.id, launch.ll2Id),
    fetchLaunchJepScore(launch.id, { viewerIsAdmin: session.role === 'admin' }),
    fetchLaunchFaaAirspace({ launchId: launch.id, limit: 6 }),
    loadArTrajectorySummary(launch.id),
    loadRelatedNewsItems(launch.id),
    loadRelatedEventItems(launch.id),
    fetchWs45Forecast(launch.id, isEasternRange),
    fetchNwsForecast(launch.id, isUsPad, within14Days),
    fetchPayloadManifest(launch.ll2Id),
    fetchLaunchObjectInventory(launch.ll2Id),
    fetchRocketOutcomeStats(launch.rocket?.fullName, launch.vehicle),
    fetchLaunchBoosterStats(launch.id, launch.ll2Id),
    fetchVehicleTimelineRows(launch),
    blueOriginMissionKey ? loadLl2SpacecraftFlights(launch.ll2Id) : Promise.resolve([]),
    blueOriginMissionKey ? fetchBlueOriginPassengersDatabaseOnly(blueOriginMissionKey) : Promise.resolve(null),
    blueOriginMissionKey ? fetchBlueOriginPayloads(blueOriginMissionKey) : Promise.resolve(null),
    blueOriginMissionKey ? loadBlueOriginConstraintRows(launch.id) : Promise.resolve([]),
    blueOriginMissionKey
      ? loadBlueOriginMissionGraphics(launch.id)
      : Promise.resolve({
          missionUrl: null,
          graphics: []
        })
  ]);
  const mobileEnrichment = {
    ...enrichment,
    externalContent: selectPreferredResponsiveLaunchExternalContent(enrichment.externalContent, 'mobile')
  };
  const weather = buildWeatherModule(launch, ws45Forecast, nwsForecast);
  const resources = {
    watchLinks: buildWatchLinks(launch),
    externalLinks: buildExternalLinks(launch),
    missionResources: flattenMissionResources(mobileEnrichment),
    missionTimeline: flattenMissionTimeline({ launchTimeline: launch.timeline, enrichment: mobileEnrichment })
  };
  const social = buildSocialModule(launch);
  const missionStats = buildMissionStatsModule(launch, rocketStats, boosterStats);
  const vehicleTimeline = buildVehicleTimelineModule(vehicleTimelineRows, launch);
  const blueOriginDetail = buildBlueOriginModule(
    launch,
    blueOriginPassengers,
    blueOriginPayloads,
    blueOriginConstraintRows,
    ll2SpacecraftFlights,
    blueOriginMissionGraphics
  );
  const launchData = {
    ...launch,
    crew: blueOriginDetail.crew,
    payloads: blueOriginDetail.payloads,
    failReason: blueOriginDetail.failureReason ?? launch.failReason ?? undefined,
    mission: launch.mission
      ? {
          ...launch.mission,
          description: blueOriginDetail.missionSummary || launch.mission.description || undefined
        }
      : blueOriginDetail.missionSummary
        ? {
            name: launch.name,
            description: blueOriginDetail.missionSummary
          }
        : launch.mission,
    imageUrl: normalizeUrlString(launch.image.full) || normalizeUrlString(launch.image.thumbnail) || null,
    missionSummary: blueOriginDetail.missionSummary || launch.mission?.description || launch.mission?.name || null,
    padName: launch.pad?.name ?? null,
    padLocation: launch.pad?.locationName ?? null,
    windowStart: launch.windowStart ?? null,
    windowEnd: launch.windowEnd ?? null,
    weatherSummary: buildWeatherSummary(launch),
    launchStatusDescription: launch.statusText ?? null,
    rocketName: launch.rocket?.fullName ?? launch.vehicle ?? null
  };

  return launchDetailSchemaV1.parse({
    launch: {
      ...mapLaunchCardPayload(launch),
      mission: launchData.missionSummary,
      padName: launchData.padName,
      padLocation: launchData.padLocation,
      windowStart: launchData.windowStart,
      windowEnd: launchData.windowEnd,
      weatherSummary: launchData.weatherSummary,
      launchStatusDescription: launchData.launchStatusDescription,
      rocketName: launchData.rocketName
    },
    launchData,
    arTrajectory,
    entitlements,
    related,
    enrichment: {
      firstStageCount: enrichment.firstStages.length,
      recoveryCount: enrichment.recovery.length,
      externalContentCount: mobileEnrichment.externalContent.length,
      hasJepScore: Boolean(jepScore),
      faaAdvisoryCount: faaAirspace?.advisories.length ?? 0,
      firstStages: enrichment.firstStages,
      recovery: enrichment.recovery,
      externalContent: mobileEnrichment.externalContent,
      faaAdvisories: faaAirspace?.advisories ?? []
    },
    resources,
    ...(weather ? { weather } : {}),
    ...(social ? { social } : {}),
    relatedEvents,
    relatedNews,
    payloadManifest: buildPayloadManifestModule(payloadManifest),
    objectInventory: buildObjectInventoryModule(objectInventory),
    launchUpdates: buildLaunchUpdatesModule(launch),
    missionStats,
    vehicleTimeline,
    blueOrigin: blueOriginDetail.blueOrigin
  });
}

export async function searchPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = clampInt(searchParams.get('limit'), 8, 1, 25);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000);

  if (!isSupabaseConfigured()) {
    return searchResponseSchemaV1.parse({
      query: String(query || ''),
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const parsed = parseSiteSearchInput(query);
  const requestedTypes = parseSiteSearchTypesParam(searchParams.get('types'));
  const types = [...new Set<SearchResultType>([...parsed.types, ...requestedTypes])];

  if (!parsed.query || !parsed.hasPositiveTerms) {
    return searchResponseSchemaV1.parse({
      query: parsed.query || '',
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const startedAt = Date.now();
  const { data, error } = await createSupabasePublicClient().rpc('search_public_documents', {
    q_in: parsed.query,
    limit_n: limit + 1,
    offset_n: offset,
    types_in: types.length ? types : null
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as SearchRpcRow[]) : [];
  const results = rows.slice(0, limit).map((row) => ({
    id: String(row.id || ''),
    type: String(row.type || 'page'),
    title: String(row.title || ''),
    subtitle: normalizeText(row.subtitle),
    summary: normalizeText(row.summary),
    href: String(row.url || '/search'),
    imageUrl: normalizeText(row.image_url),
    badge: normalizeText(row.badge),
    publishedAt: normalizeText(row.published_at)
  }));

  return searchResponseSchemaV1.parse({
    query: parsed.query,
    results,
    tookMs: Math.max(0, Date.now() - startedAt),
    limit,
    offset,
    hasMore: rows.length > limit
  });
}

export async function loadPrivacyPreferencesPayload(session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('privacy_preferences')
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapPrivacyPreferencesPayload(data);
}

export async function updatePrivacyPreferencesPayload(session: ResolvedViewerSession, request: Request) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const rawBody = await request.json().catch(() => undefined);
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new MobileApiRouteError(400, 'invalid_body');
  }
  if (Object.keys(rawBody).length === 0) {
    throw new MobileApiRouteError(400, 'no_changes');
  }

  const parsedBodyResult = privacyPreferencesUpdateSchemaV1.safeParse(rawBody);
  if (!parsedBodyResult.success) {
    throw new MobileApiRouteError(400, 'invalid_body');
  }

  const parsedBody = parsedBodyResult.data;
  const payload: Record<string, unknown> = {
    user_id: session.userId,
    updated_at: new Date().toISOString()
  };

  if (parsedBody.optOutSaleShare !== undefined) payload.opt_out_sale_share = parsedBody.optOutSaleShare;
  if (parsedBody.limitSensitive !== undefined) payload.limit_sensitive = parsedBody.limitSensitive;
  if (parsedBody.blockThirdPartyEmbeds !== undefined) payload.block_third_party_embeds = parsedBody.blockThirdPartyEmbeds;
  if (parsedBody.gpcEnabled !== undefined) payload.gpc_enabled = parsedBody.gpcEnabled;
  if (parsedBody.gpcEnabled === true) {
    payload.opt_out_sale_share = true;
  }

  const { data, error } = await client
    .from('privacy_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return mapPrivacyPreferencesPayload(data);
}

export async function loadAccountExportPayload(session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId || !session.user) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  const db = admin ?? client;

  const [profileRes, prefsRes, privacyPrefsRes, launchPrefsRes, alertRulesRes, pushRes, subscriptionRes] = await Promise.all([
    db.from('profiles').select('user_id, email, role, first_name, last_name, timezone, created_at, updated_at').eq('user_id', session.userId).maybeSingle(),
    db
      .from('notification_preferences')
      .select(
        'email_enabled, push_enabled, quiet_hours_enabled, quiet_start_local, quiet_end_local, notify_t_minus_60, notify_t_minus_10, notify_t_minus_5, notify_liftoff, notify_status_change, notify_net_change, created_at, updated_at'
      )
      .eq('user_id', session.userId)
      .maybeSingle(),
    db
      .from('privacy_preferences')
      .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
      .eq('user_id', session.userId)
      .maybeSingle(),
    db
      .from('launch_notification_preferences')
      .select(
        'user_id, launch_id, channel, mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change, created_at, updated_at'
      )
      .eq('user_id', session.userId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    db
      .from('notification_alert_rules')
      .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at')
      .eq('user_id', session.userId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    db.from('push_subscriptions').select('id, endpoint, user_agent, created_at').eq('user_id', session.userId).order('created_at', { ascending: false }),
    db
      .from('subscriptions')
      .select('status, stripe_price_id, cancel_at_period_end, current_period_end, created_at, updated_at')
      .eq('user_id', session.userId)
      .maybeSingle(),
  ]);

  const stripeCustomer = admin
    ? (
        await admin.from('stripe_customers').select('stripe_customer_id, created_at').eq('user_id', session.userId).maybeSingle()
      ).data ?? null
    : null;

  return accountExportSchemaV1.parse({
    generated_at: new Date().toISOString(),
    auth: {
      user_id: session.userId,
      email: session.user.email ?? null,
      created_at: session.user.created_at ?? null,
      user_metadata: session.user.user_metadata ?? {}
    },
    profile: profileRes.data ?? null,
    notification_preferences: prefsRes.data ?? null,
    privacy_preferences: privacyPrefsRes.data ?? null,
    launch_notification_preferences: launchPrefsRes.data ?? [],
    notification_alert_rules: alertRulesRes.data ?? [],
    push_subscriptions: pushRes.data ?? [],
    subscription: subscriptionRes.data ?? null,
    stripe_customer: stripeCustomer,
    warnings: admin ? [] : ['stripe_customer_id_unavailable_without_service_role']
  });
}

export async function loadProfilePayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('user_id, email, role, first_name, last_name, timezone, created_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const metadata = (session.user?.user_metadata || {}) as Record<string, unknown>;

  return profileSchemaV1.parse({
    viewerId: session.userId,
    email: String(data?.email || session.email || ''),
    role: data?.role ?? null,
    firstName: data?.first_name ?? normalizeText(metadata.first_name),
    lastName: data?.last_name ?? normalizeText(metadata.last_name),
    timezone: data?.timezone ?? null,
    emailConfirmedAt: normalizeText((session.user as any)?.email_confirmed_at),
    createdAt: normalizeText(data?.created_at) ?? normalizeText(session.user?.created_at)
  });
}

export async function updateProfilePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = profileUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (parsedBody.firstName !== undefined) payload.first_name = parsedBody.firstName;
  if (parsedBody.lastName !== undefined) payload.last_name = parsedBody.lastName;
  if (parsedBody.timezone !== undefined) payload.timezone = parsedBody.timezone;

  const { error } = await client.from('profiles').update(payload).eq('user_id', session.userId);
  if (error) {
    throw error;
  }

  if (parsedBody.firstName !== undefined || parsedBody.lastName !== undefined) {
    const metadata: Record<string, string> = {};
    if (parsedBody.firstName !== undefined) metadata.first_name = parsedBody.firstName;
    if (parsedBody.lastName !== undefined) metadata.last_name = parsedBody.lastName;

    if (session.authMode === 'cookie') {
      const serverClient = createSupabaseServerClient();
      const { error: authError } = await serverClient.auth.updateUser({ data: metadata });
      if (authError) {
        console.warn('profile metadata update warning', authError.message);
      }
    }
  }

  return loadProfilePayload(session);
}

export async function loadMarketingEmailPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return marketingEmailSchemaV1.parse({
    marketingEmailOptIn: data?.marketing_email_opt_in === true,
    updatedAt: normalizeText(data?.marketing_email_opt_in_updated_at)
  });
}

export async function updateMarketingEmailPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = marketingEmailUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();
  const { data, error } = await client
    .from('profiles')
    .update({
      marketing_email_opt_in: parsedBody.marketingEmailOptIn,
      marketing_email_opt_in_updated_at: updatedAt,
      updated_at: updatedAt
    })
    .eq('user_id', session.userId)
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return marketingEmailSchemaV1.parse({
    marketingEmailOptIn: data?.marketing_email_opt_in === true,
    updatedAt: normalizeText(data?.marketing_email_opt_in_updated_at) ?? updatedAt
  });
}

export async function loadWatchlistsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('watchlists')
    .select('id, name, created_at, watchlist_rules(id, rule_type, rule_value, created_at)')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return watchlistsSchemaV1.parse({
    watchlists: (data || []).map(mapWatchlistPayload)
  });
}

export async function createWatchlistPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const parsedBody = watchlistCreateSchemaV1.parse(await request.json().catch(() => ({})));
  const { count, error: countError } = await client
    .from('watchlists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }

  const watchlistLimit = entitlement.limits.watchlistLimit;
  if ((count ?? 0) >= watchlistLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const createdAt = new Date().toISOString();
  const { data, error } = await client
    .from('watchlists')
    .insert({
      user_id: session.userId,
      name: parsedBody.name?.trim() ? parsedBody.name.trim() : 'My Launches',
      created_at: createdAt
    })
    .select('id, name, created_at')
    .single();

  if (error) {
    throw error;
  }

  return watchlistEnvelopeSchemaV1.parse({
    watchlist: mapWatchlistPayload(data)
  });
}

export async function updateWatchlistPayload(session: ResolvedViewerSession, watchlistId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const parsedBody = watchlistUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const { data, error } = await client
    .from('watchlists')
    .update({ name: parsedBody.name })
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .select('id, name, created_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return watchlistEnvelopeSchemaV1.parse({
    watchlist: mapWatchlistPayload(data)
  });
}

export async function deleteWatchlistPayload(session: ResolvedViewerSession, watchlistId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const { data, error } = await client
    .from('watchlists')
    .delete()
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function createWatchlistRulePayload(session: ResolvedViewerSession, watchlistId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const parsedBody = watchlistRuleCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const normalizedRule = normalizeWatchlistRule(parsedBody.ruleType, parsedBody.ruleValue);
  if (!normalizedRule) {
    throw new MobileApiRouteError(400, 'invalid_rule_value');
  }

  const { data: watchlist, error: watchlistError } = await client
    .from('watchlists')
    .select('id')
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (watchlistError) {
    throw watchlistError;
  }
  if (!watchlist) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  const { data: existing, error: existingError } = await client
    .from('watchlist_rules')
    .select('id, rule_type, rule_value, created_at')
    .eq('watchlist_id', normalizedWatchlistId)
    .eq('rule_type', normalizedRule.rule_type)
    .eq('rule_value', normalizedRule.rule_value)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    const scope = normalizeWatchScope(normalizedRule.rule_type as any, normalizedRule.rule_value);
    if (scope) {
      await upsertUnifiedRule(client, {
        ownerKind: 'user',
        userId: session.userId,
        intent: 'follow',
        visibleInFollowing: true,
        enabled: true,
        channels: [],
        scope
      });
    }
    return watchlistRuleEnvelopeSchemaV1.parse({
      rule: mapWatchlistRulePayload(existing),
      source: 'existing'
    });
  }

  const { count, error: countError } = await client
    .from('watchlist_rules')
    .select('id', { count: 'exact', head: true })
    .eq('watchlist_id', normalizedWatchlistId);
  if (countError) {
    throw countError;
  }
  const ruleCount = count ?? 0;

  if (ruleCount >= entitlement.limits.watchlistRuleLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const createdAt = new Date().toISOString();
  const { data, error } = await client
    .from('watchlist_rules')
    .insert({
      watchlist_id: normalizedWatchlistId,
      rule_type: normalizedRule.rule_type,
      rule_value: normalizedRule.rule_value,
      created_at: createdAt
    })
    .select('id, rule_type, rule_value, created_at')
    .single();

  if (error) {
    throw error;
  }

  const scope = normalizeWatchScope(normalizedRule.rule_type as any, normalizedRule.rule_value);
  if (scope) {
    await upsertUnifiedRule(client, {
      ownerKind: 'user',
      userId: session.userId,
      intent: 'follow',
      visibleInFollowing: true,
      enabled: true,
      channels: [],
      scope
    });
  }

  return watchlistRuleEnvelopeSchemaV1.parse({
    rule: mapWatchlistRulePayload(data),
    source: 'created'
  });
}

export async function deleteWatchlistRulePayload(session: ResolvedViewerSession, watchlistId: string, ruleId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const normalizedRuleId = parseUuidOrThrow(ruleId, 'invalid_rule_id');
  const { data, error } = await client
    .from('watchlist_rules')
    .delete()
    .eq('id', normalizedRuleId)
    .eq('watchlist_id', normalizedWatchlistId)
    .select('id, rule_type, rule_value')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  const normalized = normalizeWatchScope(
    data.rule_type as z.infer<typeof watchlistRuleTypeSchemaV1>,
    String(data.rule_value || '')
  );
  if (normalized) {
    await clearUnifiedFollowIntent(client, { ownerKind: 'user', userId: session.userId }, normalized);
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadFilterPresetsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('launch_filter_presets')
    .select('id, name, filters, is_default, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return filterPresetsSchemaV1.parse({
    presets: (data || []).map(mapFilterPresetPayload)
  });
}

export async function createFilterPresetPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const parsedBody = filterPresetCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const { count, error: countError } = await client
    .from('launch_filter_presets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }

  if ((count ?? 0) >= entitlement.limits.presetLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const updatedAt = new Date().toISOString();
  if (parsedBody.isDefault === true) {
    const { error: clearError } = await client
      .from('launch_filter_presets')
      .update({ is_default: false, updated_at: updatedAt })
      .eq('user_id', session.userId)
      .eq('is_default', true);
    if (clearError) {
      throw clearError;
    }
  }

  const { data, error } = await client
    .from('launch_filter_presets')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: parsedBody.filters,
      is_default: parsedBody.isDefault === true,
      created_at: updatedAt,
      updated_at: updatedAt
    })
    .select('id, name, filters, is_default, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return filterPresetEnvelopeSchemaV1.parse({
    preset: mapFilterPresetPayload(data)
  });
}

export async function updateFilterPresetPayload(session: ResolvedViewerSession, presetId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedPresetId = parseUuidOrThrow(presetId, 'invalid_preset_id');
  const parsedBody = filterPresetUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();

  if (parsedBody.isDefault === true) {
    const { error: clearError } = await client
      .from('launch_filter_presets')
      .update({ is_default: false, updated_at: updatedAt })
      .eq('user_id', session.userId)
      .eq('is_default', true);
    if (clearError) {
      throw clearError;
    }
  }

  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;
  if (parsedBody.isDefault !== undefined) payload.is_default = parsedBody.isDefault;

  const { data, error } = await client
    .from('launch_filter_presets')
    .update(payload)
    .eq('id', normalizedPresetId)
    .eq('user_id', session.userId)
    .select('id, name, filters, is_default, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return filterPresetEnvelopeSchemaV1.parse({
    preset: mapFilterPresetPayload(data)
  });
}

export async function deleteFilterPresetPayload(session: ResolvedViewerSession, presetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedPresetId = parseUuidOrThrow(presetId, 'invalid_preset_id');
  const { data, error } = await client
    .from('launch_filter_presets')
    .delete()
    .eq('id', normalizedPresetId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

async function requireOwnedPreset(client: PrivilegedClient, userId: string, presetId: string) {
  const { data, error } = await client
    .from('launch_filter_presets')
    .select('id, filters')
    .eq('id', presetId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'preset_not_found');
  }
  return data;
}

async function requireOwnedWatchlist(client: PrivilegedClient, userId: string, watchlistId: string) {
  const { data, error } = await client
    .from('watchlists')
    .select('id')
    .eq('id', watchlistId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'watchlist_not_found');
  }
  return data;
}

async function requireUserOwnedFollowRule(
  client: PrivilegedClient,
  userId: string,
  ruleType: z.infer<typeof watchlistRuleTypeSchemaV1>,
  ruleValue: string
) {
  const { data: watchlists, error: watchlistsError } = await client.from('watchlists').select('id').eq('user_id', userId);
  if (watchlistsError) {
    throw watchlistsError;
  }

  const watchlistIds = (watchlists ?? []).map((entry) => entry.id).filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!watchlistIds.length) {
    throw new MobileApiRouteError(404, 'follow_not_found');
  }

  const { data, error } = await client
    .from('watchlist_rules')
    .select('id')
    .eq('rule_type', ruleType)
    .eq('rule_value', ruleValue)
    .in('watchlist_id', watchlistIds)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'follow_not_found');
  }

  return data;
}

export async function loadAlertRulesPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('notification_alert_rules')
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .eq('user_id', session.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  return alertRulesSchemaV1.parse({
    rules: (data ?? []).map((row) => mapAlertRulePayload(row as AlertRuleRow))
  });
}

export async function loadBasicFollowsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireAuthedEntitlement(session);
  const [launchSummary, allUsRuleRes] = await Promise.all([
    entitlement.tier === 'premium'
      ? Promise.resolve({ activeLaunchFollow: null as BasicLaunchFollowSummary | null })
      : pruneBasicLaunchNotificationPreferences(client, session.userId),
    client
      .from('notification_alert_rules')
      .select('id')
      .eq('user_id', session.userId)
      .eq('kind', 'region_us')
      .limit(1)
  ]);

  if (allUsRuleRes.error) {
    throw allUsRuleRes.error;
  }

  return basicFollowsSchemaV1.parse({
    singleLaunchFollowLimit: entitlement.limits.singleLaunchFollowLimit,
    activeLaunchFollow: launchSummary.activeLaunchFollow,
    allUsEnabled: Array.isArray(allUsRuleRes.data) && allUsRuleRes.data.length > 0
  });
}

export async function createAlertRulePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireAuthedEntitlement(session);
  const parsedBody = alertRuleCreateSchemaV1.parse(await request.json().catch(() => undefined));
  assertAlertRuleCreationAccess(entitlement, parsedBody.kind);
  const prefsRes = await client
    .from('notification_preferences')
    .select('notify_t_minus_60, notify_t_minus_10, notify_status_change, notify_net_change')
    .eq('user_id', session.userId)
    .maybeSingle();
  if (prefsRes.error) {
    throw prefsRes.error;
  }
  const unifiedSettings = {
    timezone: 'UTC',
    prelaunchOffsetsMinutes: [
      ...(prefsRes.data?.notify_t_minus_60 !== false ? [60] : []),
      ...(prefsRes.data?.notify_t_minus_10 !== false ? [10] : [])
    ],
    statusChangeTypes: prefsRes.data?.notify_status_change ? (['any'] as string[]) : [],
    notifyNetChanges: prefsRes.data?.notify_net_change === true
  };

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    user_id: session.userId,
    kind: parsedBody.kind,
    updated_at: now
  };
  let existingQuery: any = client
    .from('notification_alert_rules')
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .eq('user_id', session.userId)
    .limit(1);

  if (parsedBody.kind === 'region_us') {
    existingQuery = existingQuery.eq('kind', 'region_us');
  } else if (parsedBody.kind === 'state') {
    const normalizedState = normalizeAlertRuleStateValue(parsedBody.state);
    payload.state = normalizedState;
    existingQuery = existingQuery.eq('kind', 'state').eq('state', normalizedState);
  } else if (parsedBody.kind === 'filter_preset') {
    await requireOwnedPreset(client, session.userId, parsedBody.presetId);
    payload.filter_preset_id = parsedBody.presetId;
    existingQuery = existingQuery.eq('kind', 'filter_preset').eq('filter_preset_id', parsedBody.presetId);
  } else {
    const normalizedFollow = normalizeWatchlistRule(parsedBody.followRuleType, parsedBody.followRuleValue);
    if (!normalizedFollow) {
      throw new MobileApiRouteError(400, 'invalid_rule_value');
    }
    await requireUserOwnedFollowRule(client, session.userId, normalizedFollow.rule_type, normalizedFollow.rule_value);
    payload.follow_rule_type = normalizedFollow.rule_type;
    payload.follow_rule_value = normalizedFollow.rule_value;
    existingQuery = existingQuery
      .eq('kind', 'follow')
      .eq('follow_rule_type', normalizedFollow.rule_type)
      .eq('follow_rule_value', normalizedFollow.rule_value);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    throw existingError;
  }
  if (existing) {
    return alertRuleEnvelopeSchemaV1.parse({
      rule: mapAlertRulePayload(existing as AlertRuleRow),
      source: 'existing'
    });
  }

  const { data, error } = await client
    .from('notification_alert_rules')
    .insert({
      ...payload,
      created_at: now
    })
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .single();

  if (error) {
    throw error;
  }

  let scope: NotificationRuleScope | null = null;
  if (parsedBody.kind === 'region_us') {
    scope = { scopeKind: 'all_us', scopeKey: 'us' };
  } else if (parsedBody.kind === 'state') {
    scope = normalizeWatchScope('state', payload.state as string);
  } else if (parsedBody.kind === 'filter_preset') {
    scope = { scopeKind: 'preset', scopeKey: parsedBody.presetId.toLowerCase(), presetId: parsedBody.presetId };
  } else {
    scope = normalizeWatchScope(payload.follow_rule_type as any, payload.follow_rule_value as string);
  }
  if (scope) {
    await upsertUnifiedRule(client, {
      ownerKind: 'user',
      userId: session.userId,
      intent: 'notifications_only',
      visibleInFollowing: false,
      enabled: true,
      channels: ['push'],
      scope,
      settings: unifiedSettings
    });
  }

  return alertRuleEnvelopeSchemaV1.parse({
    rule: mapAlertRulePayload(data as AlertRuleRow),
    source: 'created'
  });
}

export async function deleteAlertRulePayload(session: ResolvedViewerSession, ruleId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireAuthedEntitlement(session);
  const normalizedRuleId = parseUuidOrThrow(ruleId, 'invalid_rule_id');
  const { data, error } = await client
    .from('notification_alert_rules')
    .delete()
    .eq('id', normalizedRuleId)
    .eq('user_id', session.userId)
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  let scope: NotificationRuleScope | null = null;
  if (data.kind === 'region_us') {
    scope = { scopeKind: 'all_us', scopeKey: 'us' };
  } else if (data.kind === 'state') {
    scope = normalizeWatchScope('state', String(data.state || ''));
  } else if (data.kind === 'filter_preset' && data.filter_preset_id) {
    scope = { scopeKind: 'preset', scopeKey: String(data.filter_preset_id).toLowerCase(), presetId: String(data.filter_preset_id) };
  } else if (data.kind === 'follow' && data.follow_rule_type && data.follow_rule_value) {
    scope = normalizeWatchScope(data.follow_rule_type as any, String(data.follow_rule_value));
  }
  if (scope) {
    await removeChannelsFromUnifiedRule(client, { ownerKind: 'user', userId: session.userId }, scope, ['push']);
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadCalendarFeedsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('calendar_feeds')
    .select('id, name, token, filters, source_kind, source_preset_id, source_follow_rule_type, source_follow_rule_value, alarm_minutes_before, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return calendarFeedsSchemaV1.parse({
    feeds: (data || []).map(mapCalendarFeedPayload)
  });
}

export async function createCalendarFeedPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = calendarFeedCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const sourcePayload = await resolveCalendarFeedSourcePayload(client, session.userId, parsedBody);
  const { count, error: countError } = await client
    .from('calendar_feeds')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('calendar_feeds')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: sourcePayload.filters,
      source_kind: sourcePayload.sourceKind,
      source_preset_id: sourcePayload.presetId,
      source_follow_rule_type: sourcePayload.followRuleType,
      source_follow_rule_value: sourcePayload.followRuleValue,
      alarm_minutes_before: parsedBody.alarmMinutesBefore ?? null,
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, filters, source_kind, source_preset_id, source_follow_rule_type, source_follow_rule_value, alarm_minutes_before, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function updateCalendarFeedPayload(session: ResolvedViewerSession, feedId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const parsedBody = calendarFeedUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const existingFeedRes = await client
    .from('calendar_feeds')
    .select('id, filters, source_kind, source_preset_id, source_follow_rule_type, source_follow_rule_value')
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .maybeSingle();
  if (existingFeedRes.error) {
    throw existingFeedRes.error;
  }
  if (!existingFeedRes.data) {
    throw new MobileApiRouteError(404, 'not_found');
  }
  const sourcePayload = await resolveCalendarFeedSourcePayload(client, session.userId, parsedBody, existingFeedRes.data as CalendarFeedSourceRow);
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    cached_ics: null,
    cached_ics_etag: null,
    cached_ics_generated_at: null
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  payload.filters = sourcePayload.filters;
  payload.source_kind = sourcePayload.sourceKind;
  payload.source_preset_id = sourcePayload.presetId;
  payload.source_follow_rule_type = sourcePayload.followRuleType;
  payload.source_follow_rule_value = sourcePayload.followRuleValue;
  if (Object.prototype.hasOwnProperty.call(parsedBody, 'alarmMinutesBefore')) {
    payload.alarm_minutes_before = parsedBody.alarmMinutesBefore ?? null;
  }

  const { data, error } = await client
    .from('calendar_feeds')
    .update(payload)
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, source_kind, source_preset_id, source_follow_rule_type, source_follow_rule_value, alarm_minutes_before, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function deleteCalendarFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('calendar_feeds')
    .delete()
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateCalendarFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('calendar_feeds')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      cached_ics: null,
      cached_ics_etag: null,
      cached_ics_generated_at: null
    })
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, source_kind, source_preset_id, source_follow_rule_type, source_follow_rule_value, alarm_minutes_before, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function loadRssFeedsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('rss_feeds')
    .select('id, name, token, filters, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return rssFeedsSchemaV1.parse({
    feeds: (data || []).map(mapRssFeedPayload)
  });
}

export async function createRssFeedPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = rssFeedCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const { count, error: countError } = await client.from('rss_feeds').select('id', { count: 'exact', head: true }).eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('rss_feeds')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: parsedBody.filters ?? {},
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, filters, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function updateRssFeedPayload(session: ResolvedViewerSession, feedId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const parsedBody = rssFeedUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    cached_rss_xml: null,
    cached_rss_etag: null,
    cached_rss_generated_at: null,
    cached_atom_xml: null,
    cached_atom_etag: null,
    cached_atom_generated_at: null
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;

  const { data, error } = await client
    .from('rss_feeds')
    .update(payload)
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function deleteRssFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('rss_feeds')
    .delete()
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateRssFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('rss_feeds')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      cached_rss_xml: null,
      cached_rss_etag: null,
      cached_rss_generated_at: null,
      cached_atom_xml: null,
      cached_atom_etag: null,
      cached_atom_generated_at: null
    })
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function loadEmbedWidgetsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('embed_widgets')
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return embedWidgetsSchemaV1.parse({
    widgets: (data || []).map(mapEmbedWidgetPayload)
  });
}

export async function createEmbedWidgetPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = embedWidgetCreateSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.presetId && parsedBody.watchlistId) {
    throw new MobileApiRouteError(400, 'invalid_scope');
  }

  const { count, error: countError } = await client
    .from('embed_widgets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  let resolvedFilters = parsedBody.filters ?? {};
  const resolvedPresetId: string | null = parsedBody.presetId ?? null;
  const resolvedWatchlistId: string | null = parsedBody.watchlistId ?? null;

  if (resolvedPresetId) {
    const preset = await requireOwnedPreset(client, session.userId, resolvedPresetId);
    if (parsedBody.filters === undefined) {
      resolvedFilters = (preset.filters as Record<string, unknown>) || {};
    }
  }

  if (resolvedWatchlistId) {
    await requireOwnedWatchlist(client, session.userId, resolvedWatchlistId);
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('embed_widgets')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      widget_type: 'next_launch_card',
      filters: resolvedFilters,
      preset_id: resolvedPresetId,
      watchlist_id: resolvedWatchlistId,
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function updateEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const parsedBody = embedWidgetUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.presetId && parsedBody.watchlistId) {
    throw new MobileApiRouteError(400, 'invalid_scope');
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;

  if (parsedBody.presetId !== undefined) {
    if (parsedBody.presetId === null) {
      payload.preset_id = null;
    } else {
      await requireOwnedPreset(client, session.userId, parsedBody.presetId);
      payload.preset_id = parsedBody.presetId;
    }
  }

  if (parsedBody.watchlistId !== undefined) {
    if (parsedBody.watchlistId === null) {
      payload.watchlist_id = null;
    } else {
      await requireOwnedWatchlist(client, session.userId, parsedBody.watchlistId);
      payload.watchlist_id = parsedBody.watchlistId;
    }
  }

  const { data, error } = await client
    .from('embed_widgets')
    .update(payload)
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function deleteEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const { data, error } = await client
    .from('embed_widgets')
    .delete()
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const { data, error } = await client
    .from('embed_widgets')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString()
    })
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function loadNotificationPreferencesPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }
  return retiredNotificationPreferencesPayload();
}

export async function updateNotificationPreferencesPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }
  notificationPreferencesUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  throwRetiredLegacyNotifications();
}

export async function deleteAccountPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }
  const parsedBody = deleteAccountSchema.parse(await request.json().catch(() => undefined));
  try {
    return await deleteAccountWithGuards({
      userId: session.userId,
      email: session.email ?? null,
      confirm: parsedBody.confirm
    });
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      throw new MobileApiRouteError(error.status, error.code);
    }
    throw error;
  }
}

export async function loadLaunchNotificationPreferencePayload(
  session: ResolvedViewerSession,
  launchId: string
) {
  if (!session.userId) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(launchId);
  if (!parsedLaunch) {
    return null;
  }

  return retiredLaunchNotificationPreferencePayload(parsedLaunch.launchId);
}

export async function updateLaunchNotificationPreferencePayload(
  session: ResolvedViewerSession,
  launchId: string,
  request: Request
) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(launchId);
  if (!parsedLaunch) {
    throw new MobileApiRouteError(400, 'invalid_launch_id');
  }
  launchNotificationPreferenceUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  void client;
  throwRetiredLegacyNotifications();
}

export async function registerPushDevicePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = pushDeviceRegistrationSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.platform === 'web') {
    throwRetiredLegacyNotifications();
  }
  const registeredAt = new Date().toISOString();
  const pushProvider = 'expo';

  await upsertUnifiedPushDestination(
    client,
    { ownerKind: 'user', userId: session.userId, installationId: parsedBody.installationId },
    {
      platform: parsedBody.platform,
      deliveryKind: 'mobile_push',
      pushProvider,
      destinationKey: `expo:${parsedBody.platform}:${parsedBody.installationId}`,
      endpoint: null,
      token: parsedBody.token,
      appVersion: parsedBody.appVersion,
      deviceName: parsedBody.deviceName,
      isActive: true,
      verified: true
    }
  );

  return mapPushDevicePayload(null, {
    ...parsedBody,
    pushProvider,
    active: true,
    registeredAt
  });
}

export async function removePushDevicePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = pushDeviceRemovalInputSchema.parse(await request.json().catch(() => undefined));
  if (parsedBody.platform === 'web') {
    throwRetiredLegacyNotifications();
  }
  const removedAt = new Date().toISOString();
  await deactivatePushDestinations(
    client,
    { ownerKind: 'user', userId: session.userId, installationId: parsedBody.installationId },
    {
      installationId: parsedBody.installationId,
      platform: parsedBody.platform,
      reason: 'device_removed'
    }
  );

  return pushDeviceRemovalSchemaV1.parse({
    platform: parsedBody.platform,
    installationId: parsedBody.installationId,
    removed: true,
    removedAt
  });
}

export async function enqueuePushDeviceTestPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const entitlement = await requireAuthedEntitlement(session);
  if (!entitlement.capabilities.canUseBasicAlertRules) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new MobileApiRouteError(501, 'notifications_not_configured');
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const admin = createSupabaseAdminClient();

  const deviceRes = await admin
    .from('notification_push_destinations_v3')
    .select('id')
    .eq('user_id', session.userId)
    .eq('is_active', true)
    .eq('delivery_kind', 'mobile_push')
    .in('platform', ['ios', 'android'])
    .limit(1);

  if (deviceRes.error) throw deviceRes.error;

  if (!deviceRes.data?.length) {
    throw new MobileApiRouteError(409, 'push_not_registered');
  }

  const queuedAt = new Date().toISOString();
  const { error } = await admin.from('mobile_push_outbox_v2').insert({
    owner_kind: 'user',
    user_id: session.userId,
    installation_id: null,
    launch_id: null,
    channel: 'push',
    event_type: 'test',
    payload: {
      title: 'T-Minus Zero',
      message: 'Test notification from T-Minus Zero.',
      url: '/preferences',
      eventType: 'test'
    },
    status: 'queued',
    scheduled_for: queuedAt,
    created_at: queuedAt
  });

  if (error) {
    throw error;
  }

  return pushDeliveryTestSchemaV1.parse({
    ok: true,
    queuedAt
  });
}

// Keep the typed client import live so shared transport stays wired into the monorepo task graph.
export const sharedApiClient = createApiClient;
