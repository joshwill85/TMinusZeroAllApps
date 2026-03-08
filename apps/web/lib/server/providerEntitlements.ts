import { isPaidSubscriptionStatus } from '@/lib/billing/shared';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

type QueryClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

export type PurchaseProvider = 'stripe' | 'apple_app_store' | 'google_play';
export type PurchaseSource = 'stripe' | 'apple' | 'google' | 'manual';

export type ProviderEntitlementRecord = {
  provider: PurchaseProvider;
  source: PurchaseSource;
  status: string;
  productId: string | null;
  subscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  isActive: boolean;
};

function isMissingRelationError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

function mapPurchaseSource(provider: PurchaseProvider, source: string | null | undefined): PurchaseSource {
  const normalized = String(source || '')
    .trim()
    .toLowerCase();
  if (normalized === 'manual') return 'manual';
  if (provider === 'apple_app_store') return 'apple';
  if (provider === 'google_play') return 'google';
  return 'stripe';
}

export async function loadProviderEntitlement(
  client: QueryClient,
  userId: string
): Promise<{ entitlement: ProviderEntitlementRecord | null; loadError: string | null }> {
  const result = await client
    .from('purchase_entitlements')
    .select('provider, source, status, provider_product_id, provider_subscription_id, cancel_at_period_end, current_period_end, is_active')
    .eq('user_id', userId)
    .eq('entitlement_key', 'premium')
    .maybeSingle();

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return { entitlement: null, loadError: null };
    }
    console.error('purchase entitlement fetch error', result.error);
    return { entitlement: null, loadError: 'purchase_entitlement_fetch_failed' };
  }

  const row = result.data;
  if (!row) {
    return { entitlement: null, loadError: null };
  }

  const provider = row.provider as PurchaseProvider;
  return {
    entitlement: {
      provider,
      source: mapPurchaseSource(provider, row.source),
      status: String(row.status || 'none'),
      productId: typeof row.provider_product_id === 'string' ? row.provider_product_id : null,
      subscriptionId: typeof row.provider_subscription_id === 'string' ? row.provider_subscription_id : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      currentPeriodEnd: typeof row.current_period_end === 'string' ? row.current_period_end : null,
      isActive: typeof row.is_active === 'boolean' ? row.is_active : isPaidSubscriptionStatus(row.status)
    },
    loadError: null
  };
}

export async function mirrorStripeCustomerMapping(
  admin: QueryClient,
  {
    userId,
    stripeCustomerId,
    metadata
  }: {
    userId: string;
    stripeCustomerId: string;
    metadata?: Record<string, unknown>;
  }
) {
  const result = await admin.from('purchase_provider_customers').upsert(
    {
      user_id: userId,
      provider: 'stripe',
      provider_customer_id: stripeCustomerId,
      metadata: metadata ?? {},
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,provider' }
  );

  if (result.error && !isMissingRelationError(result.error)) {
    throw result.error;
  }
}

export async function mirrorStripeEntitlement(
  admin: QueryClient,
  {
    userId,
    stripeCustomerId,
    subscription,
    eventType,
    providerEventId
  }: {
    userId: string;
    stripeCustomerId?: string | null;
    subscription: {
      id?: string | null;
      status?: string | null;
      cancel_at_period_end?: boolean | null;
      current_period_end?: number | null;
      items?: { data?: Array<{ price?: { id?: string | null } | string | null }> | null } | null;
      customer?: string | { id?: string | null } | null;
      metadata?: Record<string, unknown> | null;
      livemode?: boolean | null;
    };
    eventType?: string | null;
    providerEventId?: string | null;
  }
) {
  const resolvedCustomerId =
    stripeCustomerId ||
    (typeof subscription.customer === 'string'
      ? subscription.customer
      : typeof subscription.customer?.id === 'string'
        ? subscription.customer.id
        : null);

  if (resolvedCustomerId) {
    await mirrorStripeCustomerMapping(admin, {
      userId,
      stripeCustomerId: resolvedCustomerId
    });
  }

  const firstPrice = subscription.items?.data?.[0]?.price;
  const productId = typeof firstPrice === 'string' ? firstPrice : firstPrice?.id ?? null;
  const status = String(subscription.status || 'unknown');
  const currentPeriodEnd =
    typeof subscription.current_period_end === 'number'
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

  const entitlementResult = await admin.from('purchase_entitlements').upsert(
    {
      user_id: userId,
      entitlement_key: 'premium',
      provider: 'stripe',
      provider_subscription_id: subscription.id ?? null,
      provider_product_id: productId,
      status,
      is_active: isPaidSubscriptionStatus(status),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      current_period_end: currentPeriodEnd,
      source: 'provider_sync',
      metadata: {
        livemode: Boolean(subscription.livemode),
        metadata: subscription.metadata ?? {}
      },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,entitlement_key' }
  );

  if (entitlementResult.error && !isMissingRelationError(entitlementResult.error)) {
    throw entitlementResult.error;
  }

  if (!eventType) {
    return;
  }

  const eventResult = await admin.from('purchase_events').insert({
    user_id: userId,
    provider: 'stripe',
    entitlement_key: 'premium',
    event_type: eventType,
    provider_event_id: providerEventId ?? null,
    provider_subscription_id: subscription.id ?? null,
    provider_product_id: productId,
    status,
    payload: {
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      current_period_end: currentPeriodEnd
    }
  });

  if (eventResult.error && !isMissingRelationError(eventResult.error)) {
    throw eventResult.error;
  }
}
