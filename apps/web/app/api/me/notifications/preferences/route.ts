import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { isTwilioSmsConfigured, sendSmsMessage } from '@/lib/notifications/twilio';
import { buildSmsOptInConfirmationMessage } from '@/lib/notifications/smsProgram';
import { logSmsConsentEvent } from '@/lib/server/smsConsentEvents';
import { loadSmsSystemEnabled } from '@/lib/server/smsSystem';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_PREFS = {
  email_enabled: true,
  sms_enabled: false,
  push_enabled: false,
  launch_day_email_enabled: false,
  launch_day_email_providers: [] as string[],
  launch_day_email_states: [] as string[],
  quiet_hours_enabled: false,
  quiet_start_local: null,
  quiet_end_local: null,
  sms_phone_e164: null,
  sms_verified: false
};

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ preferences: DEFAULT_PREFS, smsSystemEnabled: false, source: 'stub' }, { status: 200 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle();
  if (error) {
    console.error('preferences fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const smsSystemEnabled = await loadSmsSystemEnabled();
  return NextResponse.json({ preferences: data ?? DEFAULT_PREFS, smsSystemEnabled, source: data ? 'db' : 'default' });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const timeSchema = z.string().regex(/^\d{2}:\d{2}$/).optional();
  const schema = z.object({
    email_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    push_enabled: z.boolean().optional(),
    sms_consent: z.boolean().optional(),
    launch_day_email_enabled: z.boolean().optional(),
    launch_day_email_providers: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
    launch_day_email_states: z.array(z.string().trim().min(1).max(40)).max(80).optional(),

    quiet_hours_enabled: z.boolean().optional(),
    quiet_start_local: timeSchema,
    quiet_end_local: timeSchema,
  });

  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { sms_consent, ...prefsUpdate } = parsed.data;

  const wantsSms = prefsUpdate.sms_enabled === true;
  const wantsLaunchDayEmail = prefsUpdate.launch_day_email_enabled === true;
  const wantsPush = prefsUpdate.push_enabled === true;
  if (wantsSms || wantsLaunchDayEmail || wantsPush) {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });
    }

    const viewer = await getViewerTier();
    if (!viewer.isAuthed || !viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (viewer.tier !== 'premium') return NextResponse.json({ error: 'subscription_required' }, { status: 402 });
  }

  if (Array.isArray(prefsUpdate.launch_day_email_providers)) {
    prefsUpdate.launch_day_email_providers = normalizeStringList(prefsUpdate.launch_day_email_providers, 80);
  }
  if (Array.isArray(prefsUpdate.launch_day_email_states)) {
    prefsUpdate.launch_day_email_states = normalizeStringList(prefsUpdate.launch_day_email_states, 80);
  }

  const { data: existing } = await supabase
    .from('notification_preferences')
    .select('sms_verified, sms_phone_e164, sms_enabled, sms_opt_in_at, sms_opt_out_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const providedPhone = existing?.sms_phone_e164 ?? null;
  if (prefsUpdate.sms_enabled === true && !providedPhone) {
    return NextResponse.json({ error: 'phone_required' }, { status: 400 });
  }

  if (prefsUpdate.sms_enabled === true && !existing?.sms_verified) {
    return NextResponse.json({ error: 'sms_not_verified' }, { status: 409 });
  }

  const prevSmsEnabled = !!existing?.sms_enabled;
  const nextSmsEnabled = prefsUpdate.sms_enabled;
  const nowIso = new Date().toISOString();
  const prevOptInAt = existing?.sms_opt_in_at ?? null;

  const shouldStampOptIn = nextSmsEnabled === true && !prevSmsEnabled;
  const shouldStampOptOut = nextSmsEnabled === false && prevSmsEnabled;
  const shouldClearOptOut = nextSmsEnabled === true;

  if (shouldStampOptIn) {
    const smsSystemEnabled = await loadSmsSystemEnabled();
    if (!smsSystemEnabled) {
      return NextResponse.json({ error: 'sms_system_disabled' }, { status: 503 });
    }
  }

  if (shouldStampOptIn && sms_consent !== true) {
    return NextResponse.json({ error: 'sms_consent_required' }, { status: 400 });
  }

  const payload = {
    user_id: user.id,
    ...prefsUpdate,
    ...(shouldStampOptIn
      ? {
          sms_opt_in_at: nowIso
        }
      : {}),
    ...(shouldStampOptOut
      ? {
          sms_opt_out_at: nowIso
        }
      : {}),
    ...(shouldClearOptOut
      ? {
          sms_opt_out_at: null
        }
      : {}),
    updated_at: nowIso
  };

  const { data, error } = await supabase.from('notification_preferences').upsert(payload, { onConflict: 'user_id' }).select('*').single();

  if (error) {
    console.error('preferences upsert error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  if (shouldStampOptIn && providedPhone) {
    await logSmsConsentEvent(supabase, {
      userId: user.id,
      phoneE164: providedPhone,
      action: 'web_opt_in',
      request,
      source: 'preferences_api'
    });

    if (isTwilioSmsConfigured()) {
      try {
        await sendSmsMessage(providedPhone, buildSmsOptInConfirmationMessage());
      } catch (err) {
        const code = typeof (err as any)?.code === 'number' ? (err as any).code : null;
        const message = String((err as any)?.message || '');
        const isOptedOut = code === 21610 || message.toLowerCase().includes('has replied with stop') || message.toLowerCase().includes('opted out');
        if (isOptedOut) {
          const rollbackNow = new Date().toISOString();
          await supabase
            .from('notification_preferences')
            .update({ sms_enabled: false, sms_opt_in_at: prevOptInAt, sms_opt_out_at: rollbackNow, updated_at: rollbackNow })
            .eq('user_id', user.id);
          await logSmsConsentEvent(supabase, {
            userId: user.id,
            phoneE164: providedPhone,
            action: 'twilio_opt_out_error',
            request,
            source: 'preferences_api',
            meta: { code, message }
          });
          return NextResponse.json(
            { error: 'sms_reply_start_required', message: 'This number is opted out (STOP). Reply START from your phone to resubscribe, then try again.' },
            { status: 409 }
          );
        }
        console.warn('sms opt-in confirmation send warning', err);
      }
    }
  }

  if (shouldStampOptOut && providedPhone) {
    await logSmsConsentEvent(supabase, {
      userId: user.id,
      phoneE164: providedPhone,
      action: 'web_opt_out',
      request,
      source: 'preferences_api'
    });
  }

  return NextResponse.json({ preferences: data });
}

function normalizeStringList(values: string[], max: number) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .slice(0, max)
    .sort((a, b) => a.localeCompare(b));
}
