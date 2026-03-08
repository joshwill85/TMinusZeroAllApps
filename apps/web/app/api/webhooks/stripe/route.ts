import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { stripe } from '@/lib/api/stripe';
import { mirrorStripeCustomerMapping, mirrorStripeEntitlement } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isStripeWebhookConfigured, isSupabaseAdminConfigured } from '@/lib/server/env';

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
    await admin.from('webhook_events').insert({
      source: 'stripe',
      payload_hash: payloadHash,
      processed: false,
      error: lastError?.message || 'signature_verification_failed'
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const eventId = typeof event?.id === 'string' ? event.id : null;
  if (!eventId) {
    await admin.from('webhook_events').insert({
      source: 'stripe',
      payload_hash: payloadHash,
      processed: false,
      error: 'missing_event_id'
    });
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  }

  const webhookRowId = await createOrGetWebhookEventRowId(admin, {
    source: 'stripe',
    eventId,
    payloadHash
  });

  if (!webhookRowId.id) {
    return NextResponse.json({ error: 'failed_to_log_webhook_event' }, { status: 500 });
  }

  if (webhookRowId.supportsEventId) {
    const existingProcessed = await wasWebhookEventProcessed(admin, { source: 'stripe', eventId });
    if (existingProcessed) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    await handleStripeEvent(admin, event);
    const { error: processedUpdateError } = await admin.from('webhook_events').update({ processed: true, error: null }).eq('id', webhookRowId.id);
    if (processedUpdateError) {
      throw processedUpdateError;
    }
  } catch (err: any) {
    console.error('stripe webhook processing error', err);
    await admin
      .from('webhook_events')
      .update({ processed: false, error: err?.message || 'processing_failed' })
      .eq('id', webhookRowId.id);
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function createOrGetWebhookEventRowId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    source,
    eventId,
    payloadHash
  }: {
    source: string;
    eventId: string;
    payloadHash: string;
  }
): Promise<{ id: number | null; supportsEventId: boolean }> {
  const insertRes = await admin
    .from('webhook_events')
    .insert({ source, event_id: eventId, payload_hash: payloadHash, processed: false })
    .select('id')
    .maybeSingle();

  if (!insertRes.error && insertRes.data?.id != null) {
    return { id: Number(insertRes.data.id), supportsEventId: true };
  }

  const missingEventIdColumn =
    insertRes.error &&
    String(insertRes.error?.message || '').toLowerCase().includes('column') &&
    String(insertRes.error?.message || '').toLowerCase().includes('event_id') &&
    String(insertRes.error?.message || '').toLowerCase().includes('does not exist');
  if (missingEventIdColumn) {
    const legacyRes = await admin
      .from('webhook_events')
      .insert({ source, payload_hash: payloadHash, processed: false })
      .select('id')
      .maybeSingle();

    if (legacyRes.error) {
      console.error('webhook_events legacy insert error', legacyRes.error);
      return { id: null, supportsEventId: false };
    }

    return { id: legacyRes.data?.id != null ? Number(legacyRes.data.id) : null, supportsEventId: false };
  }

  const code = String((insertRes.error as any)?.code || '');
  const isDuplicate = code === '23505' || String(insertRes.error?.message || '').toLowerCase().includes('duplicate');
  if (!isDuplicate) {
    console.error('webhook_events insert error', insertRes.error);
    return { id: null, supportsEventId: true };
  }

  const existingRes = await admin.from('webhook_events').select('id').eq('source', source).eq('event_id', eventId).maybeSingle();
  if (existingRes.error) {
    console.error('webhook_events lookup error', existingRes.error);
    return { id: null, supportsEventId: true };
  }
  return { id: existingRes.data?.id != null ? Number(existingRes.data.id) : null, supportsEventId: true };
}

async function wasWebhookEventProcessed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  { source, eventId }: { source: string; eventId: string }
): Promise<boolean> {
  const { data, error } = await admin.from('webhook_events').select('processed').eq('source', source).eq('event_id', eventId).maybeSingle();
  if (error) {
    console.warn('webhook_events processed lookup warning', error);
    return false;
  }
  return data?.processed === true;
}

async function handleStripeEvent(admin: ReturnType<typeof createSupabaseAdminClient>, event: any) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as any;
      const stripeCustomerId = session.customer as string | null;
      const stripeSubscriptionId = session.subscription as string | null;
      const userId = (session.metadata?.user_id as string | undefined) || (session.client_reference_id as string | undefined);

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
