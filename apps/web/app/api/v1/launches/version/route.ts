import { NextResponse } from 'next/server';
import { enforceLaunchFeedVersionRateLimit, resolveLaunchFeedScopeFromRequest } from '@/lib/server/launchApiRateLimit';
import { getViewerTier } from '@/lib/server/viewerTier';
import { resolveViewerSession } from '@/lib/server/viewerSession';
import { LaunchFeedApiRouteError, loadVersionedLaunchFeedVersionPayload } from '@/lib/server/v1/launchFeedApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const scope = resolveLaunchFeedScopeFromRequest(request);
    if (scope === 'watchlist') {
      return NextResponse.json({ error: 'unsupported_scope' }, { status: 400 });
    }

    const session = scope === 'public' ? null : await resolveViewerSession(request);
    const viewer = scope === 'public' ? null : await getViewerTier({ session: session ?? undefined, reconcileStripe: false });
    const rateLimited = await enforceLaunchFeedVersionRateLimit(request, {
      scope,
      viewerId: viewer?.userId ?? null
    });
    if (rateLimited) {
      return rateLimited;
    }

    const payload = await loadVersionedLaunchFeedVersionPayload(request, {
      viewer: viewer ?? undefined,
      session: session ?? undefined
    });
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
