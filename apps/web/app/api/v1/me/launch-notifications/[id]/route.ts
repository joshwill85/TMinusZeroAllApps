import { NextResponse } from 'next/server';
import { loadLaunchNotificationPreferencePayload, MobileApiRouteError, updateLaunchNotificationPreferencePayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  void request;
  try {
    const parsedLaunch = parseLaunchParam(params.id);
    if (!parsedLaunch) {
      return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });
    }
    const session = await resolveViewerSession(request);
    const payload = await loadLaunchNotificationPreferencePayload(session, parsedLaunch.launchId);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 launch notifications failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsedLaunch = parseLaunchParam(params.id);
    if (!parsedLaunch) {
      return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });
    }
    const session = await resolveViewerSession(request);
    const payload = await updateLaunchNotificationPreferencePayload(session, parsedLaunch.launchId, request);
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
    console.error('v1 launch notifications update failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
