import { NextResponse } from 'next/server';
import { MobilePushRouteError, registerMobilePushDevicePayload, removeMobilePushDevicePayload } from '@/lib/server/v1/mobilePushV2';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await registerMobilePushDevicePayload(session, request);
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
    console.error('v1 mobile push device registration failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await removeMobilePushDevicePayload(session, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push device removal failed', error);
    return NextResponse.json({ error: 'failed_to_remove' }, { status: 500 });
  }
}
