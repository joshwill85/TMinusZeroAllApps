import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { stripe } from '@/lib/api/stripe';
import { mirrorStripeCustomerMapping, mirrorStripeEntitlement } from '@/lib/server/providerEntitlements';
import { markStripePremiumClaimVerified } from '@/lib/server/premiumClaims';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isStripeWebhookConfigured, isSupabaseAdminConfigured } from '@/lib/server/env';
import {
  createOrGetWebhookEventRecord,
  logWebhookEventFailure,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  wasWebhookEventProcessed
} from '@/lib/server/webhookEvents';

export async function POST(request: Request) {
  if (!isStripeConfigured() || !isStripeWebhookConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_stripe_signature' }, { status: 400 });
  }

  const body = await request.text();
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const admin = createSupabaseAdminClient();

  const webhookSecretRaw = process.env.STRIPE_WEBHOOK_SECRET || '';
  const webhookSecrets = webhookSecretRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  let event: any;
  let lastError: any;
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch (err: any) {
      lastError = err;
    }
  }

  if (!event) {
    await logWebhookEventFailure(admin, {
      source: 'stripe',
      payloadHash,
      error: lastError?.message || 'signature_verification_failed'
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const eventId = typeof event?.id === 'string' ? event.id : null;
  if (!eventId) {
    await logWebhookEventFailure(admin, {
      source: 'stripe',
      payloadHash,
      error: 'missing_event_id'
    });
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  }

  const webhookRow = await createOrGetWebhookEventRecord(admin, {
    source: 'stripe',
    eventId,
    payloadHash
  });

  if (!webhookRow.id) {
    return NextResponse.json({ error: 'failed_to_log_webhook_event' }, { status: 500 });
  }

  if (webhookRow.supportsEventId) {
    const existingProcessed = await wasWebhookEventProcessed(admin, { source: 'stripe', eventId });
    if (existingProcessed) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    await handleStripeEvent(admin, event);
    await markWebhookEventProcessed(admin, { id: webhookRow.id });
  } catch (err: any) {
    console.error('stripe webhook processing error', err);
    await markWebhookEventFailed(admin, {
      id: webhookRow.id,
      error: err?.message || 'processing_failed'
    });
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleStripeEvent(admin: ReturnType<typeof createSupabaseAdminClient>, event: any) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as any;
      const stripeCustomerId = session.customer as string | null;
      const stripeSubscriptionId = session.subscription as string | null;
      const userId = (session.metadata?.user_id as string | undefined) || (session.client_reference_id as string | undefined);

      await markStripePremiumClaimVerified(session).catch((error) => {
        console.error('stripe premium claim verification warning', error);
      });

      if (userId && stripeCustomerId) {
        const { error: customerUpsertError } = await admin
          .from('stripe_customers')
          .upsert({ user_id: userId, stripe_customer_id: stripeCustomerId }, { onConflict: 'user_id' });
        if (customerUpsertError) {
          throw customerUpsertError;
        }
        await mirrorStripeCustomerMapping(admin, {
          userId,
          stripeCustomerId,
          metadata: {
            source: 'checkout.session.completed'
          }
        });
      }

      if (stripeCustomerId && stripeSubscriptionId) {
        await upsertSubscriptionFromStripe(admin, stripeCustomerId, stripeSubscriptionId, {
          eventType: event.type,
          providerEventId: event.id
        });
      }

      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as any;
      const stripeCustomerId = subscription.customer as string | null;
      if (!stripeCustomerId) return;
      await upsertSubscriptionObject(admin, stripeCustomerId, subscription, {
        eventType: event.type,
        providerEventId: event.id
      });
      return;
    }

    default:
      return;
  }
}

async function upsertSubscriptionFromStripe(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  eventMeta?: {
    eventType?: string | null;
    providerEventId?: string | null;
  }
) {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['items.data.price'] });
  await upsertSubscriptionObject(admin, stripeCustomerId, subscription, eventMeta);
}

async function upsertSubscriptionObject(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  stripeCustomerId: string,
  subscription: any,
  eventMeta?: {
    eventType?: string | null;
    providerEventId?: string | null;
  }
) {
  const { data: mapping, error: mappingError } = await admin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (mappingError) throw mappingError;
  const userId = mapping?.user_id;
  if (!userId) return;

  const stripePriceId = subscription.items?.data?.[0]?.price?.id || 'unknown';
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error: subscriptionUpsertError } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: stripePriceId,
      status: subscription.status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );

  if (subscriptionUpsertError) {
    throw subscriptionUpsertError;
  }

  await mirrorStripeEntitlement(admin, {
    userId,
    stripeCustomerId,
    subscription,
    eventType: eventMeta?.eventType ?? null,
    providerEventId: eventMeta?.providerEventId ?? null
  });
}
