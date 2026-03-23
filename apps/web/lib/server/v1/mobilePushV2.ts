import { createHash, randomBytes, timingSafeEqual } from 'crypto';
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

type DeviceRow = {
  id: string;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id: string;
  platform?: 'ios' | 'android' | null;
  push_provider?: 'expo' | null;
  token?: string | null;
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
  scope_kind: 'all_us' | 'state' | 'launch' | 'all_launches' | 'preset' | 'follow';
  state?: string | null;
  launch_id?: string | null;
  filter_preset_id?: string | null;
  follow_rule_type?: 'launch' | 'pad' | 'provider' | 'tier' | null;
  follow_rule_value?: string | null;
  timezone?: string | null;
  prelaunch_offsets_minutes?: number[] | null;
  daily_digest_local_time?: string | null;
  status_change_types?: string[] | null;
  notify_net_change?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  launches?: { name?: string | null } | { name?: string | null }[] | null;
  launch_filter_presets?: { name?: string | null } | { name?: string | null }[] | null;
};

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

const BASIC_PRELAUNCH_OPTIONS = new Set([10, 30, 60, 120]);
const PREMIUM_PRELAUNCH_OPTIONS = new Set([10, 30, 60, 120, 360, 720, 1440]);
const STATUS_CHANGE_OPTIONS = new Set(['any', 'go', 'hold', 'scrubbed', 'tbd']);

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

function hashDeviceSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function createDeviceSecret() {
  return randomBytes(32).toString('hex');
}

function secretsMatch(expectedHash: string | null | undefined, providedSecret: string | null | undefined) {
  if (!expectedHash || !providedSecret) return false;
  const providedHash = hashDeviceSecret(providedSecret);
  const left = Buffer.from(expectedHash, 'hex');
  const right = Buffer.from(providedHash, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function formatFollowLabel(ruleType: string | null | undefined, ruleValue: string | null | undefined) {
  const type = String(ruleType || '').trim();
  const value = String(ruleValue || '').trim();
  if (!type || !value) return 'Follow';
  if (type === 'provider') return `Followed provider: ${value}`;
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
    return mobilePushAccessSchemaV1.parse({
      ownerKind: 'guest',
      basicAllowed: true,
      advancedAllowed: false,
      maxPrelaunchOffsets: 1,
      canUseDailyDigest: false,
      canUseStatusChangeTypes: false,
      canUseNetChangeAlerts: false
    });
  }

  const { entitlement } = await getViewerEntitlement({
    session,
    reconcileStripe: false
  });
  const advancedAllowed = entitlement.isPaid || entitlement.isAdmin;

  return mobilePushAccessSchemaV1.parse({
    ownerKind: advancedAllowed ? 'user' : 'guest',
    basicAllowed: true,
    advancedAllowed,
    maxPrelaunchOffsets: advancedAllowed ? 3 : 1,
    canUseDailyDigest: advancedAllowed,
    canUseStatusChangeTypes: advancedAllowed,
    canUseNetChangeAlerts: advancedAllowed
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

  return mobilePushRuleSchemaV1.parse({
    ...base,
    scopeKind: 'follow',
    followRuleType: row.follow_rule_type,
    followRuleValue: row.follow_rule_value
  });
}

function buildRuleLabel(row: RuleRow) {
  if (row.scope_kind === 'all_us') return 'All U.S. launches';
  if (row.scope_kind === 'state') return normalizeText(row.state) ?? 'State';
  if (row.scope_kind === 'launch') return firstJoinedName(row.launches) ?? 'Launch alert';
  if (row.scope_kind === 'all_launches') return 'All launches';
  if (row.scope_kind === 'preset') return firstJoinedName(row.launch_filter_presets) ?? 'Saved filter';
  return formatFollowLabel(row.follow_rule_type, row.follow_rule_value);
}

async function loadCurrentDevice(admin: AdminClient, principal: MobilePushPrincipal) {
  const query = admin
    .from('mobile_push_installations_v2')
    .select(
      'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .eq('installation_id', principal.installationId)
    .order('updated_at', { ascending: false })
    .limit(1);

  const scoped = principal.ownerKind === 'user' ? query.eq('owner_kind', 'user').eq('user_id', principal.userId) : query.eq('owner_kind', 'guest');
  const { data, error } = await scoped.maybeSingle();
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
      .from('mobile_push_installations_v2')
      .update(payload)
      .eq('owner_kind', 'user')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('is_active', true);
    if (error) throw error;
    return;
  }

  const [{ error: guestError }, { error: otherUserError }] = await Promise.all([
    admin
      .from('mobile_push_installations_v2')
      .update(payload)
      .eq('owner_kind', 'guest')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('is_active', true),
    admin
      .from('mobile_push_installations_v2')
      .update(payload)
      .eq('owner_kind', 'user')
      .eq('installation_id', installationId)
      .eq('platform', platform)
      .eq('is_active', true)
      .neq('user_id', userId ?? '')
  ]);
  if (guestError) throw guestError;
  if (otherUserError) throw otherUserError;
}

async function copyGuestBasicRulesToUser(admin: AdminClient, installationId: string, userId: string, now: string) {
  const { data, error } = await admin
    .from('mobile_push_rules_v2')
    .select('scope_kind, state, launch_id, timezone, prelaunch_offsets_minutes')
    .eq('owner_kind', 'guest')
    .eq('installation_id', installationId)
    .in('scope_kind', ['all_us', 'state', 'launch']);
  if (error) throw error;

  for (const row of (data || []) as Array<Pick<RuleRow, 'scope_kind' | 'state' | 'launch_id' | 'timezone' | 'prelaunch_offsets_minutes'>>) {
    const scopeKind = row.scope_kind;
    const state = scopeKind === 'state' ? normalizeText(row.state) : null;
    const launchId = scopeKind === 'launch' ? normalizeText(row.launch_id) : null;

    let query = admin.from('mobile_push_rules_v2').select('id').eq('owner_kind', 'user').eq('user_id', userId).eq('scope_kind', scopeKind).limit(1);
    if (scopeKind === 'state') {
      query = query.eq('state', state);
    } else if (scopeKind === 'launch') {
      query = query.eq('launch_id', launchId);
    }

    const { data: existing, error: existingError } = await query.maybeSingle();
    if (existingError) throw existingError;
    if (existing) continue;

    const offsets = normalizeOffsets(row.prelaunch_offsets_minutes).slice(0, 1);
    const { error: insertError } = await admin.from('mobile_push_rules_v2').insert({
      owner_kind: 'user',
      user_id: userId,
      installation_id: null,
      scope_kind: scopeKind,
      state,
      launch_id: launchId,
      filter_preset_id: null,
      follow_rule_type: null,
      follow_rule_value: null,
      timezone: normalizeText(row.timezone) ?? 'UTC',
      prelaunch_offsets_minutes: offsets.length ? offsets : [60],
      daily_digest_local_time: null,
      status_change_types: [],
      notify_net_change: false,
      enabled: true,
      created_at: now,
      updated_at: now
    });
    if (insertError) throw insertError;
  }
}

async function requireAuthorizedGuestDevice(admin: AdminClient, installationId: string, deviceSecret: string | null, activeOnly = false) {
  const { data, error } = await admin
    .from('mobile_push_installations_v2')
    .select(
      'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .eq('owner_kind', 'guest')
    .eq('installation_id', installationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = (data as DeviceRow | null) ?? null;
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

async function loadRules(admin: AdminClient, principal: MobilePushPrincipal) {
  const query = admin
    .from('mobile_push_rules_v2')
    .select(
      'id, owner_kind, user_id, installation_id, scope_kind, state, launch_id, filter_preset_id, follow_rule_type, follow_rule_value, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, created_at, updated_at, launches(name), launch_filter_presets(name)'
    )
    .order('updated_at', { ascending: false });

  const scoped = principal.ownerKind === 'user' ? query.eq('owner_kind', 'user').eq('user_id', principal.userId) : query.eq('owner_kind', 'guest').eq('installation_id', principal.installationId);
  const { data, error } = await scoped;
  if (error) throw error;
  return (data ?? []) as RuleRow[];
}

async function loadLaunchRule(admin: AdminClient, principal: MobilePushPrincipal, launchId: string) {
  const query = admin
    .from('mobile_push_rules_v2')
    .select(
      'id, owner_kind, user_id, installation_id, scope_kind, state, launch_id, filter_preset_id, follow_rule_type, follow_rule_value, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, created_at, updated_at, launches(name), launch_filter_presets(name)'
    )
    .eq('scope_kind', 'launch')
    .eq('launch_id', launchId)
    .limit(1);
  const scoped = principal.ownerKind === 'user' ? query.eq('owner_kind', 'user').eq('user_id', principal.userId) : query.eq('owner_kind', 'guest').eq('installation_id', principal.installationId);
  const { data, error } = await scoped.maybeSingle();
  if (error) throw error;
  return (data as RuleRow | null) ?? null;
}

function normalizeWatchlistRule(ruleType: string, ruleValue: string) {
  const trimmed = String(ruleValue || '').trim();
  if (!trimmed) return null;

  if (ruleType === 'launch') {
    const parsed = parseLaunchParam(trimmed);
    if (!parsed) return null;
    return { ruleType: 'launch', ruleValue: parsed.launchId };
  }

  if (ruleType === 'pad') {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('ll2:')) {
      const rest = trimmed.slice(4).trim();
      if (!/^\d{1,10}$/.test(rest)) return null;
      return { ruleType: 'pad', ruleValue: `ll2:${String(Number(rest))}` };
    }
    if (lower.startsWith('code:')) {
      const rest = trimmed.slice(5).trim();
      if (!rest) return null;
      return { ruleType: 'pad', ruleValue: `code:${rest}` };
    }
    if (/^\d{1,10}$/.test(trimmed)) {
      return { ruleType: 'pad', ruleValue: `ll2:${String(Number(trimmed))}` };
    }
    return { ruleType: 'pad', ruleValue: `code:${trimmed}` };
  }

  if (ruleType === 'tier') {
    const normalized = trimmed.toLowerCase();
    if (!['major', 'notable', 'routine'].includes(normalized)) return null;
    return { ruleType: 'tier', ruleValue: normalized };
  }

  return { ruleType: 'provider', ruleValue: trimmed };
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
  const { data: watchlists, error: watchlistsError } = await admin.from('watchlists').select('id').eq('user_id', userId);
  if (watchlistsError) throw watchlistsError;
  const watchlistIds = (watchlists ?? []).map((entry) => entry.id).filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!watchlistIds.length) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }

  const { data, error } = await admin
    .from('watchlist_rules')
    .select('id')
    .eq('rule_type', followRuleType)
    .eq('rule_value', followRuleValue)
    .in('watchlist_id', watchlistIds)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new MobilePushRouteError(404, 'follow_not_found');
  }
  return data;
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
  if (!access.advancedAllowed && prelaunchOffsetsMinutes.length !== 1) {
    throw new MobilePushRouteError(402, 'payment_required');
  }
  if (prelaunchOffsetsMinutes.length > access.maxPrelaunchOffsets) {
    throw new MobilePushRouteError(402, 'payment_required');
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

function applyRuleScopeQuery<T extends { eq: (...args: any[]) => any }>(
  query: T,
  principal: MobilePushPrincipal,
  scope: {
    scopeKind: 'all_us' | 'state' | 'launch' | 'all_launches' | 'preset' | 'follow';
    state?: string | null;
    launchId?: string | null;
    presetId?: string | null;
    followRuleType?: string | null;
    followRuleValue?: string | null;
  }
) {
  let scoped: any =
    principal.ownerKind === 'user'
      ? query.eq('owner_kind', 'user').eq('user_id', principal.userId)
      : query.eq('owner_kind', 'guest').eq('installation_id', principal.installationId);
  scoped = scoped.eq('scope_kind', scope.scopeKind);
  if (scope.scopeKind === 'state') {
    scoped = scoped.eq('state', scope.state);
  } else if (scope.scopeKind === 'launch') {
    scoped = scoped.eq('launch_id', scope.launchId);
  } else if (scope.scopeKind === 'preset') {
    scoped = scoped.eq('filter_preset_id', scope.presetId);
  } else if (scope.scopeKind === 'follow') {
    scoped = scoped.eq('follow_rule_type', scope.followRuleType).eq('follow_rule_value', scope.followRuleValue);
  }
  return scoped;
}

async function upsertRule(
  admin: AdminClient,
  principal: MobilePushPrincipal,
  payload: ReturnType<typeof mobilePushRuleUpsertSchemaV1.parse>,
  launchIdOverride: string | null = null
) {
  if (principal.ownerKind !== 'user') {
    const allowedGuestScopes = new Set(['all_us', 'state', 'launch']);
    const effectiveScope = launchIdOverride ? 'launch' : payload.scopeKind;
    if (!allowedGuestScopes.has(effectiveScope)) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
  }

  await requireActiveDevice(admin, principal);

  const scopeKind = launchIdOverride ? 'launch' : payload.scopeKind;
  if (!launchIdOverride && scopeKind === 'launch') {
    throw new MobilePushRouteError(400, 'invalid_scope');
  }
  const normalizedState = scopeKind === 'state' ? normalizeText((payload as { state?: string }).state) : null;
  const launchId = launchIdOverride;
  const settings = normalizeScopeSettings(payload, principal.access, scopeKind);
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    owner_kind: principal.ownerKind,
    user_id: principal.ownerKind === 'user' ? principal.userId : null,
    installation_id: principal.ownerKind === 'guest' ? principal.installationId : null,
    scope_kind: scopeKind,
    state: normalizedState,
    launch_id: launchId,
    filter_preset_id: null,
    follow_rule_type: null,
    follow_rule_value: null,
    timezone: settings.timezone,
    prelaunch_offsets_minutes: settings.prelaunch_offsets_minutes,
    daily_digest_local_time: settings.daily_digest_local_time,
    status_change_types: settings.status_change_types,
    notify_net_change: settings.notify_net_change,
    enabled: true,
    updated_at: now
  };

  if (scopeKind === 'preset') {
    if (principal.ownerKind !== 'user' || !principal.userId) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
    await requireOwnedPreset(admin, principal.userId, (payload as { presetId: string }).presetId);
    row.filter_preset_id = (payload as { presetId: string }).presetId;
  } else if (scopeKind === 'follow') {
    if (principal.ownerKind !== 'user' || !principal.userId) {
      throw new MobilePushRouteError(402, 'payment_required');
    }
    const normalized = normalizeWatchlistRule((payload as { followRuleType: string }).followRuleType, (payload as { followRuleValue: string }).followRuleValue);
    if (!normalized) {
      throw new MobilePushRouteError(400, 'invalid_scope');
    }
    await requireOwnedFollow(admin, principal.userId, normalized.ruleType, normalized.ruleValue);
    row.follow_rule_type = normalized.ruleType;
    row.follow_rule_value = normalized.ruleValue;
  } else if (scopeKind === 'all_launches' && principal.ownerKind !== 'user') {
    throw new MobilePushRouteError(402, 'payment_required');
  }

  const scopeQuery = applyRuleScopeQuery(
    admin
      .from('mobile_push_rules_v2')
      .select(
        'id, owner_kind, user_id, installation_id, scope_kind, state, launch_id, filter_preset_id, follow_rule_type, follow_rule_value, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, created_at, updated_at, launches(name), launch_filter_presets(name)'
      )
      .limit(1),
    principal,
    {
      scopeKind,
      state: normalizedState,
      launchId,
      presetId: row.filter_preset_id as string | null,
      followRuleType: row.follow_rule_type as string | null,
      followRuleValue: row.follow_rule_value as string | null
    }
  );

  const { data: existing, error: existingError } = await scopeQuery.maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { data, error } = await admin
      .from('mobile_push_rules_v2')
      .update(row)
      .eq('id', existing.id)
      .select(
        'id, owner_kind, user_id, installation_id, scope_kind, state, launch_id, filter_preset_id, follow_rule_type, follow_rule_value, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, created_at, updated_at, launches(name), launch_filter_presets(name)'
      )
      .single();
    if (error) throw error;
    return {
      rule: mapRule(data as RuleRow),
      source: 'updated' as const
    };
  }

  const { data, error } = await admin
    .from('mobile_push_rules_v2')
    .insert({
      ...row,
      created_at: now
    })
    .select(
      'id, owner_kind, user_id, installation_id, scope_kind, state, launch_id, filter_preset_id, follow_rule_type, follow_rule_value, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, created_at, updated_at, launches(name), launch_filter_presets(name)'
    )
    .single();
  if (error) throw error;
  return {
    rule: mapRule(data as RuleRow),
    source: 'created' as const
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
      const { data, error } = await admin
        .from('mobile_push_installations_v2')
        .update({
          token: payload.token,
          push_provider: payload.pushProvider ?? 'expo',
          app_version: payload.appVersion ?? null,
          device_name: payload.deviceName ?? null,
          is_active: true,
          disabled_at: null,
          last_failure_reason: null,
          last_registered_at: now,
          updated_at: now
        })
        .eq('id', existing.id)
        .select(
          'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
        )
        .single();
      if (error) throw error;
      return mapDevice(data as DeviceRow, principal, null);
    }

    deviceSecret = createDeviceSecret();
    const { data, error } = await admin
      .from('mobile_push_installations_v2')
      .insert({
        owner_kind: 'guest',
        user_id: null,
        installation_id: payload.installationId,
        platform: payload.platform,
        push_provider: payload.pushProvider ?? 'expo',
        token: payload.token,
        app_version: payload.appVersion ?? null,
        device_name: payload.deviceName ?? null,
        device_secret_hash: hashDeviceSecret(deviceSecret),
        is_active: true,
        disabled_at: null,
        last_failure_reason: null,
        last_registered_at: now,
        created_at: now,
        updated_at: now
      })
      .select(
        'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
      )
      .single();
    if (error) throw error;
    return mapDevice(data as DeviceRow, principal, deviceSecret);
  }

  const existing = await loadCurrentDevice(admin, principal);
  if (existing) {
    const { data, error } = await admin
      .from('mobile_push_installations_v2')
      .update({
        token: payload.token,
        push_provider: payload.pushProvider ?? 'expo',
        app_version: payload.appVersion ?? null,
        device_name: payload.deviceName ?? null,
        is_active: true,
        disabled_at: null,
        last_failure_reason: null,
        last_registered_at: now,
        updated_at: now
      })
      .eq('id', existing.id)
      .select(
        'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
        )
        .single();
    if (error) throw error;
    if (principal.userId) {
      await copyGuestBasicRulesToUser(admin, payload.installationId, principal.userId, now);
    }
    return mapDevice(data as DeviceRow, principal, null);
  }

  const { data, error } = await admin
    .from('mobile_push_installations_v2')
    .insert({
      owner_kind: 'user',
      user_id: principal.userId,
      installation_id: payload.installationId,
      platform: payload.platform,
      push_provider: payload.pushProvider ?? 'expo',
      token: payload.token,
      app_version: payload.appVersion ?? null,
      device_name: payload.deviceName ?? null,
      device_secret_hash: null,
      is_active: true,
      disabled_at: null,
      last_failure_reason: null,
      last_registered_at: now,
      created_at: now,
      updated_at: now
    })
    .select(
      'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .single();
  if (error) throw error;
  if (principal.userId) {
    await copyGuestBasicRulesToUser(admin, payload.installationId, principal.userId, now);
  }
  return mapDevice(data as DeviceRow, principal, null);
}

export async function removeMobilePushDevicePayload(session: ResolvedViewerSession, request: Request) {
  const admin = getAdminClient();
  const payload = mobilePushDeviceRemoveSchemaV1.parse(await request.json().catch(() => undefined));
  const principal = await resolvePrincipal(session, payload);
  const now = new Date().toISOString();
  const existing = principal.ownerKind === 'guest' ? await requireAuthorizedGuestDevice(admin, principal.installationId, principal.deviceSecret) : await loadCurrentDevice(admin, principal);

  if (!existing) {
    return buildEmptyDevice(principal);
  }

  const { data, error } = await admin
    .from('mobile_push_installations_v2')
    .update({
      is_active: false,
      disabled_at: now,
      last_failure_reason: 'device_removed',
      updated_at: now
    })
    .eq('id', existing.id)
    .select(
      'id, owner_kind, user_id, installation_id, platform, push_provider, token, app_version, device_name, device_secret_hash, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .single();
  if (error) throw error;
  return mapDevice(data as DeviceRow, principal, null);
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

  const query = admin.from('mobile_push_rules_v2').delete().eq('id', normalizedRuleId);
  const scoped = principal.ownerKind === 'user' ? query.eq('owner_kind', 'user').eq('user_id', principal.userId) : query.eq('owner_kind', 'guest').eq('installation_id', principal.installationId);
  const { data, error } = await scoped.select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new MobilePushRouteError(404, 'not_found');
  }
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
  const { error } = await admin.from('mobile_push_outbox_v2').insert({
    owner_kind: principal.ownerKind,
    user_id: principal.ownerKind === 'user' ? principal.userId : null,
    installation_id: principal.ownerKind === 'guest' ? principal.installationId : null,
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
