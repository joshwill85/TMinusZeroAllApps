import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

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

  if (!user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: mapping, error: mappingError } = await admin
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (mappingError) {
    console.error('stripe customer mapping read error', mappingError);
    return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
  }

  const stripeCustomerId =
    mapping?.stripe_customer_id ??
    (
      await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id }
      })
    ).id;

  if (!mapping?.stripe_customer_id) {
    const { error: upsertError } = await admin
      .from('stripe_customers')
      .upsert({ user_id: user.id, stripe_customer_id: stripeCustomerId }, { onConflict: 'user_id' });
    if (upsertError) {
      console.error('stripe customer mapping upsert error', upsertError);
      return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
    }
  }

  const intent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    usage: 'off_session',
    metadata: { user_id: user.id, source: 'billing_update' }
  });

  if (!intent.client_secret) {
    return NextResponse.json({ error: 'client_secret_missing' }, { status: 500 });
  }

  return NextResponse.json({ clientSecret: intent.client_secret });
}
