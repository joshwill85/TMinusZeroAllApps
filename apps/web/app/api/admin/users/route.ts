import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { stripe } from '@/lib/api/stripe';
import { recordBillingEvent } from '@/lib/server/billingEvents';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['user', 'admin'])
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    userId: z.string().min(1),
    action: z.literal('reset_password')
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('suspend'),
    banDuration: z.string().min(1)
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('unsuspend')
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('delete'),
    confirm: z.string().min(1)
  })
]);

const requestSchema = z.union([updateSchema, actionSchema]);

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
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200, page: 1 });
  if (usersError || !usersData) {
    console.error('admin users list error', usersError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const userIds = usersData.users.map((u) => u.id);
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('user_id, role, email, created_at, first_name, last_name')
    .in('user_id', userIds);
  if (profilesError) {
    console.error('admin profiles fetch error', profilesError);
  }

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from('subscriptions')
    .select('user_id, status, current_period_end')
    .in('user_id', userIds);
  if (subscriptionsError) {
    console.error('admin subscriptions fetch error', subscriptionsError);
  }

  const profileMap = new Map<
    string,
    {
      role?: string;
      email?: string | null;
      created_at?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    }
  >();
  (profiles || []).forEach((p) => {
    profileMap.set(p.user_id, {
      role: p.role ?? 'user',
      email: p.email ?? null,
      created_at: p.created_at ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null
    });
  });

  const subscriptionMap = new Map<string, { status?: string | null; current_period_end?: string | null }>();
  (subscriptions || []).forEach((sub) => {
    subscriptionMap.set(sub.user_id, { status: sub.status ?? null, current_period_end: sub.current_period_end ?? null });
  });

  const users = usersData.users.map((u) => {
    const profile = profileMap.get(u.id);
    const subscription = subscriptionMap.get(u.id);
    const isPaid = isSubscriptionActive(subscription);
    const meta = (u.user_metadata || {}) as Record<string, any>;
    const firstName = profile?.first_name ?? (typeof meta.first_name === 'string' ? meta.first_name : null);
    const lastName = profile?.last_name ?? (typeof meta.last_name === 'string' ? meta.last_name : null);
    const role = profile?.role === 'admin' ? 'admin' : 'user';
    const status = role === 'admin' ? 'admin' : isPaid ? 'paid' : 'free';
    return {
      user_id: u.id,
      email: profile?.email ?? u.email ?? null,
      role,
      created_at: profile?.created_at ?? u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
      first_name: firstName,
      last_name: lastName,
      is_paid: isPaid,
      status
    };
  });

  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
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

  const json = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });

  const admin = createSupabaseAdminClient();
  if ('action' in parsed.data) {
    if (parsed.data.action === 'reset_password') {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
      if (userError || !userData?.user) {
        console.error('admin get user error', userError);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }
      const email = userData.user.email ?? null;
      if (!email) {
        return NextResponse.json({ error: 'missing_email' }, { status: 409 });
      }
      const redirectTo = `${getSiteUrl()}/auth/reset-password`;
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error('admin reset password error', error);
        return NextResponse.json({ error: 'failed_to_send_reset' }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === 'suspend') {
      const { data: userData, error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
        ban_duration: parsed.data.banDuration
      });
      if (error) {
        console.error('admin suspend error', error);
        return NextResponse.json({ error: 'failed_to_suspend' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, banned_until: (userData?.user as { banned_until?: string | null })?.banned_until ?? null });
    }

    if (parsed.data.action === 'unsuspend') {
      const { data: userData, error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
        ban_duration: 'none'
      });
      if (error) {
        console.error('admin unsuspend error', error);
        return NextResponse.json({ error: 'failed_to_unsuspend' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, banned_until: (userData?.user as { banned_until?: string | null })?.banned_until ?? null });
    }

    if (parsed.data.action === 'delete') {
      if (parsed.data.confirm.trim().toUpperCase() !== 'DELETE') {
        return NextResponse.json({ error: 'confirm_required' }, { status: 400 });
      }

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
      if (userError || !userData?.user) {
        console.error('admin get user error', userError);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }

      const { data: subscription, error: subError } = await admin
        .from('subscriptions')
        .select('status, stripe_subscription_id')
        .eq('user_id', parsed.data.userId)
        .maybeSingle();

      if (subError) {
        console.error('admin delete subscription check error', subError);
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
            userId: parsed.data.userId,
            email: userData.user.email ?? null,
            eventType: 'subscription_cancel_requested',
            source: 'account_delete',
            stripeSubscriptionId: updated.id,
            status: updated.status || 'unknown',
            cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
            currentPeriodEnd,
            sendEmail: false
          });
        } catch (err: any) {
          console.error('admin delete stripe cancel error', err);
          return NextResponse.json({ error: 'failed_to_cancel_subscription' }, { status: 502 });
        }
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(parsed.data.userId);
      if (deleteError) {
        console.error('admin delete user error', deleteError);
        return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unsupported_action' }, { status: 400 });
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (userError) {
    console.error('admin get user error', userError);
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const email = userData?.user?.email ?? null;
  const { error } = await admin
    .from('profiles')
    .upsert(
      { user_id: parsed.data.userId, email, role: parsed.data.role, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('admin role update error', error);
    return NextResponse.json({ error: 'failed_to_update' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
