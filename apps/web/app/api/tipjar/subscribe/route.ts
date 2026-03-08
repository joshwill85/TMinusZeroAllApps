import { NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/api/stripe';
import { BRAND_NAME } from '@/lib/brand';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 50_000;

const bodySchema = z.object({
  amount: z.coerce.number().int()
});

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
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const amount = parsed.data.amount;
  if (amount < MIN_TIP_CENTS || amount > MAX_TIP_CENTS) {
    return NextResponse.json({ error: 'amount_out_of_range' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: mapping, error: mappingError } = await admin
    .from('tipjar_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (mappingError) {
    console.error('tipjar customer mapping read error', mappingError);
    return NextResponse.json({ error: 'failed_to_init_tipjar_billing' }, { status: 500 });
  }

  const stripeCustomerId =
    mapping?.stripe_customer_id ??
    (
      await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id, source: 'tip_jar' }
      })
    ).id;

  if (!mapping?.stripe_customer_id) {
    const { error: upsertError } = await admin
      .from('tipjar_customers')
      .upsert({ user_id: user.id, stripe_customer_id: stripeCustomerId }, { onConflict: 'user_id' });
    if (upsertError) {
      console.error('tipjar customer mapping upsert error', upsertError);
      return NextResponse.json({ error: 'failed_to_init_tipjar_billing' }, { status: 500 });
    }
  }

  const siteUrl = getSiteUrl();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${BRAND_NAME} Tip Jar (Monthly)`,
            description: `Support ${BRAND_NAME}`
          },
          unit_amount: amount,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }
    ],
    success_url: `${siteUrl}/account?tip=success&tip_mode=monthly`,
    cancel_url: `${siteUrl}/account?tip=cancel&tip_mode=monthly`,
    subscription_data: {
      metadata: {
        source: 'tip_jar_monthly'
      }
    },
    metadata: {
      source: 'tip_jar_monthly'
    }
  });

  if (!session.url) {
    return NextResponse.json({ error: 'session_missing_url' }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
