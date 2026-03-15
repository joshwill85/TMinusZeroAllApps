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

export async function loadProviderCustomerUserId(
  client: QueryClient,
  {
    provider,
    providerCustomerId
  }: {
    provider: PurchaseProvider;
    providerCustomerId: string;
  }
): Promise<{ userId: string | null; loadError: string | null }> {
  const result = await client
    .from('purchase_provider_customers')
    .select('user_id')
    .eq('provider', provider)
    .eq('provider_customer_id', providerCustomerId)
    .maybeSingle();

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return { userId: null, loadError: null };
    }
    console.error('provider customer mapping fetch error', result.error);
    return { userId: null, loadError: 'provider_customer_mapping_fetch_failed' };
  }

  return {
    userId: typeof result.data?.user_id === 'string' ? result.data.user_id : null,
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
  return upsertProviderCustomerMapping(admin, {
    userId,
    provider: 'stripe',
    providerCustomerId: stripeCustomerId,
    metadata
  });
}

export async function upsertProviderCustomerMapping(
  admin: QueryClient,
  {
    userId,
    provider,
    providerCustomerId,
    metadata,
    strictMissingRelation = false
  }: {
    userId: string;
    provider: PurchaseProvider;
    providerCustomerId: string;
    metadata?: Record<string, unknown>;
    strictMissingRelation?: boolean;
  }
) {
  const result = await admin.from('purchase_provider_customers').upsert(
    {
      user_id: userId,
      provider,
      provider_customer_id: providerCustomerId,
      metadata: metadata ?? {},
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,provider' }
  );

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      if (strictMissingRelation) {
        throw result.error;
      }
      return;
    }
    throw result.error;
  }
}

export async function upsertProviderEntitlement(
  admin: QueryClient,
  {
    userId,
    provider,
    providerCustomerId,
    providerSubscriptionId,
    providerProductId,
    status,
    isActive,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    source,
    metadata,
    eventType,
    providerEventId,
    eventPayload,
    strictMissingRelation = false
  }: {
    userId: string;
    provider: PurchaseProvider;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerProductId?: string | null;
    status: string;
    isActive?: boolean;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: string | null;
    source?: string;
    metadata?: Record<string, unknown>;
    eventType?: string | null;
    providerEventId?: string | null;
    eventPayload?: Record<string, unknown>;
    strictMissingRelation?: boolean;
  }
) {
  if (providerCustomerId) {
    await upsertProviderCustomerMapping(admin, {
      userId,
      provider,
      providerCustomerId,
      metadata: {
        source: 'billing_upsert',
        ...(metadata ?? {})
      },
      strictMissingRelation
    });
  }

  const entitlementResult = await admin.from('purchase_entitlements').upsert(
    {
      user_id: userId,
      entitlement_key: 'premium',
      provider,
      provider_subscription_id: providerSubscriptionId ?? null,
      provider_product_id: providerProductId ?? null,
      status,
      is_active: typeof isActive === 'boolean' ? isActive : isPaidSubscriptionStatus(status),
      cancel_at_period_end: Boolean(cancelAtPeriodEnd),
      current_period_end: currentPeriodEnd,
      source: source ?? 'provider_sync',
      metadata: metadata ?? {},
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,entitlement_key' }
  );

  if (entitlementResult.error) {
    if (isMissingRelationError(entitlementResult.error)) {
      if (strictMissingRelation) {
        throw entitlementResult.error;
      }
      return;
    }
    throw entitlementResult.error;
  }

  if (!eventType) {
    return;
  }

  const eventResult = await admin.from('purchase_events').insert({
    user_id: userId,
    provider,
    entitlement_key: 'premium',
    event_type: eventType,
    provider_event_id: providerEventId ?? null,
    provider_subscription_id: providerSubscriptionId ?? null,
    provider_product_id: providerProductId ?? null,
    status,
    payload: eventPayload ?? {}
  });

  if (eventResult.error) {
    if (isMissingRelationError(eventResult.error)) {
      if (strictMissingRelation) {
        throw eventResult.error;
      }
      return;
    }
    throw eventResult.error;
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
    await upsertProviderCustomerMapping(admin, {
      userId,
      provider: 'stripe',
      providerCustomerId: resolvedCustomerId
    });
  }

  const firstPrice = subscription.items?.data?.[0]?.price;
  const productId = typeof firstPrice === 'string' ? firstPrice : firstPrice?.id ?? null;
  const status = String(subscription.status || 'unknown');
  const currentPeriodEnd =
    typeof subscription.current_period_end === 'number'
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

  await upsertProviderEntitlement(admin, {
    userId,
    provider: 'stripe',
    providerCustomerId: resolvedCustomerId,
    providerSubscriptionId: subscription.id ?? null,
    providerProductId: productId,
    status,
    isActive: isPaidSubscriptionStatus(status),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd,
    source: 'provider_sync',
    metadata: {
      livemode: Boolean(subscription.livemode),
      metadata: subscription.metadata ?? {}
    },
    eventType,
    providerEventId,
    eventPayload: {
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      current_period_end: currentPeriodEnd
    }
  });
}
