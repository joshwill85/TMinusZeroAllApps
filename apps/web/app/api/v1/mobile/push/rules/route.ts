import { NextResponse } from 'next/server';
import { loadMobilePushRulesPayload, MobilePushRouteError, upsertMobilePushRulePayload } from '@/lib/server/v1/mobilePushV2';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadMobilePushRulesPayload(session, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push rules failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await upsertMobilePushRulePayload(session, request);
    return NextResponse.json(payload, {
      status: 201,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push rule save failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
