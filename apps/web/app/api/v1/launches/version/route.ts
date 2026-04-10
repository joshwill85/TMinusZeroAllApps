import { NextResponse } from 'next/server';
import { enforceLaunchFeedVersionRateLimit, resolveLaunchFeedScopeFromRequest } from '@/lib/server/launchApiRateLimit';
import { logLaunchRefreshDiagnostic } from '@/lib/server/launchRefreshDiagnostics';
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
    const cacheControl =
      payload.scope === 'public'
        ? 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
        : 'private, no-store';
    logLaunchRefreshDiagnostic('route_response', {
      route: 'api_v1_launches_version',
      scope: payload.scope,
      cacheControl,
      version: payload.version,
      updatedAt: payload.updatedAt,
      recommendedIntervalSeconds: payload.recommendedIntervalSeconds ?? payload.intervalSeconds
    });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': cacheControl
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
