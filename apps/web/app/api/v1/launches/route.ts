import { NextResponse } from 'next/server';
import { enforceLaunchFeedPayloadRateLimit, resolveLaunchFeedScopeFromRequest } from '@/lib/server/launchApiRateLimit';
import { getViewerTier } from '@/lib/server/viewerTier';
import { LaunchFeedApiRouteError, loadVersionedLaunchFeedPayload } from '@/lib/server/v1/launchFeedApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const scope = resolveLaunchFeedScopeFromRequest(request);
    const viewer = scope === 'public' ? null : await getViewerTier({ request, reconcileStripe: false });
    const rateLimited = await enforceLaunchFeedPayloadRateLimit(request, {
      scope,
      viewerId: viewer?.userId ?? null
    });
    if (rateLimited) {
      return rateLimited;
    }

    const payload = await loadVersionedLaunchFeedPayload(request, {
      viewer: viewer ?? undefined
    });
    const cacheControl =
      payload.scope === 'public'
        ? 'public, s-maxage=600, stale-while-revalidate=1800, stale-if-error=86400'
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
