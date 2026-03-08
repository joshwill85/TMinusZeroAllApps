import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import {
  isStripeConfigured,
  isStripePriceConfigured,
  isStripePublishableConfigured,
  isStripeWebhookConfigured,
  isSupabaseAdminConfigured,
  isSupabaseConfigured
} from '@/lib/server/env';

export const dynamic = 'force-dynamic';

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  canceled: 4,
  incomplete: 5,
  incomplete_expired: 6,
  paused: 7,
  none: 8
};

export async function GET() {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [profilesRes, subscriptionsRes, customersRes, webhookLastRes, webhookLastSuccessRes, webhookPendingRes, webhookFailedRes] =
    await Promise.all([
    admin.from('profiles').select('user_id,email,role,created_at').order('created_at', { ascending: false }).limit(500),
    admin
      .from('subscriptions')
      .select('user_id,stripe_subscription_id,stripe_price_id,status,current_period_end,cancel_at_period_end,updated_at'),
    admin.from('stripe_customers').select('user_id,stripe_customer_id'),
    admin
      .from('webhook_events')
      .select('received_at,processed,error')
      .eq('source', 'stripe')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('webhook_events')
      .select('received_at')
      .eq('source', 'stripe')
      .eq('processed', true)
      .is('error', null)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'stripe')
      .eq('processed', false),
    admin
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'stripe')
      .not('error', 'is', null)
      .gte('received_at', cutoffIso)
  ]);

  const anyError = [
    profilesRes.error,
    subscriptionsRes.error,
    customersRes.error,
    webhookLastRes.error,
    webhookLastSuccessRes.error,
    webhookPendingRes.error,
    webhookFailedRes.error
  ].filter(Boolean);

  if (anyError.length) {
    console.error('admin billing errors', anyError);
  }

  const profiles = profilesRes.data ?? [];
  const subscriptions = subscriptionsRes.data ?? [];
  const customers = customersRes.data ?? [];
  const subscriptionMap = new Map(subscriptions.map((sub) => [sub.user_id, sub]));
  const customerMap = new Map(customers.map((customer) => [customer.user_id, customer.stripe_customer_id]));
  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY || '';
  const priceConfigured = isStripePriceConfigured();

  const billingCustomers = profiles
    .map((row) => {
      const subscription = subscriptionMap.get(row.user_id);
      const stripePriceId = subscription?.stripe_price_id ?? null;
      const planLabel = stripePriceId
        ? stripePriceId === proPriceId && priceConfigured
          ? 'Premium monthly'
          : 'Custom'
        : 'None';

      return {
        userId: row.user_id,
        email: row.email ?? null,
        role: row.role === 'admin' ? 'admin' : 'user',
        stripeCustomerId: customerMap.get(row.user_id) ?? null,
        stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
        stripePriceId,
        planLabel,
        status: subscription?.status ?? 'none',
        cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
        currentPeriodEnd: subscription?.current_period_end ?? null,
        updatedAt: subscription?.updated_at ?? null
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

  const webhook = {
    lastReceivedAt: webhookLastRes.data?.received_at ?? null,
    lastSuccessAt: webhookLastSuccessRes.data?.received_at ?? null,
    lastError: webhookLastRes.data?.error ?? null,
    pendingCount: webhookPendingRes.count ?? 0,
    failedLast24h: webhookFailedRes.count ?? 0
  };

  const config = {
    stripeSecret: isStripeConfigured(),
    stripePublishable: isStripePublishableConfigured(),
    stripeWebhook: isStripeWebhookConfigured(),
    stripePrice: isStripePriceConfigured()
  };

  return NextResponse.json(
    { config, summary, webhook, customers: billingCustomers },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
