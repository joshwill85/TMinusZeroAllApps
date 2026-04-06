import {
  mobilePushAccessSchemaV1,
  mobilePushDeviceRegisterSchemaV1,
  mobilePushDeviceRemoveSchemaV1,
  mobilePushDeviceSchemaV1,
  mobilePushGuestContextSchemaV1,
  mobilePushLaunchPreferenceEnvelopeSchemaV1,
  mobilePushRuleSchemaV1,
  mobilePushRuleEnvelopeSchemaV1,
  mobilePushRulesEnvelopeSchemaV1,
  mobilePushRuleUpsertSchemaV1,
  mobilePushTestRequestSchemaV1,
  mobilePushTestSchemaV1,
  successResponseSchemaV1
} from '@tminuszero/contracts';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import {
  buildFollowScopeLabel,
  countUnifiedRulesByScopeKind,
  createDeviceSecret,
  deactivatePushDestinations,
  hashDeviceSecret,
  loadUnifiedRuleById,
  loadUnifiedRuleByScope,
  loadUnifiedRulesForOwner,
  normalizeNotificationScopeInput,
  normalizeWatchScope,
  ownerKeyFor,
  removeChannelsFromUnifiedRule,
  ruleRowToScope,
  secretsMatch,
  upsertUnifiedPushDestination,
  upsertUnifiedRule,
  type NotificationOwner
} from '@/lib/server/notificationsV3';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type MobilePushRouteErrorCode =
  | 'invalid_launch_id'
  | 'invalid_rule_id'
  | 'invalid_guest_device'
  | 'notifications_not_configured'
  | 'payment_required'
  | 'limit_reached'
  | 'preset_not_found'
  | 'follow_not_found'
  | 'push_not_registered'
  | 'unauthorized'
  | 'invalid_prelaunch_offset'
  | 'missing_delivery_config'
  | 'invalid_scope'
  | 'not_found';

type MobilePushAccess = ReturnType<typeof mobilePushAccessSchemaV1.parse>;

type MobilePushPrincipal = {
  ownerKind: 'guest' | 'user';
  userId: string | null;
  installationId: string;
  deviceSecret: string | null;
  access: MobilePushAccess;
};

function toNotificationOwner(principal: MobilePushPrincipal): NotificationOwner {
  if (principal.ownerKind === 'guest') {
    return { ownerKind: 'guest', installationId: principal.installationId };
  }
  if (!principal.userId) {
    throw new MobilePushRouteError(401, 'unauthorized');
  }
  return {
    ownerKind: 'user',
    userId: principal.userId,
    installationId: principal.installationId
  };
}

type DeviceRow = {
  id: string;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id: string;
  platform?: 'web' | 'ios' | 'android' | null;
  delivery_kind?: 'web_push' | 'mobile_push' | null;
  app_version?: string | null;
  device_name?: string | null;
  device_secret_hash?: string | null;
  is_active?: boolean | null;
  last_registered_at?: string | null;
  last_sent_at?: string | null;
  last_receipt_at?: string | null;
  last_failure_reason?: string | null;
  disabled_at?: string | null;
  updated_at?: string | null;
};

type RuleRow = {
  id: string;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id?: string | null;
  intent?: 'follow' | 'notifications_only' | null;
  visible_in_following?: boolean | null;
  enabled?: boolean | null;
  scope_kind: 'all_us' | 'state' | 'launch' | 'all_launches' | 'preset' | 'provider' | 'rocket' | 'pad' | 'launch_site' | 'tier' | 'filter';
  scope_key?: string | null;
  state?: string | null;
  launch_id?: string | null;
  provider?: string | null;
  rocket_id?: number | null;
  pad_key?: string | null;
  launch_site?: string | null;
  filter_preset_id?: string | null;
  filters?: Record<string, unknown> | null;
  tier?: string | null;
  channels?: string[] | null;
  timezone?: string | null;
  prelaunch_offsets_minutes?: number[] | null;
  include_liftoff?: boolean | null;
  daily_digest_local_time?: string | null;
  status_change_types?: string[] | null;
  notify_net_change?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  launches?: { name?: string | null } | { name?: string | null }[] | null;
  launch_filter_presets?: { name?: string | null } | { name?: string | null }[] | null;
};

function ruleScopeFromRow(row: RuleRow) {
  const fallbackScopeKey =
    normalizeText(row.scope_key) ??
    (row.scope_kind === 'launch'
      ? normalizeText(row.launch_id)
      : row.scope_kind === 'state'
        ? normalizeText(row.state)?.toLowerCase()
        : row.scope_kind === 'provider'
          ? normalizeText(row.provider)?.toLowerCase()
          : row.scope_kind === 'rocket'
            ? typeof row.rocket_id === 'number'
              ? `ll2:${row.rocket_id}`
              : null
            : row.scope_kind === 'pad'
              ? normalizeText(row.pad_key)?.toLowerCase()
              : row.scope_kind === 'launch_site'
                ? normalizeText(row.launch_site)?.toLowerCase()
                : row.scope_kind === 'preset'
                  ? normalizeText(row.filter_preset_id)?.toLowerCase()
                  : row.scope_kind === 'tier'
                    ? normalizeText(row.tier)?.toLowerCase()
                    : row.scope_kind === 'all_us'
                      ? 'us'
                      : row.scope_kind === 'all_launches'
                        ? 'all'
                        : null) ??
    'unknown';
  return ruleRowToScope({
    ...row,
    scope_key: fallbackScopeKey
  });
}

export class MobilePushRouteError extends Error {
  status: number;
  code: MobilePushRouteErrorCode;

  constructor(status: number, code: MobilePushRouteErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MobilePushRouteError';
    this.status = status;
    this.code = code;
  }
}

const BASIC_PRELAUNCH_OPTIONS = new Set([1, 5, 10, 60]);
const PREMIUM_PRELAUNCH_OPTIONS = new Set([1, 5, 10, 30, 60, 120, 360, 720, 1440]);
const STATUS_CHANGE_OPTIONS = new Set(['any', 'go', 'hold', 'scrubbed', 'tbd']);
const BASIC_MAX_PRELAUNCH_OFFSETS = 2;
const PREMIUM_MAX_PRELAUNCH_OFFSETS = 3;
const GUEST_SCOPE_LIMITS = {
  launch: 1,
  all_us: 1
} as const;

function getAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new MobilePushRouteError(501, 'notifications_not_configured');
  }
  return createSupabaseAdminClient();
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeLocalTime(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeOffsets(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'number' ? Math.trunc(value) : Number.NaN))
        .filter((value) => Number.isInteger(value))
    )
  ).sort((left, right) => left - right);
}

function normalizeStatusChangeTypes(values: unknown) {
  if (!Array.isArray(values)) return [];
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => STATUS_CHANGE_OPTIONS.has(value))
    )
  );
  if (normalized.includes('any')) {
    return ['any'];
  }
  return normalized;
}

function formatFollowLabel(ruleType: string | null | undefined, ruleValue: string | null | undefined) {
  const type = String(ruleType || '').trim();
  const value = String(ruleValue || '').trim();
  if (!type || !value) return 'Follow';
  if (type === 'provider') return `Followed provider: ${value}`;
  if (type === 'rocket') return `Followed rocket: ${value}`;
  if (type === 'launch_site') return `Followed launch site: ${value}`;
  if (type === 'state') return `State launches: ${value}`;
  if (type === 'tier') return `Followed tier: ${value}`;
  if (type === 'pad') {
    return value.startsWith('ll2:') ? `Followed pad ${value.slice(4)}` : `Followed pad: ${value.replace(/^code:/, '')}`;
  }
  return 'Followed launch';
}

function firstJoinedName(value: RuleRow['launches'] | RuleRow['launch_filter_presets']) {
  if (Array.isArray(value)) {
    const name = normalizeText(value[0]?.name);
    return name;
  }
  return normalizeText(value?.name);
}

async function resolveMobilePushAccess(session: ResolvedViewerSession) {
  if (!session.userId) {
    return buildMobilePushAccess({ ownerKind: 'guest', advancedAllowed: false });
  }

  const { entitlement } = await getViewerEntitlement({
    session,
    reconcileStripe: false
  });
  const advancedAllowed = entitlement.tier === 'premium';

  return buildMobilePushAccess({
    ownerKind: advancedAllowed ? 'user' : 'guest',
    advancedAllowed
  });
}

async function resolvePrincipal(session: ResolvedViewerSession, context: { installationId: string; deviceSecret?: string | null }) {
  const access = await resolveMobilePushAccess(session);
  return {
    ownerKind: access.ownerKind,
    userId: access.ownerKind === 'user' ? session.userId : null,
    installationId: context.installationId,
    deviceSecret: normalizeText(context.deviceSecret) ?? null,
    access
  } satisfies MobilePushPrincipal;
}

function buildEmptyDevice(principal: MobilePushPrincipal) {
  return mobilePushDeviceSchemaV1.parse({
    ownerKind: principal.ownerKind,
    platform: null,
    installationId: principal.installationId,
    registered: false,
    active: false,
    registeredAt: null,
    lastSentAt: null,
    lastReceiptAt: null,
    lastFailureReason: null,
    disabledAt: null,
    deviceSecret: null
  });
}

function mapDevice(row: DeviceRow | null, principal: MobilePushPrincipal, deviceSecret: string | null = null) {
  if (!row) {
    return buildEmptyDevice(principal);
  }

  return mobilePushDeviceSchemaV1.parse({
    ownerKind: row.owner_kind,
    platform: row.platform ?? null,
    installationId: row.installation_id,
    registered: row.is_active === true,
    active: row.is_active === true,
    registeredAt: normalizeText(row.last_registered_at) ?? normalizeText(row.updated_at),
    lastSentAt: normalizeText(row.last_sent_at),
    lastReceiptAt: normalizeText(row.last_receipt_at),
    lastFailureReason: normalizeText(row.last_failure_reason),
    disabledAt: normalizeText(row.disabled_at),
    deviceSecret
  });
}

function mapRule(row: RuleRow) {
  const settings = {
    timezone: normalizeText(row.timezone) ?? 'UTC',
    prelaunchOffsetsMinutes: normalizeOffsets(row.prelaunch_offsets_minutes).slice(0, 3),
    dailyDigestLocalTime: normalizeLocalTime(row.daily_digest_local_time),
    statusChangeTypes: normalizeStatusChangeTypes(row.status_change_types).slice(0, 5),
    notifyNetChanges: row.notify_net_change === true
  };

  const createdAt = normalizeText(row.created_at);
  const updatedAt = normalizeText(row.updated_at);
  const base = {
    id: row.id,
    label: buildRuleLabel(row),
    settings,
    createdAt,
    updatedAt
  };

  if (row.scope_kind === 'all_us') {
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'all_us'
    });
  }
  if (row.scope_kind === 'state') {
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'state',
      state: normalizeText(row.state) ?? 'Unknown'
    });
  }
  if (row.scope_kind === 'launch') {
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'launch',
      launchId: row.launch_id
    });
  }
  if (row.scope_kind === 'all_launches') {
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'all_launches'
    });
  }
  if (row.scope_kind === 'preset') {
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'preset',
      presetId: row.filter_preset_id
    });
  }

  if (row.scope_kind === 'provider' || row.scope_kind === 'rocket' || row.scope_kind === 'pad' || row.scope_kind === 'launch_site' || row.scope_kind === 'tier') {
    const scope = ruleScopeFromRow(row);
    return mobilePushRuleSchemaV1.parse({
      ...base,
      scopeKind: 'follow',
      followRuleType:
        row.scope_kind === 'provider'
          ? 'provider'
          : row.scope_kind === 'rocket'
            ? 'rocket'
            : row.scope_kind === 'pad'
              ? 'pad'
              : row.scope_kind === 'launch_site'
                ? 'launch_site'
                : 'tier',
      followRuleValue:
        row.scope_kind === 'provider'
          ? normalizeText(row.provider) ?? row.scope_key ?? ''
          : row.scope_kind === 'rocket'
            ? typeof row.rocket_id === 'number'
              ? `ll2:${row.rocket_id}`
              : row.scope_key ?? ''
            : row.scope_kind === 'pad'
              ? normalizeText(row.pad_key) ?? row.scope_key ?? ''
              : row.scope_kind === 'launch_site'
                ? normalizeText(row.launch_site) ?? row.scope_key ?? ''
                : normalizeText(row.tier) ?? row.scope_key ?? '',
      label: buildFollowScopeLabel(scope)
    });
  }

  return mobilePushRuleSchemaV1.parse({
    ...base,
    scopeKind: 'follow',
    followRuleType: 'launch',
    followRuleValue: normalizeText(row.launch_id) ?? row.scope_key ?? ''
  });
}

function buildRuleLabel(row: RuleRow) {
  if (row.scope_kind === 'all_us') return 'All U.S. launches';
  if (row.scope_kind === 'state') return normalizeText(row.state) ?? 'State';
  if (row.scope_kind === 'launch') return firstJoinedName(row.launches) ?? 'Launch alert';
  if (row.scope_kind === 'all_launches') return 'All launches';
  if (row.scope_kind === 'preset') return firstJoinedName(row.launch_filter_presets) ?? 'Saved filter';
  if (row.scope_kind === 'provider') return formatFollowLabel('provider', row.provider);
  if (row.scope_kind === 'rocket') {
    const value = typeof row.rocket_id === 'number' ? `ll2:${row.rocket_id}` : row.scope_key;
    return formatFollowLabel('rocket', value);
  }
  if (row.scope_kind === 'pad') return formatFollowLabel('pad', row.pad_key ?? row.scope_key);
  if (row.scope_kind === 'launch_site') return formatFollowLabel('launch_site', row.launch_site ?? row.scope_key);
  if (row.scope_kind === 'tier') return formatFollowLabel('tier', row.tier ?? row.scope_key);
  return 'Follow';
}

async function loadCurrentDevice(admin: AdminClient, principal: MobilePushPrincipal) {
  const owner = toNotificationOwner(principal);
  const { data, error } = await admin
    .from('notification_push_destinations_v3')
    .select(
      'id, owner_kind, user_id, installation_id, platform, delivery_kind, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .eq('owner_key', ownerKeyFor(owner))
    .eq('installation_id', principal.installationId)
    .eq('delivery_kind', 'mobile_push')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DeviceRow | null) ?? null;
}

async function deactivateConflictingDevices(
  admin: AdminClient,
  {
    ownerKind,
    userId,
    installationId,
    platform,
    now
  }: {
    ownerKind: 'guest' | 'user';
    userId: string | null;
    installationId: string;
    platform: 'ios' | 'android';
    now: string;
  }
) {
  const payload = {
    is_active: false,
    disabled_at: now,
    last_failure_reason: 'ownership_changed',
    updated_at: now
  };

  if (ownerKind === 'guest') {
    const { error } = await admin
      .from('notification_push_destinations_v3')
      .update(payload)
      .eq('owner_kind', 'user')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('delivery_kind', 'mobile_push')
      .eq('is_active', true);
    if (error) throw error;
    return;
  }

  const [{ error: guestError }, { error: otherUserError }] = await Promise.all([
    admin
      .from('notification_push_destinations_v3')
      .update(payload)
      .eq('owner_kind', 'guest')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('delivery_kind', 'mobile_push')
      .eq('is_active', true),
    admin
      .from('notification_push_destinations_v3')
      .update(payload)
      .eq('owner_kind', 'user')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('delivery_kind', 'mobile_push')
      .eq('is_active', true)
      .neq('user_id', userId ?? '')
  ]);
  if (guestError) throw guestError;
  if (otherUserError) throw otherUserError;
}

async function copyGuestBasicRulesToUser(admin: AdminClient, installationId: string, userId: string, now: string) {
  const guestOwner: NotificationOwner = { ownerKind: 'guest', installationId };
  const userOwner: NotificationOwner = { ownerKind: 'user', userId };
  const rows = await loadUnifiedRulesForOwner(admin, guestOwner);

  for (const row of rows.filter((entry) => entry.scope_kind === 'launch' || entry.scope_kind === 'all_us')) {
    await upsertUnifiedRule(admin, {
      ...userOwner,
      intent: 'notifications_only',
      visibleInFollowing: false,
      enabled: row.enabled !== false,
      channels: ['push'],
      scope: ruleRowToScope(row),
      settings: {
        timezone: normalizeText(row.timezone) ?? 'UTC',
        prelaunchOffsetsMinutes: normalizeOffsets(row.prelaunch_offsets_minutes).slice(0, BASIC_MAX_PRELAUNCH_OFFSETS),
        dailyDigestLocalTime: null,
        statusChangeTypes: [],
        notifyNetChanges: false
      }
    });
  }
}

async function requireAuthorizedGuestDevice(admin: AdminClient, installationId: string, deviceSecret: string | null, activeOnly = false) {
  const row = (await loadCurrentDevice(admin, {
    ownerKind: 'guest',
    installationId,
    userId: null,
    deviceSecret,
    access: buildMobilePushAccess({ ownerKind: 'guest', advancedAllowed: false })
  })) as (DeviceRow & {
    device_secret_hash?: string | null;
  }) | null;
  if (!row) {
    throw new MobilePushRouteError(409, 'push_not_registered');
  }
  if (!secretsMatch(row.device_secret_hash, deviceSecret)) {
    throw new MobilePushRouteError(401, 'invalid_guest_device');
  }
  if (activeOnly && row.is_active !== true) {
    throw new MobilePushRouteError(409, 'push_not_registered');
  }
  return row;
}

async function requireActiveDevice(admin: AdminClient, principal: MobilePushPrincipal) {
  if (principal.ownerKind === 'guest') {
    return requireAuthorizedGuestDevice(admin, principal.installationId, principal.deviceSecret, true);
  }

  const row = await loadCurrentDevice(admin, principal);
  if (!row || row.is_active !== true) {
    throw new MobilePushRouteError(409, 'push_not_registered');
  }
  return row;
}

async function verifyGuestReadAccessIfNeeded(admin: AdminClient, principal: MobilePushPrincipal) {
  if (principal.ownerKind !== 'guest') {
    return;
  }

  const existingDevice = await loadCurrentDevice(admin, principal);
  if (!existingDevice) {
    return;
  }
  if (!secretsMatch(existingDevice.device_secret_hash, principal.deviceSecret)) {
    throw new MobilePushRouteError(401, 'invalid_guest_device');
  }
}

async function pruneGuestBasicRules(
  admin: AdminClient,
  principal: MobilePushPrincipal,
  options: {
    preferredLaunchId?: string | null;
    nowMs?: number;
  } = {}
) {
  if (principal.ownerKind !== 'guest') {
    return { activeLaunchId: null as string | null };
  }

  const owner = toNotificationOwner(principal);
  const rows = (await loadUnifiedRulesForOwner(admin, owner)).filter(
    (row) => row.enabled !== false && Array.isArray(row.channels) && row.channels.includes('push')
  ) as RuleRow[];

  const stateRules = rows.filter((row) => row.scope_kind === 'state');
  if (stateRules.length) {
    await Promise.all(
      stateRules.map((row) =>
        removeChannelsFromUnifiedRule(
          admin,
          owner,
          {
            scopeKind: 'state',
            scopeKey: String(row.scope_key || row.state || '').trim().toLowerCase(),
            state: normalizeText(row.state) ?? ''
          },
          ['push']
        )
      )
    );
  }

  const launchRules = rows.filter((row) => row.scope_kind === 'launch' && normalizeText(row.launch_id));
  if (!launchRules.length) {
    return { activeLaunchId: null as string | null };
  }

  const launchIds = Array.from(new Set(launchRules.map((row) => String(row.launch_id || '').trim().toLowerCase()).filter(Boolean)));
  const { data: launches, error } = await admin.from('launches').select('id, net, hidden').in('id', launchIds);
  if (error) throw error;

  const nowMs = options.nowMs ?? Date.now();
  const preferredLaunchId = normalizeText(options.preferredLaunchId)?.toLowerCase() ?? null;
  const launchById = new Map<string, { id?: string | null; net?: string | null; hidden?: boolean | null }>();
  ((launches ?? []) as Array<{ id?: string | null; net?: string | null; hidden?: boolean | null }>).forEach((row) => {
    const launchId = String(row.id || '').trim().toLowerCase();
    if (!launchId) return;
    launchById.set(launchId, row);
  });

  const futureLaunches = launchIds
    .map((launchId) => {
      const launch = launchById.get(launchId);
      const net = String(launch?.net || '').trim() || null;
      const netMs = net ? Date.parse(net) : Number.NaN;
      return {
        launchId,
        hidden: launch?.hidden === true,
        netMs
      };
    })
    .filter((row) => !row.hidden && Number.isFinite(row.netMs) && row.netMs > nowMs)
    .sort((left, right) => left.netMs - right.netMs);

  const retainedLaunchId =
    (preferredLaunchId ? futureLaunches.find((row) => row.launchId === preferredLaunchId)?.launchId : null) ??
    futureLaunches[0]?.launchId ??
    null;

  const launchIdsToDelete = launchIds.filter((launchId) => launchId !== retainedLaunchId);
  if (launchIdsToDelete.length) {
    await Promise.all(
      launchIdsToDelete.map((launchId) =>
        removeChannelsFromUnifiedRule(
          admin,
          owner,
          {
            scopeKind: 'launch',
            scopeKey: launchId,
            launchId
          },
          ['push']
        )
      )
    );
  }

  return {
    activeLaunchId: retainedLaunchId
  };
}

async function loadRules(admin: AdminClient, principal: MobilePushPrincipal) {
  await pruneGuestBasicRules(admin, principal);
  const rows = await loadUnifiedRulesForOwner(admin, toNotificationOwner(principal));
  return rows.filter((row) => row.enabled !== false && Array.isArray(row.channels) && row.channels.includes('push')) as RuleRow[];
}

async function loadLaunchRule(admin: AdminClient, principal: MobilePushPrincipal, launchId: string) {
  await pruneGuestBasicRules(admin, principal, { preferredLaunchId: launchId });
  const row = await loadUnifiedRuleByScope(admin, toNotificationOwner(principal), {
    scopeKind: 'launch',
    scopeKey: launchId.toLowerCase(),
    launchId: launchId.toLowerCase()
  });
  if (!row || !Array.isArray(row.channels) || !row.channels.includes('push')) {
    return null;
  }
  return row as RuleRow;
}

function normalizeWatchlistRule(ruleType: string, ruleValue: string) {
  const scope = normalizeWatchScope(ruleType as any, ruleValue);
  if (!scope) return null;

  if (scope.scopeKind === 'launch') {
    return { ruleType: 'launch', ruleValue: scope.launchId };
  }
  if (scope.scopeKind === 'provider') {
    return { ruleType: 'provider', ruleValue: scope.provider };
  }
  if (scope.scopeKind === 'pad') {
    return { ruleType: 'pad', ruleValue: scope.padKey };
  }
  if (scope.scopeKind === 'rocket') {
    return { ruleType: 'rocket', ruleValue: scope.rocketId ? `ll2:${scope.rocketId}` : scope.scopeKey };
  }
  if (scope.scopeKind === 'launch_site') {
    return { ruleType: 'launch_site', ruleValue: scope.launchSite };
  }
  if (scope.scopeKind === 'state') {
    return { ruleType: 'state', ruleValue: scope.state };
  }
  if (scope.scopeKind === 'tier') {
    return { ruleType: 'tier', ruleValue: scope.tier };
  }
  return null;
}

async function requireOwnedPreset(admin: AdminClient, userId: string, presetId: string) {
  const { data, error } = await admin.from('launch_filter_presets').select('id, name').eq('id', presetId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new MobilePushRouteError(404, 'preset_not_found');
  }
  return data;
}

async function requireOwnedFollow(admin: AdminClient, userId: string, followRuleType: string, followRuleValue: string) {
  const owner: NotificationOwner = { ownerKind: 'user', userId };
  const scope = normalizeWatchScope(followRuleType as any, followRuleValue);
  if (!scope) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }
  const data = await loadUnifiedRuleByScope(admin, owner, scope);
  if (data?.intent === 'follow') {
    return data;
  }

  const { data: watchlists, error: watchlistsError } = await admin.from('watchlists').select('id').eq('user_id', userId);
  if (watchlistsError) throw watchlistsError;
  const watchlistIds = (watchlists ?? []).map((entry) => entry.id).filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!watchlistIds.length) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }

  const legacy = normalizeWatchlistRule(followRuleType, followRuleValue);
  if (!legacy) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }

  const { data: legacyData, error } = await admin
    .from('watchlist_rules')
    .select('id')
    .eq('rule_type', legacy.ruleType)
    .eq('rule_value', legacy.ruleValue)
    .in('watchlist_id', watchlistIds)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!legacyData) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }
  return legacyData;
}

function normalizeScopeSettings(
  payload: ReturnType<typeof mobilePushRuleUpsertSchemaV1.parse>,
  access: MobilePushAccess,
  scopeKind: string
) {
  const timezone = normalizeText(payload.timezone) ?? 'UTC';
  const prelaunchOffsetsMinutes = normalizeOffsets(payload.prelaunchOffsetsMinutes);
  const dailyDigestLocalTime = normalizeLocalTime(payload.dailyDigestLocalTime);
  const statusChangeTypes = normalizeStatusChangeTypes(payload.statusChangeTypes);
  const notifyNetChange = payload.notifyNetChanges === true;

  const allowedOffsets = access.advancedAllowed ? PREMIUM_PRELAUNCH_OPTIONS : BASIC_PRELAUNCH_OPTIONS;
  if (prelaunchOffsetsMinutes.some((value) => !allowedOffsets.has(value))) {
    throw new MobilePushRouteError(400, 'invalid_prelaunch_offset');
  }
  if (prelaunchOffsetsMinutes.length > access.maxPrelaunchOffsets) {
    throw new MobilePushRouteError(402, 'payment_required');
  }
  if (!access.advancedAllowed) {
    if (scopeKind === 'launch') {
      if (prelaunchOffsetsMinutes.length < 1 || prelaunchOffsetsMinutes.length > BASIC_MAX_PRELAUNCH_OFFSETS) {
        throw new MobilePushRouteError(402, 'payment_required');
      }
    } else if (prelaunchOffsetsMinutes.length !== 1) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
  }
  if (dailyDigestLocalTime && (!access.advancedAllowed || scopeKind === 'launch')) {
    throw new MobilePushRouteError(access.advancedAllowed ? 400 : 402, access.advancedAllowed ? 'invalid_scope' : 'payment_required');
  }
  if (statusChangeTypes.length > 0 && !access.advancedAllowed) {
    throw new MobilePushRouteError(402, 'payment_required');
  }
  if (notifyNetChange && !access.advancedAllowed) {
    throw new MobilePushRouteError(402, 'payment_required');
  }
  if (!prelaunchOffsetsMinutes.length && !dailyDigestLocalTime && statusChangeTypes.length === 0 && !notifyNetChange) {
    throw new MobilePushRouteError(400, 'missing_delivery_config');
  }

  return {
    timezone,
    prelaunch_offsets_minutes: prelaunchOffsetsMinutes,
    daily_digest_local_time: dailyDigestLocalTime,
    status_change_types: statusChangeTypes,
    notify_net_change: notifyNetChange
  };
}

function buildMobilePushAccess({
  ownerKind,
  advancedAllowed
}: {
  ownerKind: 'guest' | 'user';
  advancedAllowed: boolean;
}) {
  return mobilePushAccessSchemaV1.parse({
    ownerKind,
    basicAllowed: true,
    advancedAllowed,
    maxPrelaunchOffsets: advancedAllowed ? PREMIUM_MAX_PRELAUNCH_OFFSETS : BASIC_MAX_PRELAUNCH_OFFSETS,
    canUseDailyDigest: advancedAllowed,
    canUseStatusChangeTypes: advancedAllowed,
    canUseNetChangeAlerts: advancedAllowed
  });
}

async function upsertRule(
  admin: AdminClient,
  principal: MobilePushPrincipal,
  payload: ReturnType<typeof mobilePushRuleUpsertSchemaV1.parse>,
  launchIdOverride: string | null = null
) {
  if (principal.ownerKind !== 'user') {
    const allowedGuestScopes = new Set(['all_us', 'launch']);
    const effectiveScope = launchIdOverride ? 'launch' : payload.scopeKind;
    if (!allowedGuestScopes.has(effectiveScope)) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
  }

  await requireActiveDevice(admin, principal);
  await pruneGuestBasicRules(admin, principal, { preferredLaunchId: launchIdOverride });

  const scopeKind = launchIdOverride ? 'launch' : payload.scopeKind;
  if (!launchIdOverride && scopeKind === 'launch') {
    throw new MobilePushRouteError(400, 'invalid_scope');
  }

  const settings = normalizeScopeSettings(payload, principal.access, scopeKind);
  const scopeInput: {
    intent: 'notifications_only';
    scopeKind:
      | 'all_us'
      | 'all_launches'
      | 'launch'
      | 'state'
      | 'provider'
      | 'rocket'
      | 'pad'
      | 'launch_site'
      | 'preset'
      | 'tier';
    launchId?: string;
    state?: string;
    provider?: string;
    rocketId?: number;
    padKey?: string;
    launchSite?: string;
    presetId?: string;
    tier?: string;
    timezone: string;
    prelaunchOffsetsMinutes: number[];
    dailyDigestLocalTime: string | null;
    statusChangeTypes: string[];
    notifyNetChanges: boolean;
  } = {
    intent: 'notifications_only',
    scopeKind: scopeKind === 'follow' ? 'provider' : scopeKind,
    timezone: settings.timezone,
    prelaunchOffsetsMinutes: settings.prelaunch_offsets_minutes,
    dailyDigestLocalTime: settings.daily_digest_local_time,
    statusChangeTypes: settings.status_change_types,
    notifyNetChanges: settings.notify_net_change
  };

  if (scopeKind === 'state') {
    const normalizedState = normalizeText((payload as { state?: string }).state);
    if (!normalizedState) {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
    scopeInput.scopeKind = 'state';
    scopeInput.state = normalizedState;
  } else if (scopeKind === 'launch') {
    if (!launchIdOverride) {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
    scopeInput.scopeKind = 'launch';
    scopeInput.launchId = launchIdOverride;
  } else if (scopeKind === 'preset') {
    if (principal.ownerKind !== 'user' || !principal.userId) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
    await requireOwnedPreset(admin, principal.userId, (payload as { presetId: string }).presetId);
    scopeInput.scopeKind = 'preset';
    scopeInput.presetId = (payload as { presetId: string }).presetId;
  } else if (scopeKind === 'follow') {
    if (principal.ownerKind !== 'user' || !principal.userId) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
    const normalized = normalizeWatchlistRule((payload as { followRuleType: string }).followRuleType, (payload as { followRuleValue: string }).followRuleValue);
    if (!normalized) {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
    await requireOwnedFollow(admin, principal.userId, normalized.ruleType, normalized.ruleValue);
    const scope = normalizeWatchScope(normalized.ruleType as any, normalized.ruleValue);
    if (!scope) {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
    if (scope.scopeKind === 'provider') {
      scopeInput.scopeKind = 'provider';
      scopeInput.provider = scope.provider;
    } else if (scope.scopeKind === 'rocket') {
      if (typeof scope.rocketId !== 'number') {
        throw new MobilePushRouteError(400, 'invalid_scope');
      }
      scopeInput.scopeKind = 'rocket';
      scopeInput.rocketId = scope.rocketId;
    } else if (scope.scopeKind === 'pad') {
      scopeInput.scopeKind = 'pad';
      scopeInput.padKey = scope.padKey;
    } else if (scope.scopeKind === 'launch_site') {
      scopeInput.scopeKind = 'launch_site';
      scopeInput.launchSite = scope.launchSite;
    } else if (scope.scopeKind === 'tier') {
      scopeInput.scopeKind = 'tier';
      scopeInput.tier = scope.tier;
    } else if (scope.scopeKind === 'launch') {
      scopeInput.scopeKind = 'launch';
      scopeInput.launchId = scope.launchId;
    } else if (scope.scopeKind === 'state') {
      scopeInput.scopeKind = 'state';
      scopeInput.state = scope.state;
    } else {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
  } else if (scopeKind === 'all_launches' && principal.ownerKind !== 'user') {
    throw new MobilePushRouteError(402, 'payment_required');
  }

  const scope = normalizeNotificationScopeInput(scopeInput as any);
  if (!scope) {
    throw new MobilePushRouteError(400, 'invalid_scope');
  }

  const owner = toNotificationOwner(principal);
  const existing = await loadUnifiedRuleByScope(admin, owner, scope);
  if (!existing && principal.ownerKind !== 'user' && (scope.scopeKind === 'launch' || scope.scopeKind === 'all_us')) {
    const count = await countUnifiedRulesByScopeKind(admin, owner, [scope.scopeKind]);
    if (count >= GUEST_SCOPE_LIMITS[scope.scopeKind]) {
      throw new MobilePushRouteError(409, 'limit_reached');
    }
  }

  const data = (await upsertUnifiedRule(admin, {
    ...owner,
    intent: 'notifications_only',
    visibleInFollowing: false,
    enabled: true,
    channels: ['push'],
    scope,
    settings: {
      timezone: settings.timezone,
      prelaunchOffsetsMinutes: settings.prelaunch_offsets_minutes,
      dailyDigestLocalTime: settings.daily_digest_local_time,
      statusChangeTypes: settings.status_change_types,
      notifyNetChanges: settings.notify_net_change
    }
  })) as RuleRow;

  return {
    rule: mapRule(data),
    source: existing ? ('updated' as const) : ('created' as const)
  };
}

export async function registerMobilePushDevicePayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const payload = mobilePushDeviceRegisterSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  const now = new Date().toISOString();

  await deactivateConflictingDevices(admin, {
    ownerKind: principal.ownerKind,
    userId: principal.userId,
    installationId: payload.installationId,
    platform: payload.platform,
    now
  });

  if (principal.ownerKind === 'guest') {
    const existing = await loadCurrentDevice(admin, principal);
    let deviceSecret = principal.deviceSecret;
    if (existing) {
      if (!secretsMatch(existing.device_secret_hash, principal.deviceSecret)) {
        throw new MobilePushRouteError(401, 'invalid_guest_device');
      }
      const data = (await upsertUnifiedPushDestination(
        admin,
        {
          ownerKind: 'guest',
          installationId: principal.installationId,
          deviceSecretHash: existing.device_secret_hash ?? null
        },
        {
          platform: payload.platform,
          deliveryKind: 'mobile_push',
          pushProvider: 'expo',
          destinationKey: `expo:${payload.platform}:${payload.installationId}`,
          token: payload.token,
          appVersion: payload.appVersion ?? null,
          deviceName: payload.deviceName ?? null,
          isActive: true,
          verified: true
        }
      )) as DeviceRow;
      return mapDevice(data, principal, null);
    }

    deviceSecret = createDeviceSecret();
    const data = (await upsertUnifiedPushDestination(
      admin,
      {
        ownerKind: 'guest',
        installationId: principal.installationId,
        deviceSecretHash: hashDeviceSecret(deviceSecret)
      },
      {
        platform: payload.platform,
        deliveryKind: 'mobile_push',
        pushProvider: 'expo',
        destinationKey: `expo:${payload.platform}:${payload.installationId}`,
        token: payload.token,
        appVersion: payload.appVersion ?? null,
        deviceName: payload.deviceName ?? null,
        isActive: true,
        verified: true
      }
    )) as DeviceRow;
    return mapDevice(data, principal, deviceSecret);
  }

  const data = (await upsertUnifiedPushDestination(
    admin,
    toNotificationOwner(principal),
    {
      platform: payload.platform,
      deliveryKind: 'mobile_push',
      pushProvider: 'expo',
      destinationKey: `expo:${payload.platform}:${payload.installationId}`,
      token: payload.token,
      appVersion: payload.appVersion ?? null,
      deviceName: payload.deviceName ?? null,
      isActive: true,
      verified: true
    }
  )) as DeviceRow;
  if (principal.userId) {
    await copyGuestBasicRulesToUser(admin, payload.installationId, principal.userId, now);
  }
  return mapDevice(data, principal, null);
}

export async function removeMobilePushDevicePayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const payload = mobilePushDeviceRemoveSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  const existing = principal.ownerKind === 'guest' ? await requireAuthorizedGuestDevice(admin, principal.installationId, principal.deviceSecret) : await loadCurrentDevice(admin, principal);

  if (!existing) {
    return buildEmptyDevice(principal);
  }

  await deactivatePushDestinations(admin, toNotificationOwner(principal), {
    installationId: principal.installationId,
    platform: payload.platform,
    reason: 'device_removed'
  });
  const data = (await loadCurrentDevice(admin, principal)) as DeviceRow | null;
  return mapDevice(data, principal, null);
}

export async function loadMobilePushRulesPayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const url = new URL(request.url);
  const context = mobilePushGuestContextSchemaV1.parse({
    installationId: url.searchParams.get('installationId'),
    deviceSecret: url.searchParams.get('deviceSecret') ?? undefined
  });
  const principal = await resolvePrincipal(session, context);
  await verifyGuestReadAccessIfNeeded(admin, principal);

  const [device, rules] = await Promise.all([loadCurrentDevice(admin, principal), loadRules(admin, principal)]);
  return mobilePushRulesEnvelopeSchemaV1.parse({
    access: principal.access,
    device: mapDevice(device, principal, null),
    rules: rules.map((row) => mapRule(row))
  });
}

export async function upsertMobilePushRulePayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const payload = mobilePushRuleUpsertSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  const { rule, source } = await upsertRule(admin, principal, payload, null);
  const device = await loadCurrentDevice(admin, principal);
  return mobilePushRuleEnvelopeSchemaV1.parse({
    access: principal.access,
    device: mapDevice(device, principal, null),
    rule,
    source
  });
}

export async function deleteMobilePushRulePayload(session: ResolvedViewerSession, ruleId: string, request: Request) {
  const admin = getAdminClient();
  const normalizedRuleId = normalizeText(ruleId);
  if (!normalizedRuleId) {
    throw new MobilePushRouteError(400, 'invalid_rule_id');
  }
  const url = new URL(request.url);
  const context = mobilePushGuestContextSchemaV1.parse({
    installationId: url.searchParams.get('installationId'),
    deviceSecret: url.searchParams.get('deviceSecret') ?? undefined
  });
  const principal = await resolvePrincipal(session, context);
  if (principal.ownerKind === 'guest') {
    await requireAuthorizedGuestDevice(admin, principal.installationId, principal.deviceSecret, false);
  }

  const owner = toNotificationOwner(principal);
  const existing = await loadUnifiedRuleById(admin, owner, normalizedRuleId);
  if (!existing) {
    throw new MobilePushRouteError(404, 'not_found');
  }
  await removeChannelsFromUnifiedRule(admin, owner, ruleScopeFromRow(existing as RuleRow), ['push']);
  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadMobilePushLaunchPreferencePayload(session: ResolvedViewerSession, launchIdParam: string, request: Request) {
  const admin = getAdminClient();
  const parsedLaunch = parseLaunchParam(launchIdParam);
  if (!parsedLaunch) {
    throw new MobilePushRouteError(400, 'invalid_launch_id');
  }
  const url = new URL(request.url);
  const context = mobilePushGuestContextSchemaV1.parse({
    installationId: url.searchParams.get('installationId'),
    deviceSecret: url.searchParams.get('deviceSecret') ?? undefined
  });
  const principal = await resolvePrincipal(session, context);
  await verifyGuestReadAccessIfNeeded(admin, principal);

  const [device, rule] = await Promise.all([loadCurrentDevice(admin, principal), loadLaunchRule(admin, principal, parsedLaunch.launchId)]);
  return mobilePushLaunchPreferenceEnvelopeSchemaV1.parse({
    access: principal.access,
    device: mapDevice(device, principal, null),
    rule: rule ? mapRule(rule) : null
  });
}

export async function upsertMobilePushLaunchPreferencePayload(session: ResolvedViewerSession, launchIdParam: string, request: Request) {
  const admin = getAdminClient();
  const parsedLaunch = parseLaunchParam(launchIdParam);
  if (!parsedLaunch) {
    throw new MobilePushRouteError(400, 'invalid_launch_id');
  }
  const payload = mobilePushRuleUpsertSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  const launchPayload = {
    ...payload,
    scopeKind: 'launch' as const
  };
  const { rule, source } = await upsertRule(admin, principal, launchPayload, parsedLaunch.launchId);
  const device = await loadCurrentDevice(admin, principal);
  return mobilePushRuleEnvelopeSchemaV1.parse({
    access: principal.access,
    device: mapDevice(device, principal, null),
    rule,
    source
  });
}

export async function enqueueMobilePushTestPayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const payload = mobilePushTestRequestSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  await requireActiveDevice(admin, principal);

  const queuedAt = new Date().toISOString();
  const { error } = await admin.from('notifications_outbox').insert({
    owner_kind: principal.ownerKind,
    owner_key: ownerKeyFor(toNotificationOwner(principal)),
    user_id: principal.ownerKind === 'user' ? principal.userId : null,
    installation_id: principal.ownerKind === 'guest' ? principal.installationId : null,
    push_destination_id: null,
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
  if (error) throw error;

  return mobilePushTestSchemaV1.parse({
    ok: true,
    queuedAt
  });
}
