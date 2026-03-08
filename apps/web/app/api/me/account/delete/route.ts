import { NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/api/stripe';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { recordBillingEvent } from '@/lib/server/billingEvents';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  confirm: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (parsed.data.confirm.trim().toUpperCase() !== 'DELETE') {
    return NextResponse.json({ error: 'confirm_required' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: subscription, error: subError } = await admin
    .from('subscriptions')
    .select('status, stripe_subscription_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (subError) {
    console.error('account delete subscription check error', subError);
    return NextResponse.json({ error: 'failed_to_check_subscription' }, { status: 500 });
  }

  if (isSubscriptionActive(subscription)) {
    if (!isStripeConfigured() || !subscription?.stripe_subscription_id) {
      return NextResponse.json({ error: 'active_subscription' }, { status: 409 });
    }

    try {
      const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true });
      const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
      await recordBillingEvent({
        admin,
        userId: user.id,
        email: user.email ?? null,
        eventType: 'subscription_cancel_requested',
        source: 'account_delete',
        stripeSubscriptionId: updated.id,
        status: updated.status || 'unknown',
        cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
        currentPeriodEnd,
        sendEmail: false
      });
    } catch (err: any) {
      console.error('account delete stripe cancel error', err);
      return NextResponse.json({ error: 'failed_to_cancel_subscription' }, { status: 502 });
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('account delete error', deleteError);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
