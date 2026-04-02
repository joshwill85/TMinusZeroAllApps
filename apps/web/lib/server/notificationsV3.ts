import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type {
  NotificationDestinationV2,
  NotificationRuleUpsertV2,
  NotificationRuleV2
} from '@tminuszero/contracts';

type DbClient = {
  from: (table: string) => any;
};

type NotificationRuleRow = {
  id: string;
  owner_kind: 'guest' | 'user';
  intent: 'follow' | 'notifications_only';
  visible_in_following?: boolean | null;
  enabled?: boolean | null;
  scope_kind:
    | 'all_us'
    | 'all_launches'
    | 'launch'
    | 'state'
    | 'provider'
    | 'rocket'
    | 'pad'
    | 'launch_site'
    | 'preset'
    | 'filter'
    | 'tier';
  scope_key: string;
  channels?: string[] | null;
  timezone?: string | null;
  prelaunch_offsets_minutes?: number[] | null;
  include_liftoff?: boolean | null;
  daily_digest_local_time?: string | null;
  status_change_types?: string[] | null;
  notify_net_change?: boolean | null;
  launch_id?: string | null;
  state?: string | null;
  provider?: string | null;
  rocket_id?: number | null;
  pad_key?: string | null;
  launch_site?: string | null;
  filter_preset_id?: string | null;
  filters?: Record<string, unknown> | null;
  tier?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type NotificationDestinationRow = {
  id: string;
  owner_kind: 'guest' | 'user';
  platform: 'web' | 'ios' | 'android';
  delivery_kind: 'web_push' | 'mobile_push';
  installation_id?: string | null;
  is_active?: boolean | null;
  verified?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_registered_at?: string | null;
  last_sent_at?: string | null;
  last_receipt_at?: string | null;
  last_failure_reason?: string | null;
  disabled_at?: string | null;
};

export type NotificationOwner =
  | { ownerKind: 'user'; userId: string; installationId?: string | null }
  | { ownerKind: 'guest'; installationId: string; userId?: null };

export type NotificationRuleScope =
  | { scopeKind: 'all_us'; scopeKey: 'us' }
  | { scopeKind: 'all_launches'; scopeKey: 'all' }
  | { scopeKind: 'launch'; scopeKey: string; launchId: string }
  | { scopeKind: 'state'; scopeKey: string; state: string }
  | { scopeKind: 'provider'; scopeKey: string; provider: string }
  | { scopeKind: 'rocket'; scopeKey: string; rocketId?: number | null; rocketLabel?: string | null }
  | { scopeKind: 'pad'; scopeKey: string; padKey: string }
  | { scopeKind: 'launch_site'; scopeKey: string; launchSite: string }
  | { scopeKind: 'preset'; scopeKey: string; presetId: string }
  | { scopeKind: 'filter'; scopeKey: string; filters: Record<string, unknown> }
  | { scopeKind: 'tier'; scopeKey: string; tier: string };

export type NotificationRuleSettingsInput = {
  timezone?: string | null;
  prelaunchOffsetsMinutes?: number[] | null;
  includeLiftoff?: boolean | null;
  dailyDigestLocalTime?: string | null;
  statusChangeTypes?: string[] | null;
  notifyNetChanges?: boolean | null;
};

export type NotificationRuleUpsertInput = NotificationOwner & {
  intent: 'follow' | 'notifications_only';
  visibleInFollowing?: boolean;
  enabled?: boolean;
  channels?: Array<'push' | 'email'>;
  scope: NotificationRuleScope;
  settings?: NotificationRuleSettingsInput;
};

const STATUS_CHANGE_OPTIONS = new Set(['any', 'go', 'hold', 'scrubbed', 'tbd']);

export function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeComparableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase().replace(/\s+/g, ' ') : null;
}

export function normalizeLocalTime(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : null;
}

export function normalizeOffsets(values: unknown, max = 5) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'number' ? Math.trunc(value) : Number.NaN))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  )
    .sort((left, right) => left - right)
    .slice(0, max);
}

export function normalizeStatusChangeTypes(values: unknown) {
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

export function ownerKeyFor(owner: NotificationOwner) {
  return owner.ownerKind === 'user' ? `user:${owner.userId}` : `guest:${owner.installationId}`;
}

export function hashDeviceSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function createDeviceSecret() {
  return randomBytes(32).toString('hex');
}

export function secretsMatch(expectedHash: string | null | undefined, providedSecret: string | null | undefined) {
  if (!expectedHash || !providedSecret) return false;
  const providedHash = hashDeviceSecret(providedSecret);
  const left = Buffer.from(expectedHash, 'hex');
  const right = Buffer.from(providedHash, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeWatchScope(
  ruleType: 'launch' | 'pad' | 'provider' | 'rocket' | 'launch_site' | 'state' | 'tier',
  ruleValue: string
): NotificationRuleScope | null {
  const trimmed = normalizeText(ruleValue);
  if (!trimmed) return null;

  if (ruleType === 'launch') {
    if (!isUuid(trimmed)) return null;
    return {
      scopeKind: 'launch',
      scopeKey: trimmed.toLowerCase(),
      launchId: trimmed.toLowerCase()
    };
  }

  if (ruleType === 'pad') {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('ll2:')) {
      const rest = trimmed.slice(4).trim();
      if (!/^\d{1,10}$/.test(rest)) return null;
      return {
        scopeKind: 'pad',
        scopeKey: `ll2:${String(Number(rest))}`,
        padKey: `ll2:${String(Number(rest))}`
      };
    }
    if (lower.startsWith('code:')) {
      const rest = trimmed.slice(5).trim();
      if (!rest) return null;
      return {
        scopeKind: 'pad',
        scopeKey: `code:${rest}`,
        padKey: `code:${rest}`
      };
    }
    if (/^\d{1,10}$/.test(trimmed)) {
      return {
        scopeKind: 'pad',
        scopeKey: `ll2:${String(Number(trimmed))}`,
        padKey: `ll2:${String(Number(trimmed))}`
      };
    }
    return {
      scopeKind: 'pad',
      scopeKey: `code:${trimmed}`,
      padKey: `code:${trimmed}`
    };
  }

  if (ruleType === 'provider') {
    return {
      scopeKind: 'provider',
      scopeKey: normalizeComparableText(trimmed) ?? trimmed,
      provider: trimmed
    };
  }

  if (ruleType === 'rocket') {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('ll2:')) {
      const rest = trimmed.slice(4).trim();
      if (!/^\d{1,10}$/.test(rest)) return null;
      return {
        scopeKind: 'rocket',
        scopeKey: `ll2:${String(Number(rest))}`,
        rocketId: Number(rest)
      };
    }
    if (/^\d{1,10}$/.test(trimmed)) {
      return {
        scopeKind: 'rocket',
        scopeKey: `ll2:${String(Number(trimmed))}`,
        rocketId: Number(trimmed)
      };
    }
    return {
      scopeKind: 'rocket',
      scopeKey: normalizeComparableText(trimmed) ?? trimmed,
      rocketLabel: trimmed
    };
  }

  if (ruleType === 'launch_site') {
    return {
      scopeKind: 'launch_site',
      scopeKey: normalizeComparableText(trimmed) ?? trimmed,
      launchSite: trimmed
    };
  }

  if (ruleType === 'state') {
    const normalizedState = trimmed.toUpperCase().replace(/\s+/g, ' ');
    return {
      scopeKind: 'state',
      scopeKey: normalizedState.toLowerCase(),
      state: normalizedState
    };
  }

  const normalizedTier = trimmed.toLowerCase();
  if (!['major', 'notable', 'routine'].includes(normalizedTier)) return null;
  return {
    scopeKind: 'tier',
    scopeKey: normalizedTier,
    tier: normalizedTier
  };
}

export function normalizeNotificationScopeInput(input: NotificationRuleUpsertV2): NotificationRuleScope | null {
  switch (input.scopeKind) {
    case 'all_us':
      return { scopeKind: 'all_us', scopeKey: 'us' };
    case 'all_launches':
      return { scopeKind: 'all_launches', scopeKey: 'all' };
    case 'launch':
      return input.launchId
        ? {
            scopeKind: 'launch',
            scopeKey: input.launchId.toLowerCase(),
            launchId: input.launchId.toLowerCase()
          }
        : null;
    case 'state': {
      const state = normalizeText(input.state);
      if (!state) return null;
      const normalizedState = state.toUpperCase().replace(/\s+/g, ' ');
      return {
        scopeKind: 'state',
        scopeKey: normalizedState.toLowerCase(),
        state: normalizedState
      };
    }
    case 'provider': {
      const provider = normalizeText(input.provider);
      if (!provider) return null;
      return {
        scopeKind: 'provider',
        scopeKey: normalizeComparableText(provider) ?? provider,
        provider
      };
    }
    case 'rocket':
      if (typeof input.rocketId === 'number' && Number.isInteger(input.rocketId) && input.rocketId > 0) {
        return {
          scopeKind: 'rocket',
          scopeKey: `ll2:${input.rocketId}`,
          rocketId: input.rocketId
        };
      }
      return null;
    case 'pad': {
      const padKey = normalizeText(input.padKey);
      if (!padKey) return null;
      return normalizeWatchScope('pad', padKey);
    }
    case 'launch_site': {
      const launchSite = normalizeText(input.launchSite);
      if (!launchSite) return null;
      return {
        scopeKind: 'launch_site',
        scopeKey: normalizeComparableText(launchSite) ?? launchSite,
        launchSite
      };
    }
    case 'preset':
      return input.presetId
        ? {
            scopeKind: 'preset',
            scopeKey: input.presetId.toLowerCase(),
            presetId: input.presetId.toLowerCase()
          }
        : null;
    case 'filter':
      return input.filters
        ? {
            scopeKind: 'filter',
            scopeKey: createHash('sha1').update(JSON.stringify(input.filters)).digest('hex'),
            filters: input.filters
          }
        : null;
    case 'tier': {
      const tier = normalizeText(input.tier)?.toLowerCase();
      if (!tier) return null;
      return {
        scopeKind: 'tier',
        scopeKey: tier,
        tier
      };
    }
  }
}

export function buildRuleLabel(scope: NotificationRuleScope) {
  switch (scope.scopeKind) {
    case 'all_us':
      return 'All U.S. launches';
    case 'all_launches':
      return 'All launches';
    case 'launch':
      return 'This launch';
    case 'state':
      return `State launches: ${scope.state}`;
    case 'provider':
      return `Followed provider: ${scope.provider}`;
    case 'rocket':
      return scope.rocketId ? `Followed rocket: LL2 ${scope.rocketId}` : `Followed rocket: ${scope.rocketLabel ?? 'Rocket'}`;
    case 'pad':
      return `Followed pad: ${scope.padKey}`;
    case 'launch_site':
      return `Followed launch site: ${scope.launchSite}`;
    case 'preset':
      return 'Saved filter';
    case 'filter':
      return 'Custom filter';
    case 'tier':
      return `Followed tier: ${scope.tier}`;
  }
}

export function buildFollowScopeLabel(scope: NotificationRuleScope) {
  switch (scope.scopeKind) {
    case 'launch':
      return 'This launch';
    case 'state':
      return `State launches: ${scope.state}`;
    case 'provider':
      return `Followed provider: ${scope.provider}`;
    case 'rocket':
      return scope.rocketId ? `Followed rocket: LL2 ${scope.rocketId}` : `Followed rocket: ${scope.rocketLabel ?? 'Rocket'}`;
    case 'pad':
      return `Followed pad: ${scope.padKey}`;
    case 'launch_site':
      return `Followed launch site: ${scope.launchSite}`;
    case 'tier':
      return `Followed tier: ${scope.tier}`;
    default:
      return buildRuleLabel(scope);
  }
}

function scopeColumns(scope: NotificationRuleScope) {
  return {
    launch_id: scope.scopeKind === 'launch' ? scope.launchId : null,
    state: scope.scopeKind === 'state' ? scope.state : null,
    provider: scope.scopeKind === 'provider' ? scope.provider : null,
    rocket_id: scope.scopeKind === 'rocket' ? scope.rocketId ?? null : null,
    pad_key: scope.scopeKind === 'pad' ? scope.padKey : null,
    launch_site: scope.scopeKind === 'launch_site' ? scope.launchSite : null,
    filter_preset_id: scope.scopeKind === 'preset' ? scope.presetId : null,
    filters: scope.scopeKind === 'filter' ? scope.filters : null,
    tier: scope.scopeKind === 'tier' ? scope.tier : null
  };
}

export async function loadUnifiedRuleByScope(db: DbClient, owner: NotificationOwner, scope: NotificationRuleScope) {
  const { data, error } = await db
    .from('notification_rules_v3')
    .select('*')
    .eq('owner_key', ownerKeyFor(owner))
    .eq('scope_kind', scope.scopeKind)
    .eq('scope_key', scope.scopeKey)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function loadUnifiedRuleById(db: DbClient, owner: NotificationOwner, ruleId: string) {
  const { data, error } = await db
    .from('notification_rules_v3')
    .select('*')
    .eq('owner_key', ownerKeyFor(owner))
    .eq('id', ruleId)
    .maybeSingle();
  if (error) throw error;
  return (data as NotificationRuleRow | null) ?? null;
}

export async function loadUnifiedRulesForOwner(db: DbClient, owner: NotificationOwner, filters?: { visibleInFollowing?: boolean }) {
  let query = db.from('notification_rules_v3').select('*').eq('owner_key', ownerKeyFor(owner)).order('updated_at', { ascending: false });
  if (filters?.visibleInFollowing !== undefined) {
    query = query.eq('visible_in_following', filters.visibleInFollowing);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as NotificationRuleRow[] | null) ?? [];
}

export async function countUnifiedRulesByScopeKind(
  db: DbClient,
  owner: NotificationOwner,
  scopeKinds: Array<NotificationRuleRow['scope_kind']>
) {
  const { count, error } = await db
    .from('notification_rules_v3')
    .select('id', { count: 'exact', head: true })
    .eq('owner_key', ownerKeyFor(owner))
    .in('scope_kind', scopeKinds)
    .contains('channels', ['push']);
  if (error) throw error;
  return count ?? 0;
}

export async function upsertUnifiedRule(db: DbClient, input: NotificationRuleUpsertInput) {
  const ownerKey = ownerKeyFor(input);
  const existing = await loadUnifiedRuleByScope(db, input, input.scope);
  const nextChannels = Array.from(
    new Set([...(Array.isArray(existing?.channels) ? existing.channels : []), ...(input.channels ?? [])].filter(Boolean))
  );
  const nextOffsets = normalizeOffsets(input.settings?.prelaunchOffsetsMinutes);
  const nextStatusTypes = normalizeStatusChangeTypes(input.settings?.statusChangeTypes);
  const settings = {
    timezone: normalizeText(input.settings?.timezone) ?? normalizeText(existing?.timezone) ?? 'UTC',
    prelaunchOffsetsMinutes: nextOffsets.length > 0 ? nextOffsets : normalizeOffsets(existing?.prelaunch_offsets_minutes),
    includeLiftoff: input.settings?.includeLiftoff ?? existing?.include_liftoff ?? false,
    dailyDigestLocalTime: normalizeLocalTime(input.settings?.dailyDigestLocalTime) ?? normalizeLocalTime(existing?.daily_digest_local_time),
    statusChangeTypes: nextStatusTypes.length > 0 ? nextStatusTypes : normalizeStatusChangeTypes(existing?.status_change_types),
    notifyNetChanges: input.settings?.notifyNetChanges ?? existing?.notify_net_change ?? false
  };
  const now = new Date().toISOString();
  const payload = {
    owner_kind: input.ownerKind,
    owner_key: ownerKey,
    user_id: input.ownerKind === 'user' ? input.userId : null,
    installation_id: input.ownerKind === 'guest' ? input.installationId : null,
    intent: existing?.intent === 'follow' || input.intent === 'follow' ? 'follow' : 'notifications_only',
    visible_in_following: input.visibleInFollowing ?? existing?.visible_in_following ?? false,
    enabled: input.enabled ?? existing?.enabled ?? true,
    scope_kind: input.scope.scopeKind,
    scope_key: input.scope.scopeKey,
    ...scopeColumns(input.scope),
    channels: nextChannels,
    timezone: settings.timezone,
    prelaunch_offsets_minutes: settings.prelaunchOffsetsMinutes,
    include_liftoff: settings.includeLiftoff,
    daily_digest_local_time: settings.dailyDigestLocalTime,
    status_change_types: settings.statusChangeTypes,
    notify_net_change: settings.notifyNetChanges,
    created_at: existing?.created_at ?? now,
    updated_at: now
  };

  const { data, error } = await db
    .from('notification_rules_v3')
    .upsert(payload, { onConflict: 'owner_key,scope_kind,scope_key' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function removeChannelsFromUnifiedRule(
  db: DbClient,
  owner: NotificationOwner,
  scope: NotificationRuleScope,
  channelsToRemove: Array<'push' | 'email'>
) {
  const existing = await loadUnifiedRuleByScope(db, owner, scope);
  if (!existing) return null;

  const remainingChannels = (Array.isArray(existing.channels) ? existing.channels : []).filter(
    (channel: unknown) => !channelsToRemove.includes(channel as 'push' | 'email')
  );
  if (!remainingChannels.length && existing.intent !== 'follow') {
    const { error } = await db.from('notification_rules_v3').delete().eq('id', existing.id);
    if (error) throw error;
    return null;
  }

  const { data, error } = await db
    .from('notification_rules_v3')
    .update({
      channels: remainingChannels,
      updated_at: new Date().toISOString()
    })
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function clearUnifiedFollowIntent(db: DbClient, owner: NotificationOwner, scope: NotificationRuleScope) {
  const existing = await loadUnifiedRuleByScope(db, owner, scope);
  if (!existing) return null;

  if (Array.isArray(existing.channels) && existing.channels.length > 0) {
    const { data, error } = await db
      .from('notification_rules_v3')
      .update({
        intent: 'notifications_only',
        visible_in_following: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db.from('notification_rules_v3').delete().eq('id', existing.id).select('id').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function deleteUnifiedRuleById(db: DbClient, owner: NotificationOwner, ruleId: string) {
  const { data, error } = await db.from('notification_rules_v3').delete().eq('id', ruleId).eq('owner_key', ownerKeyFor(owner)).select('id').maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function deleteUnifiedRuleByScope(db: DbClient, owner: NotificationOwner, scope: NotificationRuleScope) {
  const { data, error } = await db
    .from('notification_rules_v3')
    .delete()
    .eq('owner_key', ownerKeyFor(owner))
    .eq('scope_kind', scope.scopeKind)
    .eq('scope_key', scope.scopeKey)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function upsertUnifiedPushDestination(
  db: DbClient,
  owner: NotificationOwner & { deviceSecretHash?: string | null },
  input: {
    platform: 'web' | 'ios' | 'android';
    deliveryKind: 'web_push' | 'mobile_push';
    pushProvider: 'webpush' | 'expo';
    destinationKey: string;
    endpoint?: string | null;
    p256dh?: string | null;
    auth?: string | null;
    token?: string | null;
    appVersion?: string | null;
    deviceName?: string | null;
    userAgent?: string | null;
    isActive?: boolean;
    verified?: boolean;
  }
) {
  const now = new Date().toISOString();
  const payload = {
    owner_kind: owner.ownerKind,
    owner_key: ownerKeyFor(owner),
    user_id: owner.ownerKind === 'user' ? owner.userId : null,
    installation_id: owner.installationId ?? null,
    platform: input.platform,
    delivery_kind: input.deliveryKind,
    push_provider: input.pushProvider,
    destination_key: input.destinationKey,
    endpoint: normalizeText(input.endpoint),
    p256dh: normalizeText(input.p256dh),
    auth: normalizeText(input.auth),
    token: normalizeText(input.token),
    app_version: normalizeText(input.appVersion),
    device_name: normalizeText(input.deviceName),
    user_agent: normalizeText(input.userAgent),
    device_secret_hash: owner.ownerKind === 'guest' ? owner.deviceSecretHash ?? null : null,
    is_active: input.isActive ?? true,
    verified: input.verified ?? true,
    disabled_at: input.isActive === false ? now : null,
    last_failure_reason: null,
    last_registered_at: now,
    updated_at: now,
    created_at: now
  };
  const { data, error } = await db
    .from('notification_push_destinations_v3')
    .upsert(payload, { onConflict: 'owner_key,destination_key' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function loadPushDestinationsForOwner(db: DbClient, owner: NotificationOwner) {
  const { data, error } = await db
    .from('notification_push_destinations_v3')
    .select('*')
    .eq('owner_key', ownerKeyFor(owner))
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as NotificationDestinationRow[] | null) ?? [];
}

export async function loadCurrentPushDestination(
  db: DbClient,
  owner: NotificationOwner,
  installationId: string,
  platform?: 'web' | 'ios' | 'android'
) {
  let query = db
    .from('notification_push_destinations_v3')
    .select('*')
    .eq('owner_key', ownerKeyFor(owner))
    .eq('installation_id', installationId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (platform) {
    query = query.eq('platform', platform);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as NotificationDestinationRow | null) ?? null;
}

export async function deactivatePushDestinations(
  db: DbClient,
  owner: NotificationOwner,
  {
    installationId,
    platform,
    reason
  }: {
    installationId: string;
    platform?: 'web' | 'ios' | 'android';
    reason: string;
  }
) {
  let query = db
    .from('notification_push_destinations_v3')
    .update({
      is_active: false,
      disabled_at: new Date().toISOString(),
      last_failure_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq('owner_key', ownerKeyFor(owner))
    .eq('installation_id', installationId);
  if (platform) {
    query = query.eq('platform', platform);
  }
  const { error } = await query;
  if (error) throw error;
}

export function mapUnifiedRuleToPayload(row: NotificationRuleRow): NotificationRuleV2 {
  return {
    id: row.id,
    ownerKind: row.owner_kind,
    intent: row.intent,
    visibleInFollowing: row.visible_in_following === true,
    enabled: row.enabled !== false,
    label:
      row.scope_kind === 'provider' ||
      row.scope_kind === 'rocket' ||
      row.scope_kind === 'pad' ||
      row.scope_kind === 'launch_site' ||
      row.scope_kind === 'tier'
        ? buildFollowScopeLabel(ruleRowToScope(row))
        : buildRuleLabel(ruleRowToScope(row)),
    scopeKind: row.scope_kind,
    scopeKey: row.scope_key,
    channels: (Array.isArray(row.channels) ? row.channels : []).filter(
      (channel): channel is 'push' | 'email' => channel === 'push' || channel === 'email'
    ),
    settings: {
      timezone: normalizeText(row.timezone) ?? 'UTC',
      prelaunchOffsetsMinutes: normalizeOffsets(row.prelaunch_offsets_minutes),
      includeLiftoff: row.include_liftoff === true,
      dailyDigestLocalTime: normalizeLocalTime(row.daily_digest_local_time),
      statusChangeTypes: normalizeStatusChangeTypes(row.status_change_types) as Array<'any' | 'go' | 'hold' | 'scrubbed' | 'tbd'>,
      notifyNetChanges: row.notify_net_change === true
    },
    launchId: normalizeText(row.launch_id),
    state: normalizeText(row.state),
    provider: normalizeText(row.provider),
    rocketId: typeof row.rocket_id === 'number' ? row.rocket_id : null,
    padKey: normalizeText(row.pad_key),
    launchSite: normalizeText(row.launch_site),
    presetId: normalizeText(row.filter_preset_id),
    filters: row.filters ?? null,
    tier: normalizeText(row.tier),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  };
}

export function mapUnifiedDestinationToPayload(row: NotificationDestinationRow): NotificationDestinationV2 {
  return {
    id: row.id,
    ownerKind: row.owner_kind,
    channel: 'push',
    platform: row.platform,
    deliveryKind: row.delivery_kind,
    installationId: normalizeText(row.installation_id),
    registered: row.is_active === true,
    active: row.is_active === true,
    verified: row.verified !== false,
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at),
    lastSentAt: normalizeText(row.last_sent_at),
    lastReceiptAt: normalizeText(row.last_receipt_at),
    lastFailureReason: normalizeText(row.last_failure_reason),
    disabledAt: normalizeText(row.disabled_at),
    label: null
  };
}

export function ruleRowToScope(row: Pick<NotificationRuleRow, 'scope_kind' | 'scope_key' | 'launch_id' | 'state' | 'provider' | 'rocket_id' | 'pad_key' | 'launch_site' | 'filter_preset_id' | 'filters' | 'tier'>): NotificationRuleScope {
  switch (row.scope_kind) {
    case 'all_us':
      return { scopeKind: 'all_us', scopeKey: 'us' };
    case 'all_launches':
      return { scopeKind: 'all_launches', scopeKey: 'all' };
    case 'launch':
      return {
        scopeKind: 'launch',
        scopeKey: row.scope_key,
        launchId: normalizeText(row.launch_id) ?? row.scope_key
      };
    case 'state':
      return {
        scopeKind: 'state',
        scopeKey: row.scope_key,
        state: normalizeText(row.state) ?? row.scope_key.toUpperCase()
      };
    case 'provider':
      return {
        scopeKind: 'provider',
        scopeKey: row.scope_key,
        provider: normalizeText(row.provider) ?? row.scope_key
      };
    case 'rocket':
      return {
        scopeKind: 'rocket',
        scopeKey: row.scope_key,
        rocketId: typeof row.rocket_id === 'number' ? row.rocket_id : null
      };
    case 'pad':
      return {
        scopeKind: 'pad',
        scopeKey: row.scope_key,
        padKey: normalizeText(row.pad_key) ?? row.scope_key
      };
    case 'launch_site':
      return {
        scopeKind: 'launch_site',
        scopeKey: row.scope_key,
        launchSite: normalizeText(row.launch_site) ?? row.scope_key
      };
    case 'preset':
      return {
        scopeKind: 'preset',
        scopeKey: row.scope_key,
        presetId: normalizeText(row.filter_preset_id) ?? row.scope_key
      };
    case 'filter':
      return {
        scopeKind: 'filter',
        scopeKey: row.scope_key,
        filters: row.filters ?? {}
      };
    case 'tier':
      return {
        scopeKind: 'tier',
        scopeKey: row.scope_key,
        tier: normalizeText(row.tier) ?? row.scope_key
      };
  }
}
