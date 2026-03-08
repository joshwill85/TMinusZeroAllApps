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
  resolveViewerTier,
  tierToMode,
  type ViewerCapabilities,
  type ViewerLimits,
  type ViewerMode,
  type ViewerTier
} from '@/lib/tiers';

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

export type ViewerEntitlement = {
  status: string;
  isPaid: boolean;
  isAdmin: boolean;
  isAuthed: boolean;
  tier: ViewerTier;
  mode: ViewerMode;
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
};

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

  const [providerEntitlementRes, subscriptionRes, profileRes] = await Promise.all([
    loadProviderEntitlement(client, resolvedSession.userId),
    client
      .from('subscriptions')
      .select('status,cancel_at_period_end,current_period_end,stripe_price_id,updated_at')
      .eq('user_id', resolvedSession.userId)
      .maybeSingle(),
    client.from('profiles').select('role').eq('user_id', resolvedSession.userId).maybeSingle()
  ]);

  const loadError =
    providerEntitlementRes.loadError ??
    (subscriptionRes.error ? 'subscription_fetch_failed' : profileRes.error ? 'profile_fetch_failed' : null);
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
  const [profileRes, subscriptionRes] = await Promise.all([
    client.from('profiles').select('role').eq('user_id', normalizedUserId).maybeSingle(),
    client.from('subscriptions').select('status').eq('user_id', normalizedUserId).maybeSingle()
  ]);

  if (profileRes.error || subscriptionRes.error) {
    if (profileRes.error) console.error('profile entitlement lookup error', profileRes.error);
    if (subscriptionRes.error) console.error('subscription entitlement lookup error', subscriptionRes.error);
    return { entitlement: null, loadError: 'failed_to_load_entitlement' };
  }

  const role = profileRes.data?.role ?? null;
  const status = subscriptionRes.data?.status ?? null;
  const isAdmin = role === 'admin';
  return {
    entitlement: {
      userId: normalizedUserId,
      role,
      status,
      isAdmin,
      isPaid: isAdmin || isSubscriptionActive({ status })
    },
    loadError: null
  };
}

function buildEntitlement({
  status,
  isAuthed,
  isAdmin,
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
  userId: string | null;
  source: ViewerEntitlement['source'];
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
  reconciled: boolean;
  reconcileThrottled: boolean;
}): ViewerEntitlement {
  const isPaid = isAdmin || isSubscriptionActive({ status });
  const tier = resolveViewerTier({ isAuthed, isPaid, isAdmin });
  return {
    status,
    isPaid,
    isAdmin,
    isAuthed,
    tier,
    mode: tierToMode(tier),
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
