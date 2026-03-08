import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  const db = admin ?? supabase;

  const [profileRes, prefsRes, privacyPrefsRes, launchPrefsRes, pushRes, subscriptionRes, smsConsentRes] = await Promise.all([
    db.from('profiles').select('user_id, email, role, first_name, last_name, timezone, created_at, updated_at').eq('user_id', user.id).maybeSingle(),
    db
      .from('notification_preferences')
      .select(
        'email_enabled, sms_enabled, push_enabled, quiet_hours_enabled, quiet_start_local, quiet_end_local, notify_t_minus_60, notify_t_minus_10, notify_t_minus_5, notify_liftoff, notify_status_change, notify_net_change, sms_phone_e164, sms_verified, sms_opt_in_at, sms_opt_out_at, created_at, updated_at'
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    db
      .from('privacy_preferences')
      .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    db
      .from('launch_notification_preferences')
      .select(
        'user_id, launch_id, channel, mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change, created_at, updated_at'
      )
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1000),
    db.from('push_subscriptions').select('id, endpoint, user_agent, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    db
      .from('subscriptions')
      .select('status, stripe_price_id, cancel_at_period_end, current_period_end, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    db
      .from('sms_consent_events')
      .select('id, phone_e164, action, source, consent_version, ip, user_agent, request_url, meta, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1000)
  ]);

  const stripeCustomerId = admin
    ? (
        await admin.from('stripe_customers').select('stripe_customer_id, created_at').eq('user_id', user.id).maybeSingle()
      ).data ?? null
    : null;

  const exportData = {
    generated_at: new Date().toISOString(),
    auth: {
      user_id: user.id,
      email: user.email ?? null,
      created_at: user.created_at ?? null,
      user_metadata: user.user_metadata ?? {}
    },
    profile: profileRes.data ?? null,
    notification_preferences: prefsRes.data ?? null,
    sms_consent_events: smsConsentRes.data ?? [],
    privacy_preferences: privacyPrefsRes.data ?? null,
    launch_notification_preferences: launchPrefsRes.data ?? [],
    push_subscriptions: pushRes.data ?? [],
    subscription: subscriptionRes.data ?? null,
    stripe_customer: stripeCustomerId,
    warnings: admin ? [] : ['stripe_customer_id_unavailable_without_service_role']
  };

  return NextResponse.json(exportData, { headers: { 'Cache-Control': 'private, no-store' } });
}
