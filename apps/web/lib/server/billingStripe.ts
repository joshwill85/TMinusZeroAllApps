import { PRICE_PRO_MONTHLY, stripe } from '@/lib/api/stripe';
import { isBillableSubscriptionStatus, isPaidSubscriptionStatus, sanitizeReturnToPath } from '@/lib/billing/shared';
import { recordBillingEvent } from '@/lib/server/billingEvents';
import {
  getSiteUrl,
  isStripeConfigured,
  isSupabaseAdminConfigured,
  isSupabaseConfigured
} from '@/lib/server/env';
import { mirrorStripeCustomerMapping, mirrorStripeEntitlement } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type StripeBillableSubscription = {
  id: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  created: number;
};

export class BillingStripeRouteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, details?: Record<string, unknown> | null) {
    super(code);
    this.name = 'BillingStripeRouteError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

function assertBillingPrereqs() {
  if (!isSupabaseConfigured()) {
    throw new BillingStripeRouteError(501, 'supabase_not_configured');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new BillingStripeRouteError(501, 'supabase_service_role_missing');
  }
  if (!isStripeConfigured()) {
    throw new BillingStripeRouteError(501, 'stripe_not_configured');
  }
}

function assertAuthenticatedSession(
  session: ResolvedViewerSession
): asserts session is ResolvedViewerSession & { userId: string; email: string } {
  if (!session.userId || !session.email) {
    throw new BillingStripeRouteError(401, 'unauthorized');
  }
}

async function loadStripeCustomerMapping(admin: AdminClient, userId: string) {
  const result = await admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (result.error) {
    console.error('stripe customer mapping read error', result.error);
    throw new BillingStripeRouteError(500, 'failed_to_init_billing');
  }
  return result.data?.stripe_customer_id ?? null;
}

async function loadSubscriptionLookup(admin: AdminClient, userId: string) {
  const result = await admin
    .from('subscriptions')
    .select('stripe_subscription_id,status')
    .eq('user_id', userId)
    .maybeSingle();

  if (result.error) {
    console.error('subscription read error', result.error);
    throw new BillingStripeRouteError(500, 'failed_to_init_billing');
  }

  return {
    stripeSubscriptionId: result.data?.stripe_subscription_id ?? null,
    status: result.data?.status ?? null
  };
}

async function ensureStripeCustomer(admin: AdminClient, session: ResolvedViewerSession & { userId: string; email: string }) {
  const existingCustomerId = await loadStripeCustomerMapping(admin, session.userId);
  if (existingCustomerId) {
    return existingCustomerId;
  }

  let stripeCustomerId: string;
  try {
    stripeCustomerId = (
      await stripe.customers.create({
        email: session.email,
        metadata: { user_id: session.userId }
      })
    ).id;
  } catch (error) {
    console.error('stripe customer create error', error);
    throw new BillingStripeRouteError(502, 'failed_to_init_billing');
  }

  const upsertResult = await admin
    .from('stripe_customers')
    .upsert({ user_id: session.userId, stripe_customer_id: stripeCustomerId }, { onConflict: 'user_id' });
  if (upsertResult.error) {
    console.error('stripe customer mapping upsert error', upsertResult.error);
    throw new BillingStripeRouteError(500, 'failed_to_init_billing');
  }

  await mirrorStripeCustomerMapping(admin, {
    userId: session.userId,
    stripeCustomerId,
    metadata: {
      source: 'billing_route'
    }
  });

  return stripeCustomerId;
}

async function listBillableStripeSubscriptions(stripeCustomerId: string) {
  try {
    const list = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price']
    });

    return list.data
      .filter((item) => isBillableSubscriptionStatus(item.status))
      .map<StripeBillableSubscription>((item) => ({
        id: item.id,
        status: item.status ?? null,
        cancelAtPeriodEnd: Boolean(item.cancel_at_period_end),
        created: item.created ?? 0
      }))
      .sort((left, right) => right.created - left.created);
  } catch (error) {
    console.error('stripe subscription lookup error', error);
    throw new BillingStripeRouteError(502, 'stripe_lookup_failed');
  }
}

function selectBillableSubscription(
  subscriptions: StripeBillableSubscription[],
  { preferCancelAtPeriodEnd = false }: { preferCancelAtPeriodEnd?: boolean } = {}
) {
  if (!subscriptions.length) {
    return null;
  }
  if (!preferCancelAtPeriodEnd) {
    return subscriptions[0];
  }
  return subscriptions.find((subscription) => subscription.cancelAtPeriodEnd) ?? subscriptions[0];
}

async function resolveStripeSubscriptionId(
  admin: AdminClient,
  userId: string,
  { preferCancelAtPeriodEnd = false }: { preferCancelAtPeriodEnd?: boolean } = {}
) {
  const subscriptionLookup = await loadSubscriptionLookup(admin, userId);
  if (subscriptionLookup.stripeSubscriptionId) {
    return subscriptionLookup.stripeSubscriptionId;
  }

  const stripeCustomerId = await loadStripeCustomerMapping(admin, userId);
  if (!stripeCustomerId) {
    return null;
  }

  const subscriptions = await listBillableStripeSubscriptions(stripeCustomerId);
  return selectBillableSubscription(subscriptions, { preferCancelAtPeriodEnd })?.id ?? null;
}

async function mutateStripeSubscription({
  session,
  cancelAtPeriodEnd,
  eventType
}: {
  session: ResolvedViewerSession & { userId: string; email: string };
  cancelAtPeriodEnd: boolean;
  eventType: 'subscription_cancel_requested' | 'subscription_resumed';
}) {
  const admin = createSupabaseAdminClient();
  const stripeSubscriptionId = await resolveStripeSubscriptionId(admin, session.userId, {
    preferCancelAtPeriodEnd: !cancelAtPeriodEnd
  });

  if (!stripeSubscriptionId) {
    throw new BillingStripeRouteError(404, 'no_subscription');
  }

  let updated;
  try {
    updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
      expand: ['items.data.price']
    });
  } catch (error) {
    console.error(cancelAtPeriodEnd ? 'stripe subscription cancel error' : 'stripe subscription resume error', error);
    throw new BillingStripeRouteError(502, 'stripe_update_failed');
  }

  const stripePriceId = updated.items?.data?.[0]?.price?.id || 'unknown';
  const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
  const normalizedCancelAtPeriodEnd = Boolean(updated.cancel_at_period_end);

  await admin.from('subscriptions').upsert(
    {
      user_id: session.userId,
      stripe_subscription_id: updated.id,
      stripe_price_id: stripePriceId,
      status: updated.status || 'unknown',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: normalizedCancelAtPeriodEnd,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );

  await mirrorStripeEntitlement(admin, {
    userId: session.userId,
    stripeCustomerId: typeof updated.customer === 'string' ? updated.customer : null,
    subscription: updated,
    eventType
  });

  await recordBillingEvent({
    admin,
    userId: session.userId,
    email: session.email,
    eventType,
    source: 'self_serve',
    stripeSubscriptionId: updated.id,
    status: updated.status || 'unknown',
    cancelAtPeriodEnd: normalizedCancelAtPeriodEnd,
    currentPeriodEnd,
    sendEmail: true
  });

  return {
    status: updated.status,
    cancelAtPeriodEnd: normalizedCancelAtPeriodEnd,
    currentPeriodEnd
  };
}

export async function createStripeCheckoutSession(
  session: ResolvedViewerSession,
  {
    returnTo
  }: {
    returnTo?: string | null;
  }
) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);

  const sanitizedReturnTo = sanitizeReturnToPath(returnTo, '/account');
  const admin = createSupabaseAdminClient();
  const stripeCustomerId = await loadStripeCustomerMapping(admin, session.userId);
  const subscriptionLookup = await loadSubscriptionLookup(admin, session.userId);

  if (stripeCustomerId) {
    const existingBillableSubscription = selectBillableSubscription(await listBillableStripeSubscriptions(stripeCustomerId));
    if (existingBillableSubscription) {
      throw new BillingStripeRouteError(
        409,
        isPaidSubscriptionStatus(existingBillableSubscription.status) ? 'already_subscribed' : 'payment_issue',
        {
          status: existingBillableSubscription.status,
          returnTo: sanitizedReturnTo
        }
      );
    }

    if (isBillableSubscriptionStatus(subscriptionLookup.status)) {
      console.warn('billing checkout stale subscription status', {
        userId: session.userId,
        stripeCustomerId,
        dbStatus: subscriptionLookup.status
      });
    }
  } else if (isBillableSubscriptionStatus(subscriptionLookup.status)) {
    throw new BillingStripeRouteError(
      409,
      isPaidSubscriptionStatus(subscriptionLookup.status) ? 'already_subscribed' : 'payment_issue',
      {
        status: subscriptionLookup.status,
        returnTo: sanitizedReturnTo
      }
    );
  }

  const ensuredStripeCustomerId = await ensureStripeCustomer(admin, session);
  const priceId = PRICE_PRO_MONTHLY;
  if (!priceId || priceId === 'price_placeholder') {
    throw new BillingStripeRouteError(501, 'stripe_price_missing');
  }

  const siteUrl = getSiteUrl();
  const checkoutReturnQuery = `return_to=${encodeURIComponent(sanitizedReturnTo)}`;

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: ensuredStripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/upgrade?checkout=success&${checkoutReturnQuery}`,
      cancel_url: `${siteUrl}/upgrade?checkout=cancel&${checkoutReturnQuery}`,
      client_reference_id: session.userId,
      metadata: { user_id: session.userId, return_to: sanitizedReturnTo }
    });
  } catch (error) {
    console.error('stripe checkout session create error', error);
    throw new BillingStripeRouteError(502, 'checkout_failed');
  }

  if (!checkoutSession.url) {
    throw new BillingStripeRouteError(500, 'stripe_session_missing_url');
  }

  return {
    url: checkoutSession.url
  };
}

export async function createStripePortalSession(session: ResolvedViewerSession) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);

  const admin = createSupabaseAdminClient();
  const stripeCustomerId = await loadStripeCustomerMapping(admin, session.userId);
  if (!stripeCustomerId) {
    throw new BillingStripeRouteError(404, 'no_stripe_customer');
  }

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${getSiteUrl()}/account`
    });
    return {
      url: portal.url
    };
  } catch (error) {
    console.error('stripe billing portal error', error);
    throw new BillingStripeRouteError(502, 'failed_to_load_billing');
  }
}

export async function createStripeSetupIntent(session: ResolvedViewerSession) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);

  const admin = createSupabaseAdminClient();
  const stripeCustomerId = await ensureStripeCustomer(admin, session);

  let intent;
  try {
    intent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      usage: 'off_session',
      metadata: { user_id: session.userId, source: 'billing_update' }
    });
  } catch (error) {
    console.error('stripe setup intent create error', error);
    throw new BillingStripeRouteError(502, 'failed_to_init_billing');
  }

  if (!intent.client_secret) {
    throw new BillingStripeRouteError(500, 'client_secret_missing');
  }

  return {
    clientSecret: intent.client_secret
  };
}

export async function setStripeDefaultPaymentMethod(
  session: ResolvedViewerSession,
  {
    paymentMethod
  }: {
    paymentMethod: string;
  }
) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);

  const normalizedPaymentMethod = paymentMethod.trim();
  if (!normalizedPaymentMethod) {
    throw new BillingStripeRouteError(400, 'invalid_payment_method');
  }

  const admin = createSupabaseAdminClient();
  const stripeCustomerId = await loadStripeCustomerMapping(admin, session.userId);
  const subscriptionLookup = await loadSubscriptionLookup(admin, session.userId);

  if (!stripeCustomerId) {
    throw new BillingStripeRouteError(400, 'no_stripe_customer');
  }

  try {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: normalizedPaymentMethod }
    });

    if (subscriptionLookup.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscriptionLookup.stripeSubscriptionId, {
        default_payment_method: normalizedPaymentMethod
      });
    }
  } catch (error) {
    console.error('stripe default payment method update error', error);
    throw new BillingStripeRouteError(502, 'failed_to_load');
  }

  return {
    ok: true as const
  };
}

export async function cancelStripeSubscription(session: ResolvedViewerSession) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);
  return mutateStripeSubscription({
    session,
    cancelAtPeriodEnd: true,
    eventType: 'subscription_cancel_requested'
  });
}

export async function resumeStripeSubscription(session: ResolvedViewerSession) {
  assertBillingPrereqs();
  assertAuthenticatedSession(session);
  return mutateStripeSubscription({
    session,
    cancelAtPeriodEnd: false,
    eventType: 'subscription_resumed'
  });
}
