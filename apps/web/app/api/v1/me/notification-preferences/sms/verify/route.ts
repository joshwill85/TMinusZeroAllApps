import { NextResponse } from 'next/server';
import { MobileApiRouteError, startSmsVerificationPayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await startSmsVerificationPayload(session, request);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 sms verification start failed', error);
    return NextResponse.json({ error: 'sms_verification_failed' }, { status: 500 });
  }
}
