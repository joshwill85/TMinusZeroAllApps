import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

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

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: mapping, error } = await admin
    .from('tipjar_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('tipjar customer mapping error', error);
    return NextResponse.json({ error: 'failed_to_load_tipjar_billing' }, { status: 500 });
  }

  if (!mapping?.stripe_customer_id) {
    return NextResponse.json({ error: 'no_tipjar_customer' }, { status: 400 });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: mapping.stripe_customer_id,
    return_url: `${getSiteUrl()}/account`
  });

  return NextResponse.json({ url: portal.url });
}

