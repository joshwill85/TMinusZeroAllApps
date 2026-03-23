import { NextResponse } from 'next/server';
import {
  loadMobilePushLaunchPreferencePayload,
  MobilePushRouteError,
  upsertMobilePushLaunchPreferencePayload
} from '@/lib/server/v1/mobilePushV2';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadMobilePushLaunchPreferencePayload(session, params.id, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push launch preference failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await upsertMobilePushLaunchPreferencePayload(session, params.id, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push launch preference save failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
