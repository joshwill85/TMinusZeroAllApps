import { NextResponse } from 'next/server';
import { NATIVE_MOBILE_PUSH_ONLY_ERROR, NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE } from '@/lib/notifications/pushOnly';
export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: NATIVE_MOBILE_PUSH_ONLY_ERROR, message: NATIVE_MOBILE_PUSH_ONLY_WEB_MESSAGE }, { status: 410 });
}
