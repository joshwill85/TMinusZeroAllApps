import { NextResponse } from 'next/server';
import { NATIVE_MOBILE_PUSH_ONLY_ERROR, NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE } from '@/lib/notifications/pushOnly';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_PREFS = {
  email_enabled: false,
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
  return NextResponse.json({ preferences: DEFAULT_PREFS, smsSystemEnabled: false, source: 'retired' }, { status: 200 });
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: NATIVE_MOBILE_PUSH_ONLY_ERROR, message: NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE }, { status: 410 });
}
