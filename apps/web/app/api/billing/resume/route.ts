import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { mirrorStripeEntitlement } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { recordBillingEvent } from '@/lib/server/billingEvents';
export const dynamic = 'force-dynamic';

const BILLABLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: subscription, error } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('subscription lookup error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  let stripeSubscriptionId = subscription?.stripe_subscription_id ?? null;

  if (!stripeSubscriptionId) {
    const { data: mapping, error: mappingError } = await admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (mappingError) {
      console.error('stripe customer mapping error', mappingError);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }

    if (!mapping?.stripe_customer_id) {
      return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
    }

    let list;
    try {
      list = await stripe.subscriptions.list({
        customer: mapping.stripe_customer_id,
        status: 'all',
        limit: 10,
        expand: ['data.items.data.price']
      });
    } catch (err) {
      console.error('stripe subscription lookup error', err);
      return NextResponse.json({ error: 'stripe_lookup_failed' }, { status: 502 });
    }

    const billable = list.data
      .filter((sub) => BILLABLE_STATUSES.has(String(sub.status || '').toLowerCase()))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const candidate = billable.find((sub) => Boolean(sub.cancel_at_period_end)) ?? billable[0];

    stripeSubscriptionId = candidate?.id ?? null;
  }

  if (!stripeSubscriptionId) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  let updated;
  try {
    updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
      expand: ['items.data.price']
    });
  } catch (err) {
    console.error('stripe subscription resume error', err);
    return NextResponse.json({ error: 'stripe_update_failed' }, { status: 502 });
  }

  const stripePriceId = updated.items?.data?.[0]?.price?.id || 'unknown';
  const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
  const cancelAtPeriodEnd = Boolean(updated.cancel_at_period_end);

  await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      stripe_subscription_id: updated.id,
      stripe_price_id: stripePriceId,
      status: updated.status || 'unknown',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );

  await mirrorStripeEntitlement(admin, {
    userId: user.id,
    stripeCustomerId: typeof updated.customer === 'string' ? updated.customer : null,
    subscription: updated,
    eventType: 'subscription_resumed'
  });

  await recordBillingEvent({
    admin,
    userId: user.id,
    email: user.email ?? null,
    eventType: 'subscription_resumed',
    source: 'self_serve',
    stripeSubscriptionId: updated.id,
    status: updated.status || 'unknown',
    cancelAtPeriodEnd,
    currentPeriodEnd,
    sendEmail: true
  });

  return NextResponse.json({
    status: updated.status,
    cancelAtPeriodEnd,
    currentPeriodEnd
  });
}
