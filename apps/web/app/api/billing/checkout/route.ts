import { NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe, PRICE_PRO_MONTHLY } from '@/lib/api/stripe';
import { isBillableSubscriptionStatus, isPaidSubscriptionStatus, sanitizeReturnToPath } from '@/lib/billing/shared';
import { mirrorStripeCustomerMapping } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    returnTo: z.string().optional()
  })
  .passthrough()
  .optional();

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const returnTo = sanitizeReturnToPath(parsed.data?.returnTo, '/account');

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const [{ data: mapping, error: mappingError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle(),
    admin.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle()
  ]);

  if (mappingError) {
    console.error('stripe customer mapping read error', mappingError);
    return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
  }
  if (subscriptionError) {
    console.error('subscription read error', subscriptionError);
    return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
  }

  const dbStatus = subscription?.status ?? null;

  if (mapping?.stripe_customer_id) {
    let existingBillableSubscription: { id: string; status: string | null } | null = null;

    try {
      const list = await stripe.subscriptions.list({
        customer: mapping.stripe_customer_id,
        status: 'all',
        limit: 10
      });

      const candidate = list.data
        .filter((item) => isBillableSubscriptionStatus(item.status))
        .sort((left, right) => (right.created ?? 0) - (left.created ?? 0))[0];

      if (candidate) {
        existingBillableSubscription = {
          id: candidate.id,
          status: candidate.status ?? null
        };
      }
    } catch (err) {
      console.error('stripe subscription lookup error', err);
      return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 502 });
    }

    if (existingBillableSubscription) {
      return NextResponse.json(
        {
          error: isPaidSubscriptionStatus(existingBillableSubscription.status) ? 'already_subscribed' : 'payment_issue',
          status: existingBillableSubscription.status,
          returnTo
        },
        { status: 409 }
      );
    }

    if (isBillableSubscriptionStatus(dbStatus)) {
      console.warn('billing checkout stale subscription status', {
        userId: user.id,
        stripeCustomerId: mapping.stripe_customer_id,
        dbStatus
      });
    }
  } else if (isBillableSubscriptionStatus(dbStatus)) {
    return NextResponse.json(
      {
        error: isPaidSubscriptionStatus(dbStatus) ? 'already_subscribed' : 'payment_issue',
        status: dbStatus,
        returnTo
      },
      { status: 409 }
    );
  }

  let stripeCustomerId = mapping?.stripe_customer_id ?? null;
  if (!stripeCustomerId) {
    try {
      stripeCustomerId = (
        await stripe.customers.create({
          email: user.email,
          metadata: { user_id: user.id }
        })
      ).id;
    } catch (err) {
      console.error('stripe customer create error', err);
      return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 502 });
    }
  }

  if (!mapping?.stripe_customer_id) {
    const { error: upsertError } = await admin
      .from('stripe_customers')
      .upsert({ user_id: user.id, stripe_customer_id: stripeCustomerId }, { onConflict: 'user_id' });
    if (upsertError) {
      console.error('stripe customer mapping upsert error', upsertError);
      return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
    }

    await mirrorStripeCustomerMapping(admin, {
      userId: user.id,
      stripeCustomerId,
      metadata: {
        source: 'checkout'
      }
    });
  }

  const siteUrl = getSiteUrl();
  const priceId = PRICE_PRO_MONTHLY;
  if (!priceId || priceId === 'price_placeholder') {
    return NextResponse.json({ error: 'stripe_price_missing' }, { status: 501 });
  }

  const checkoutReturnQuery = `return_to=${encodeURIComponent(returnTo)}`;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/upgrade?checkout=success&${checkoutReturnQuery}`,
      cancel_url: `${siteUrl}/upgrade?checkout=cancel&${checkoutReturnQuery}`,
      client_reference_id: user.id,
      metadata: { user_id: user.id, return_to: returnTo }
    });
  } catch (err) {
    console.error('stripe checkout session create error', err);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 });
  }

  if (!session.url) {
    return NextResponse.json({ error: 'stripe_session_missing_url' }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
