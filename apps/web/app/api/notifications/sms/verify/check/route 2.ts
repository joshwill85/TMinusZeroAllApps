import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { checkSmsVerification, isTwilioVerifyConfigured } from '@/lib/notifications/twilio';
import { parseUsPhone } from '@/lib/notifications/phone';
import { logSmsConsentEvent } from '@/lib/server/smsConsentEvents';
import { loadSmsSystemEnabled } from '@/lib/server/smsSystem';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/);

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  const smsSystemEnabled = await loadSmsSystemEnabled();
  if (!smsSystemEnabled) return NextResponse.json({ error: 'sms_system_disabled' }, { status: 503 });
  if (!isTwilioVerifyConfigured()) return NextResponse.json({ error: 'twilio_verify_not_configured' }, { status: 501 });

  const parsed = z
    .object({
      phone: z.string().optional(),
      phone_e164: z.string().optional(),
      code: codeSchema
    })
    .safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const rawPhone = parsed.data.phone ?? parsed.data.phone_e164 ?? '';
  const normalizedPhone = parseUsPhone(rawPhone)?.e164 ?? null;
  if (!normalizedPhone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed || !viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'subscription_required' }, { status: 402 });

  const supabase = createSupabaseServerClient();
  const userId = viewer.userId;

  const phone = normalizedPhone;
  try {
    const result = await checkSmsVerification(phone, parsed.data.code);
    if (result.status !== 'approved') {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
    }
  } catch (err) {
    console.error('sms verify check error', err);
    return NextResponse.json({ error: 'sms_verification_failed' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: userId,
        sms_phone_e164: phone,
        sms_verified: true,
        sms_enabled: false,
        sms_opt_in_at: null,
        updated_at: now
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('sms verify prefs update error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  await logSmsConsentEvent(supabase, {
    userId,
    phoneE164: phone,
    action: 'verify_approved',
    request,
    source: 'sms_verify_check_api'
  });

  return NextResponse.json({ status: 'verified' }, { status: 200 });
}
