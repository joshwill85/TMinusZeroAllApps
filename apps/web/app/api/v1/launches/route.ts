import { NextResponse } from 'next/server';
import { LaunchFeedApiRouteError, loadVersionedLaunchFeedPayload } from '@/lib/server/v1/launchFeedApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadVersionedLaunchFeedPayload(request);
    const cacheControl =
      payload.scope === 'public'
        ? 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
        : 'private, no-store';
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': cacheControl
      }
    });
  } catch (error) {
    if (error instanceof LaunchFeedApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 launches feed failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
