import { NextResponse } from 'next/server';
import { NATIVE_MOBILE_PUSH_ONLY_ERROR, NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE } from '@/lib/notifications/pushOnly';

export const dynamic = 'force-dynamic';

const DEFAULT_PREFS = {
  mode: 't_minus' as const,
  timezone: 'UTC',
  t_minus_minutes: [] as number[],
  local_times: [] as string[],
  notify_status_change: false,
  notify_net_change: false
};

function parseChannel(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('channel') || '').trim().toLowerCase();
  return raw === 'push' ? 'push' : 'sms';
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  void params;
  const channel = parseChannel(request);

  if (channel === 'push') {
    return NextResponse.json({
      channel: 'push',
      preferences: DEFAULT_PREFS,
      push: { enabled: false, subscribed: false },
      source: 'retired'
    });
  }

  return NextResponse.json({
    channel: 'sms',
    preferences: DEFAULT_PREFS,
    sms: { enabled: false, verified: false, phone: null },
    smsSystemEnabled: false,
    source: 'retired'
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  void request;
  void params;
  return NextResponse.json({ error: NATIVE_MOBILE_PUSH_ONLY_ERROR, message: NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE }, { status: 410 });
}
