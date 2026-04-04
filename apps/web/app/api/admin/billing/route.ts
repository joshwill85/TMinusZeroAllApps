import { NextResponse } from 'next/server';
import { loadDiscountCampaigns, summarizeDiscountCampaigns } from '@/lib/server/discountCampaigns';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import {
  isAppleBillingConfigured,
  isAppleBillingNotificationsConfigured,
  isGoogleBillingConfigured,
  isGoogleBillingNotificationsConfigured,
  isStripeConfigured,
  isStripePriceConfigured,
  isStripePublishableConfigured,
  isStripeWebhookConfigured
} from '@/lib/server/env';
import { requireAdminRequest } from '../_lib/auth';

export const dynamic = 'force-dynamic';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  pending: 4,
  on_hold: 5,
  canceled: 6,
  revoked: 7,
  expired: 8,
  incomplete: 9,
  incomplete_expired: 10,
  paused: 11,
  none: 12
};

const PROVIDERS = ['stripe', 'apple_app_store', 'google_play'] as const;
const WEBHOOK_SOURCES = ['stripe', 'apple_app_store', 'google_play'] as const;

type ProviderKey = (typeof PROVIDERS)[number];
type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

type ProviderEntitlementRow = {
  user_id: string;
  provider: ProviderKey;
  status: string;
  is_active: boolean;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  provider_product_id: string | null;
  updated_at: string | null;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
  role: string | null;
  created_at: string | null;
};

type SubscriptionRow = {
  user_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string | null;
};

type StripeCustomerRow = {
  user_id: string;
  stripe_customer_id: string | null;
};

type PurchaseEventRow = {
  user_id: string | null;
  provider: ProviderKey;
  event_type: string;
  status: string | null;
  provider_event_id: string | null;
  provider_product_id: string | null;
  provider_subscription_id: string | null;
  created_at: string | null;
};

type WebhookFailureRow = {
  source: WebhookSource;
  event_id?: string | null;
  received_at: string | null;
  processed: boolean;
  error: string | null;
};

type PremiumClaimRow = {
  user_id: string | null;
  provider: ProviderKey;
  status: string;
  provider_product_id: string | null;
  current_period_end: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function isMissingRelationError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

function formatProviderLabel(provider: ProviderKey | null) {
  if (provider === 'apple_app_store') return 'App Store';
  if (provider === 'google_play') return 'Google Play';
  if (provider === 'stripe') return 'Stripe';
  return 'None';
}

function buildPlanLabel({
  provider,
  stripePriceId,
  providerProductId,
  proPriceId,
  priceConfigured
}: {
  provider: ProviderKey | null;
  stripePriceId: string | null;
  providerProductId: string | null;
  proPriceId: string;
  priceConfigured: boolean;
}) {
  if (!provider) {
    return 'None';
  }

  if (provider === 'stripe') {
    if (stripePriceId && stripePriceId === proPriceId && priceConfigured) {
      return 'Premium monthly';
    }
    return 'Stripe plan';
  }

  return `Premium via ${formatProviderLabel(provider)}`;
}

function createEmptyWebhookHealth(source: WebhookSource) {
  return {
    source,
    lastReceivedAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    pendingCount: 0,
    failedLast24h: 0
  };
}

async function loadOptionalRows<T>(
  promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  label: string
) {
  const result = await promise;
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return [] as T[];
    }
    console.error(label, result.error);
    return [] as T[];
  }
  return result.data ?? [];
}

async function loadOptionalMaybeSingle<T>(
  promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  label: string
) {
  const result = await promise;
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return null;
    }
    console.error(label, result.error);
    return null;
  }
  return result.data ?? null;
}

async function loadOptionalCount(
  promise: PromiseLike<{ count: number | null; error: { message?: string } | null }>,
  label: string
) {
  const result = await promise;
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return 0;
    }
    console.error(label, result.error);
    return 0;
  }
  return result.count ?? 0;
}

async function loadWebhookHealth(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  source: WebhookSource,
  cutoffIso: string
) {
  const [lastReceived, lastSuccess, pendingCount, failedLast24h] = await Promise.all([
    loadOptionalMaybeSingle<{ received_at: string | null; error: string | null }>(
      admin
        .from('webhook_events')
        .select('received_at,error')
        .eq('source', source)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      `${source} webhook last received`
    ),
    loadOptionalMaybeSingle<{ received_at: string | null }>(
      admin
        .from('webhook_events')
        .select('received_at')
        .eq('source', source)
        .eq('processed', true)
        .is('error', null)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      `${source} webhook last success`
    ),
    loadOptionalCount(
      admin.from('webhook_events').select('id', { count: 'exact', head: true }).eq('source', source).eq('processed', false),
      `${source} webhook pending`
    ),
    loadOptionalCount(
      admin
        .from('webhook_events')
        .select('id', { count: 'exact', head: true })
        .eq('source', source)
        .not('error', 'is', null)
        .gte('received_at', cutoffIso),
      `${source} webhook failures`
    )
  ]);

  return {
    source,
    lastReceivedAt: typeof lastReceived?.received_at === 'string' ? lastReceived.received_at : null,
    lastSuccessAt: typeof lastSuccess?.received_at === 'string' ? lastSuccess.received_at : null,
    lastError: typeof lastReceived?.error === 'string' ? lastReceived.error : null,
    pendingCount,
    failedLast24h
  };
}

export async function GET() {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;
  const { supabase, admin } = gate.context;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });

  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    profiles,
    subscriptions,
    customers,
    providerEntitlements,
    recentPurchaseEvents,
    recentWebhookFailures,
    webhookHealth,
    recentClaims,
    providerCustomerMappingsCount,
    unmappedPurchaseEventsCount,
    pendingClaimsCount,
    verifiedClaimsCount,
    claimedClaimsCount,
    unattachedClaimsCount,
    discountCampaignsResult
  ] = await Promise.all([
    loadOptionalRows<ProfileRow>(
      admin.from('profiles').select('user_id,email,role,created_at').order('created_at', { ascending: false }).limit(500),
      'admin billing profiles'
    ),
    loadOptionalRows<SubscriptionRow>(
      admin
        .from('subscriptions')
        .select('user_id,stripe_subscription_id,stripe_price_id,status,current_period_end,cancel_at_period_end,updated_at'),
      'admin billing subscriptions'
    ),
    loadOptionalRows<StripeCustomerRow>(admin.from('stripe_customers').select('user_id,stripe_customer_id'), 'admin billing customers'),
    loadOptionalRows<ProviderEntitlementRow>(
      admin
        .from('purchase_entitlements')
        .select('user_id,provider,status,is_active,cancel_at_period_end,current_period_end,provider_product_id,updated_at'),
      'admin billing provider entitlements'
    ),
    loadOptionalRows<PurchaseEventRow>(
      admin
        .from('purchase_events')
        .select('user_id,provider,event_type,status,provider_event_id,provider_product_id,provider_subscription_id,created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      'admin billing purchase events'
    ),
    loadOptionalRows<WebhookFailureRow>(
      admin
        .from('webhook_events')
        .select('source,event_id,received_at,processed,error')
        .not('error', 'is', null)
        .order('received_at', { ascending: false })
        .limit(20),
      'admin billing webhook failures'
    ),
    Promise.all(WEBHOOK_SOURCES.map((source) => loadWebhookHealth(admin, source, cutoffIso))),
    loadOptionalRows<PremiumClaimRow>(
      admin
        .from('premium_claims')
        .select('user_id,provider,status,provider_product_id,current_period_end,updated_at,created_at')
        .order('updated_at', { ascending: false })
        .limit(20),
      'admin billing premium claims'
    ),
    loadOptionalCount(
      admin.from('purchase_provider_customers').select('id', { count: 'exact', head: true }),
      'admin billing purchase provider customers count'
    ),
    loadOptionalCount(
      admin.from('purchase_events').select('id', { count: 'exact', head: true }).is('user_id', null),
      'admin billing unmapped purchase events count'
    ),
    loadOptionalCount(
      admin.from('premium_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      'admin billing pending claims count'
    ),
    loadOptionalCount(
      admin.from('premium_claims').select('id', { count: 'exact', head: true }).eq('status', 'verified'),
      'admin billing verified claims count'
    ),
    loadOptionalCount(
      admin.from('premium_claims').select('id', { count: 'exact', head: true }).eq('status', 'claimed'),
      'admin billing claimed claims count'
    ),
    loadOptionalCount(
      admin
        .from('premium_claims')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'verified'])
        .is('user_id', null),
      'admin billing unattached claims count'
    ),
    loadDiscountCampaigns(admin)
  ]);

  const subscriptionMap = new Map(subscriptions.map((sub) => [sub.user_id, sub]));
  const customerMap = new Map(customers.map((customer) => [customer.user_id, customer.stripe_customer_id]));
  const providerEntitlementMap = new Map(providerEntitlements.map((row) => [row.user_id, row]));
  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY || '';
  const priceConfigured = isStripePriceConfigured();

  const billingCustomers = profiles
    .map((row) => {
      const subscription = subscriptionMap.get(row.user_id);
      const providerEntitlement = providerEntitlementMap.get(row.user_id) ?? null;
      const stripePriceId = subscription?.stripe_price_id ?? null;
      const provider = providerEntitlement?.provider ?? (subscription ? 'stripe' : null);
      const status = providerEntitlement?.status ?? subscription?.status ?? 'none';
      const currentPeriodEnd = providerEntitlement?.current_period_end ?? subscription?.current_period_end ?? null;
      const cancelAtPeriodEnd = providerEntitlement?.cancel_at_period_end ?? subscription?.cancel_at_period_end ?? false;
      const providerProductId = providerEntitlement?.provider_product_id ?? stripePriceId;

      return {
        userId: row.user_id,
        email: row.email ?? null,
        role: row.role === 'admin' ? 'admin' : 'user',
        provider,
        providerProductId,
        providerLabel: formatProviderLabel(provider),
        stripeCustomerId: customerMap.get(row.user_id) ?? null,
        stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
        stripePriceId,
        planLabel: buildPlanLabel({
          provider,
          stripePriceId,
          providerProductId,
          proPriceId,
          priceConfigured
        }),
        status,
        cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
        currentPeriodEnd,
        updatedAt: providerEntitlement?.updated_at ?? subscription?.updated_at ?? null
      };
    })
    .sort((a, b) => {
      const rankA = STATUS_ORDER[a.status] ?? 99;
      const rankB = STATUS_ORDER[b.status] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return (a.email ?? a.userId).localeCompare(b.email ?? b.userId);
    });

  const summary = {
    totalUsers: profiles.length,
    stripeCustomers: customers.length,
    subscriptions: subscriptions.length,
    active: 0,
    trialing: 0,
    pastDue: 0,
    unpaid: 0,
    canceled: 0,
    incomplete: 0,
    incompleteExpired: 0,
    paused: 0,
    other: 0,
    canceling: subscriptions.filter((sub) => sub.cancel_at_period_end).length
  };

  subscriptions.forEach((sub) => {
    switch (sub.status) {
      case 'active':
        summary.active += 1;
        break;
      case 'trialing':
        summary.trialing += 1;
        break;
      case 'past_due':
        summary.pastDue += 1;
        break;
      case 'unpaid':
        summary.unpaid += 1;
        break;
      case 'canceled':
        summary.canceled += 1;
        break;
      case 'incomplete':
        summary.incomplete += 1;
        break;
      case 'incomplete_expired':
        summary.incompleteExpired += 1;
        break;
      case 'paused':
        summary.paused += 1;
        break;
      default:
        summary.other += 1;
        break;
    }
  });

  const providerSummary = {
    totalEntitlements: providerEntitlements.length,
    activeEntitlements: providerEntitlements.filter((row) => row.is_active).length,
    providers: PROVIDERS.map((provider) => {
      const rows = providerEntitlements.filter((row) => row.provider === provider);
      return {
        provider,
        label: formatProviderLabel(provider),
        total: rows.length,
        active: rows.filter((row) => row.is_active).length,
        canceling: rows.filter((row) => row.cancel_at_period_end).length,
        expired: rows.filter((row) => row.status === 'expired').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        other: rows.filter((row) => !row.is_active && !['expired', 'pending'].includes(row.status)).length
      };
    })
  };

  const config = {
    stripeSecret: isStripeConfigured(),
    stripePublishable: isStripePublishableConfigured(),
    stripeWebhook: isStripeWebhookConfigured(),
    stripePrice: isStripePriceConfigured(),
    appleBilling: isAppleBillingConfigured(),
    appleNotifications: isAppleBillingNotificationsConfigured(),
    googleBilling: isGoogleBillingConfigured(),
    googleNotifications: isGoogleBillingNotificationsConfigured()
  };

  const webhooks = {
    stripe: webhookHealth.find((item) => item.source === 'stripe') ?? createEmptyWebhookHealth('stripe'),
    apple_app_store:
      webhookHealth.find((item) => item.source === 'apple_app_store') ?? createEmptyWebhookHealth('apple_app_store'),
    google_play: webhookHealth.find((item) => item.source === 'google_play') ?? createEmptyWebhookHealth('google_play')
  };

  if (discountCampaignsResult.loadError) {
    console.error('admin billing discount campaigns load error', discountCampaignsResult.loadError);
  }

  const claimSummary = {
    pending: pendingClaimsCount,
    verified: verifiedClaimsCount,
    claimed: claimedClaimsCount,
    unattached: unattachedClaimsCount
  };

  const mappingSummary = {
    providerCustomerMappings: providerCustomerMappingsCount,
    unmappedPurchaseEvents: unmappedPurchaseEventsCount
  };

  const campaignSummary = summarizeDiscountCampaigns(discountCampaignsResult.campaigns);

  return NextResponse.json(
    {
      config,
      summary,
      providerSummary,
      claimSummary,
      mappingSummary,
      campaignSummary,
      webhooks,
      recentClaims,
      recentPurchaseEvents,
      recentWebhookFailures,
      customers: billingCustomers
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
