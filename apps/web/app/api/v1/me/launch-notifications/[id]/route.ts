import { NextResponse } from 'next/server';
import { loadLaunchNotificationPreferencePayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';

export const dynamic = 'force-dynamic';

function readChannel(request: Request) {
  const channel = new URL(request.url).searchParams.get('channel');
  return channel === 'sms' ? 'sms' : 'push';
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const parsedLaunch = parseLaunchParam(params.id);
    if (!parsedLaunch) {
      return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });
    }
    const session = await resolveViewerSession(request);
    const payload = await loadLaunchNotificationPreferencePayload(session, parsedLaunch.launchId, readChannel(request));
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
