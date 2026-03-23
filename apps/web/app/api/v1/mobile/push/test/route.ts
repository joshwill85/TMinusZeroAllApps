import { NextResponse } from 'next/server';
import { enqueueMobilePushTestPayload, MobilePushRouteError } from '@/lib/server/v1/mobilePushV2';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await enqueueMobilePushTestPayload(session, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push test failed', error);
    return NextResponse.json({ error: 'failed_to_queue' }, { status: 500 });
  }
}
