import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

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

  let paymentMethod = '';
  try {
    const body = await request.json();
    paymentMethod = String(body?.paymentMethod || '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (!paymentMethod) {
    return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const [{ data: mapping, error: mappingError }, { data: subscription, error: subError }] = await Promise.all([
    admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle(),
    admin.from('subscriptions').select('stripe_subscription_id').eq('user_id', user.id).maybeSingle()
  ]);

  if (mappingError || subError) {
    console.error('stripe billing lookup error', mappingError || subError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  if (!mapping?.stripe_customer_id) {
    return NextResponse.json({ error: 'no_stripe_customer' }, { status: 400 });
  }

  await stripe.customers.update(mapping.stripe_customer_id, {
    invoice_settings: { default_payment_method: paymentMethod }
  });

  if (subscription?.stripe_subscription_id) {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      default_payment_method: paymentMethod
    });
  }

  return NextResponse.json({ ok: true });
}
