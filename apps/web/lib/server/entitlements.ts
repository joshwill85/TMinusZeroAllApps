import { stripe } from '@/lib/api/stripe';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { loadProviderEntitlement } from '@/lib/server/providerEntitlements';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { resolveViewerSession, type ResolvedViewerSession } from '@/lib/server/viewerSession';
import {
  getTierCapabilities,
  getTierLimits,
  getTierRefreshSeconds,
  tierToMode,
  type ViewerCapabilities,
  type ViewerLimits,
  type ViewerMode,
  type ViewerTier
} from '@tminuszero/domain';

type SubscriptionSnapshot = {
  status?: string | null;
  stripe_price_id?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  updated_at?: string | null;
} | null;

type SessionScopedClient =
  | ReturnType<typeof createSupabaseAccessTokenClient>
  | ReturnType<typeof createSupabaseAdminClient>
  | ReturnType<typeof createSupabaseServerClient>;

export type AdminAccessOverrideTier = 'anon' | 'premium';
export type EffectiveTierSource = 'guest' | 'free' | 'subscription' | 'admin' | 'admin_override';

export type AdminAccessOverride = {
  userId: string;
  adminAccessOverride: AdminAccessOverrideTier | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ViewerEntitlement = {
  status: string;
  isPaid: boolean;
  billingIsPaid: boolean;
  isAdmin: boolean;
  isAuthed: boolean;
  tier: ViewerTier;
  mode: ViewerMode;
  effectiveTierSource: EffectiveTierSource;
  adminAccessOverride: AdminAccessOverrideTier | null;
  refreshIntervalSeconds: number;
  capabilities: ViewerCapabilities;
  limits: ViewerLimits;
  userId: string | null;
  source: 'stub' | 'guest' | 'db' | 'stripe_reconcile' | 'stripe' | 'apple' | 'google' | 'manual';
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
  reconciled: boolean;
  reconcileThrottled: boolean;
};

export type UserAccessEntitlement = {
  userId: string;
  role: string | null;
  status: string | null;
  isAdmin: boolean;
  isPaid: boolean;
  billingIsPaid: boolean;
  tier: ViewerTier;
  effectiveTierSource: EffectiveTierSource;
  adminAccessOverride: AdminAccessOverrideTier | null;
};

function isMissingAdminAccessOverrideRelationCode(code: string | null | undefined) {
  return code === '42P01' || code === 'PGRST205';
}

export async function getViewerEntitlement({
  request,
  session,
  reconcileStripe = false
}: {
  request?: Request;
  session?: ResolvedViewerSession;
  reconcileStripe?: boolean;
} = {}): Promise<{ entitlement: ViewerEntitlement; loadError: string | null }> {
  if (!isSupabaseConfigured()) {
    return {
      entitlement: buildEntitlement({
        status: 'stub',
        isAuthed: false,
        isAdmin: false,
        adminAccessOverride: null,
        userId: null,
        source: 'stub',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        stripePriceId: null,
        reconciled: false,
        reconcileThrottled: false
      }),
      loadError: null
    };
  }

  const resolvedSession = session ?? (await resolveViewerSession(request));
  if (!resolvedSession.userId) {
    return {
      entitlement: buildEntitlement({
        status: 'none',
        isAuthed: false,
        isAdmin: false,
        adminAccessOverride: null,
        userId: null,
        source: 'guest',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        stripePriceId: null,
        reconciled: false,
        reconcileThrottled: false
      }),
      loadError: null
    };
  }

  const client = createSessionScopedClient(resolvedSession);
  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  if (!client) {
    return {
      entitlement: buildEntitlement({
        status: resolvedSession.role === 'admin' ? 'active' : 'none',
        isAuthed: true,
        isAdmin: resolvedSession.role === 'admin',
        adminAccessOverride: null,
        userId: resolvedSession.userId,
        source: 'guest',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        stripePriceId: null,
        reconciled: false,
        reconcileThrottled: false
      }),
      loadError: null
    };
  }

  const [providerEntitlementRes, subscriptionRes, profileRes, adminAccessOverrideRes] = await Promise.all([
    loadProviderEntitlement(client, resolvedSession.userId),
    client
      .from('subscriptions')
      .select('status,cancel_at_period_end,current_period_end,stripe_price_id,updated_at')
      .eq('user_id', resolvedSession.userId)
      .maybeSingle(),
    client.from('profiles').select('role').eq('user_id', resolvedSession.userId).maybeSingle(),
    loadAdminAccessOverrideByUserId({
      userId: resolvedSession.userId,
      client
    })
  ]);

  const loadError =
    providerEntitlementRes.loadError ??
    (subscriptionRes.error
      ? 'subscription_fetch_failed'
      : profileRes.error
        ? 'profile_fetch_failed'
        : adminAccessOverrideRes.loadError);
  if (subscriptionRes.error) {
    console.error('subscription fetch error', subscriptionRes.error);
  }
  if (profileRes.error) {
    console.error('profile role fetch error', profileRes.error);
  }

  const role = profileRes.data?.role ?? (resolvedSession.role === 'admin' ? 'admin' : null);
  const isAdmin = role === 'admin';
  const providerEntitlement = providerEntitlementRes.entitlement;
  const subscription = subscriptionRes.data ?? null;
  const adminAccessOverride = isAdmin ? adminAccessOverrideRes.override?.adminAccessOverride ?? null : null;

  const reconciledResult =
    reconcileStripe && admin
      ? await maybeReconcileSubscription({
          admin,
          userId: resolvedSession.userId,
          isAdmin,
          subscription
        })
      : null;

  const status = reconciledResult?.subscription?.status || providerEntitlement?.status || subscription?.status || 'none';
  const source = reconciledResult?.reconciled ? 'stripe_reconcile' : providerEntitlement?.source ?? 'db';
  return {
    entitlement: buildEntitlement({
      status,
      isAuthed: true,
      isAdmin,
      adminAccessOverride,
      userId: resolvedSession.userId,
      source,
      cancelAtPeriodEnd:
        reconciledResult?.subscription?.cancelAtPeriodEnd ?? providerEntitlement?.cancelAtPeriodEnd ?? subscription?.cancel_at_period_end ?? false,
      currentPeriodEnd:
        reconciledResult?.subscription?.currentPeriodEnd ?? providerEntitlement?.currentPeriodEnd ?? subscription?.current_period_end ?? null,
      stripePriceId:
        reconciledResult?.subscription?.stripePriceId ??
        (providerEntitlement?.provider === 'stripe' ? providerEntitlement.productId : null) ??
        subscription?.stripe_price_id ??
        null,
      reconciled: reconciledResult?.reconciled ?? false,
      reconcileThrottled: reconciledResult?.throttled ?? false
    }),
    loadError
  };
}

function createSessionScopedClient(session: ResolvedViewerSession): SessionScopedClient | null {
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

export async function getUserAccessEntitlementById({
  userId,
  admin
}: {
  userId: string;
  admin?: ReturnType<typeof createSupabaseAdminClient>;
}): Promise<{ entitlement: UserAccessEntitlement | null; loadError: string | null }> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return { entitlement: null, loadError: 'invalid_user_id' };
  }

  if (!admin && !isSupabaseAdminConfigured()) {
    return { entitlement: null, loadError: 'supabase_admin_not_configured' };
  }

  const client = admin ?? createSupabaseAdminClient();
  const [profileRes, subscriptionRes, adminAccessOverrideRes] = await Promise.all([
    client.from('profiles').select('role').eq('user_id', normalizedUserId).maybeSingle(),
    client.from('subscriptions').select('status').eq('user_id', normalizedUserId).maybeSingle(),
    loadAdminAccessOverrideByUserId({ userId: normalizedUserId, client })
  ]);

  if (profileRes.error || subscriptionRes.error || adminAccessOverrideRes.loadError) {
    if (profileRes.error) console.error('profile entitlement lookup error', profileRes.error);
    if (subscriptionRes.error) console.error('subscription entitlement lookup error', subscriptionRes.error);
    if (adminAccessOverrideRes.loadError) console.error('admin access override lookup error', adminAccessOverrideRes.loadError);
    return { entitlement: null, loadError: 'failed_to_load_entitlement' };
  }

  const role = profileRes.data?.role ?? null;
  const status = subscriptionRes.data?.status ?? null;
  const isAdmin = role === 'admin';
  const billingIsPaid = isSubscriptionActive({ status });
  const adminAccessOverride = isAdmin ? adminAccessOverrideRes.override?.adminAccessOverride ?? null : null;
  const effectiveTier = resolveEffectiveTier({
    isAuthed: true,
    isAdmin,
    billingIsPaid,
    adminAccessOverride
  });
  return {
    entitlement: {
      userId: normalizedUserId,
      role,
      status,
      isAdmin,
      isPaid: effectiveTier.tier === 'premium',
      billingIsPaid,
      tier: effectiveTier.tier,
      effectiveTierSource: effectiveTier.source,
      adminAccessOverride
    },
    loadError: null
  };
}

function buildEntitlement({
  status,
  isAuthed,
  isAdmin,
  adminAccessOverride,
  userId,
  source,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  stripePriceId,
  reconciled,
  reconcileThrottled
}: {
  status: string;
  isAuthed: boolean;
  isAdmin: boolean;
  adminAccessOverride: AdminAccessOverrideTier | null;
  userId: string | null;
  source: ViewerEntitlement['source'];
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
  reconciled: boolean;
  reconcileThrottled: boolean;
}): ViewerEntitlement {
  const billingIsPaid = isSubscriptionActive({ status });
  const effectiveTier = resolveEffectiveTier({
    isAuthed,
    isAdmin,
    billingIsPaid,
    adminAccessOverride
  });
  const tier = effectiveTier.tier;
  const isPaid = tier === 'premium';
  return {
    status,
    isPaid,
    billingIsPaid,
    isAdmin,
    isAuthed,
    tier,
    mode: tierToMode(tier),
    effectiveTierSource: effectiveTier.source,
    adminAccessOverride,
    refreshIntervalSeconds: getTierRefreshSeconds(tier),
    capabilities: getTierCapabilities(tier),
    limits: getTierLimits(tier),
    userId,
    source,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    stripePriceId,
    reconciled,
    reconcileThrottled
  };
}

function resolveEffectiveTier({
  isAuthed,
  isAdmin,
  billingIsPaid,
  adminAccessOverride
}: {
  isAuthed: boolean;
  isAdmin: boolean;
  billingIsPaid: boolean;
  adminAccessOverride: AdminAccessOverrideTier | null;
}): { tier: ViewerTier; source: EffectiveTierSource } {
  if (!isAuthed) {
    return { tier: 'anon', source: 'guest' };
  }

  if (adminAccessOverride) {
    return {
      tier: adminAccessOverride,
      source: 'admin_override'
    };
  }

  if (isAdmin) {
    return { tier: 'premium', source: 'admin' };
  }

  if (billingIsPaid) {
    return { tier: 'premium', source: 'subscription' };
  }

  return { tier: 'anon', source: 'free' };
}

async function loadAdminAccessOverrideByUserId({
  userId,
  client
}: {
  userId: string;
  client: SessionScopedClient | ReturnType<typeof createSupabaseAdminClient>;
}): Promise<{ override: AdminAccessOverride | null; loadError: string | null }> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return { override: null, loadError: null };
  }

  const { data, error } = await client
    .from('admin_access_overrides')
    .select('user_id, effective_tier_override, updated_at, updated_by')
    .eq('user_id', normalizedUserId)
    .maybeSingle();

  if (error) {
    const code = typeof error.code === 'string' ? error.code : '';
    if (code === 'PGRST116' || isMissingAdminAccessOverrideRelationCode(code)) {
      return { override: null, loadError: null };
    }
    return { override: null, loadError: 'admin_access_override_fetch_failed' };
  }

  const overrideValue = String(data?.effective_tier_override || '').trim().toLowerCase();
  return {
    override: data
      ? {
          userId: normalizedUserId,
          adminAccessOverride: overrideValue === 'anon' || overrideValue === 'premium' ? (overrideValue as AdminAccessOverrideTier) : null,
          updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
          updatedBy: typeof data.updated_by === 'string' ? data.updated_by : null
        }
      : null,
    loadError: null
  };
}

async function maybeReconcileSubscription({
  admin,
  userId,
  isAdmin,
  subscription
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  isAdmin: boolean;
  subscription: SubscriptionSnapshot;
}): Promise<{
  reconciled: boolean;
  throttled: boolean;
  subscription: {
    status: string | null;
    stripePriceId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}> {
  if (isAdmin) return { reconciled: false, throttled: false, subscription: null };
  if (!isStripeConfigured()) return { reconciled: false, throttled: false, subscription: null };

  const status = subscription?.status ?? null;
  const isActive = isSubscriptionActive({ status });
  const now = Date.now();

  const mappingRes = await admin
    .from('stripe_customers')
    .select('stripe_customer_id,last_subscription_sync_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (mappingRes.error) {
    console.warn('stripe customer mapping lookup warning', mappingRes.error);
    return { reconciled: false, throttled: false, subscription: null };
  }

  const stripeCustomerId = mappingRes.data?.stripe_customer_id ?? null;
  if (!stripeCustomerId) return { reconciled: false, throttled: false, subscription: null };

  const lastSyncIso = mappingRes.data?.last_subscription_sync_at ?? null;
  const lastSyncMs = lastSyncIso ? Date.parse(lastSyncIso) : Number.NaN;
  const throttleMs = isActive ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
  if (Number.isFinite(lastSyncMs) && now - lastSyncMs < throttleMs) {
    return { reconciled: false, throttled: true, subscription: null };
  }

  let list;
  try {
    list = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price']
    });
  } catch (err) {
    console.warn('stripe subscription reconcile lookup warning', err);
    return { reconciled: false, throttled: false, subscription: null };
  }

  const candidate = pickBestStripeSubscription(list?.data || []);
  const nowIso = new Date(now).toISOString();

  await admin.from('stripe_customers').update({ last_subscription_sync_at: nowIso }).eq('user_id', userId);

  if (!candidate) {
    return { reconciled: false, throttled: false, subscription: null };
  }

  const stripePriceId = candidate.items?.data?.[0]?.price?.id || 'unknown';
  const currentPeriodEnd = candidate.current_period_end ? new Date(candidate.current_period_end * 1000).toISOString() : null;
  const cancelAtPeriodEnd = Boolean(candidate.cancel_at_period_end);

  const { error: upsertError } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: candidate.id,
      stripe_price_id: stripePriceId,
      status: candidate.status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: nowIso
    },
    { onConflict: 'user_id' }
  );

  if (upsertError) {
    console.warn('subscription reconcile upsert warning', upsertError);
    return { reconciled: false, throttled: false, subscription: null };
  }

  return {
    reconciled: true,
    throttled: false,
    subscription: { status: candidate.status, stripePriceId, currentPeriodEnd, cancelAtPeriodEnd }
  };
}

function pickBestStripeSubscription(subscriptions: any[]) {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  if (!list.length) return null;

  const scoreStatus = (status: unknown) => {
    const s = String(status || '').toLowerCase();
    if (s === 'active') return 3;
    if (s === 'trialing') return 2;
    return 1;
  };

  return (
    [...list]
      .filter((sub) => sub && typeof sub.id === 'string')
      .sort((a, b) => {
        const aScore = scoreStatus(a.status);
        const bScore = scoreStatus(b.status);
        if (bScore !== aScore) return bScore - aScore;
        return Number(b.created || 0) - Number(a.created || 0);
      })[0] || null
  );
}
