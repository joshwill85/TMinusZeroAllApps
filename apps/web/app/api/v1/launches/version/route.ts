import { NextResponse } from 'next/server';
import { LaunchFeedApiRouteError, loadVersionedLaunchFeedVersionPayload } from '@/lib/server/v1/launchFeedApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadVersionedLaunchFeedVersionPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof LaunchFeedApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 launches version failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
