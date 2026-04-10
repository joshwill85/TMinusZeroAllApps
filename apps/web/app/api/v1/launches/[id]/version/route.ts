import { NextResponse } from 'next/server';
import { getTierRefreshSeconds } from '@tminuszero/domain';
import { launchDetailVersionSchemaV1 } from '@tminuszero/contracts';
import { isSupabaseConfigured } from '@/lib/server/env';
import { enforceLaunchDetailVersionRateLimit } from '@/lib/server/launchApiRateLimit';
import { logLaunchRefreshDiagnostic } from '@/lib/server/launchRefreshDiagnostics';
import { loadLaunchDetailVersionSnapshot } from '@/lib/server/launchDetailVersion';
import { resolveLaunchRefreshCadenceHint } from '@/lib/server/launchRefreshCadence';
import { createSupabaseAccessTokenClient, createSupabasePublicClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getViewerTier } from '@/lib/server/viewerTier';
import { resolveViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';

export const dynamic = 'force-dynamic';

function resolveScope(scopeParam: string | null, viewerMode: 'public' | 'live') {
  const normalized = String(scopeParam || '').trim().toLowerCase();
  if (normalized === 'public' || normalized === 'live') {
    return normalized;
  }
  return viewerMode;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsedLaunch = parseLaunchParam(params.id);
  if (!parsedLaunch) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const requestedScope = String(new URL(request.url).searchParams.get('scope') || '').trim().toLowerCase();
    const shouldResolveViewer = requestedScope !== 'public';
    const session = shouldResolveViewer ? await resolveViewerSession(request) : null;
    const viewer = session ? await getViewerTier({ session, reconcileStripe: false }) : null;
    const scope = resolveScope(new URL(request.url).searchParams.get('scope'), viewer?.mode ?? 'public');
    const rateLimited = await enforceLaunchDetailVersionRateLimit(request, {
      scope,
      viewerId: viewer?.userId ?? null
    });
    if (rateLimited) {
      return rateLimited;
    }

    if (scope === 'live') {
      if (!session || !viewer) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (!viewer.isAuthed) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (viewer.tier !== 'premium') {
        return NextResponse.json({ error: 'payment_required' }, { status: 402 });
      }

      const liveClient =
        session.authMode === 'bearer' && session.accessToken
          ? createSupabaseAccessTokenClient(session.accessToken)
          : session.authMode === 'cookie'
            ? createSupabaseServerClient()
            : createSupabasePublicClient();

      const { data, error } = await liveClient
        .from('launches')
        .select('id, ll2_id, last_updated_source')
        .eq('id', parsedLaunch.launchId)
        .eq('hidden', false)
        .maybeSingle();
      if (error) {
        console.error('v1 launch detail version failed', error);
        return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }

      const detailVersionSeed = await loadLaunchDetailVersionSnapshot({
        launchId: parsedLaunch.launchId,
        scope: 'live',
        launchCoreUpdatedAt:
          typeof (data as { last_updated_source?: unknown }).last_updated_source === 'string'
            ? ((data as { last_updated_source?: string | null }).last_updated_source ?? null)
            : null,
        ll2LaunchId: typeof (data as { ll2_id?: unknown }).ll2_id === 'string' ? ((data as { ll2_id?: string | null }).ll2_id ?? null) : null,
        refreshStateClient: liveClient
      });
      const cadenceHint = await resolveLaunchRefreshCadenceHint({ client: liveClient, scope: 'live' });
      const payload = launchDetailVersionSchemaV1.parse({
        launchId: parsedLaunch.launchId,
        scope: 'live',
        tier: viewer.tier,
        intervalSeconds: cadenceHint.recommendedIntervalSeconds,
        updatedAt: detailVersionSeed.updatedAt,
        version: detailVersionSeed.version,
        moduleUpdatedAt: detailVersionSeed.moduleUpdatedAt,
        recommendedIntervalSeconds: cadenceHint.recommendedIntervalSeconds,
        cadenceReason: cadenceHint.cadenceReason,
        cadenceAnchorNet: cadenceHint.cadenceAnchorNet
      });

      logLaunchRefreshDiagnostic('route_response', {
        route: 'api_v1_launch_detail_version',
        scope: 'live',
        launchId: parsedLaunch.launchId,
        cacheControl: 'private, no-store',
        version: payload.version,
        updatedAt: payload.updatedAt,
        recommendedIntervalSeconds: payload.recommendedIntervalSeconds ?? payload.intervalSeconds
      });

      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'private, no-store'
        }
      });
    }

    const publicClient = createSupabasePublicClient();
    const { data, error } = await publicClient
      .from('launches_public_cache')
      .select('launch_id, cache_generated_at, ll2_launch_uuid')
      .eq('launch_id', parsedLaunch.launchId)
      .maybeSingle();
    if (error) {
      console.error('v1 launch detail version failed', error);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const publicIntervalSeconds = getTierRefreshSeconds('anon');
    const detailVersionSeed = await loadLaunchDetailVersionSnapshot({
      launchId: parsedLaunch.launchId,
      scope: 'public',
      launchCoreUpdatedAt:
        typeof (data as { cache_generated_at?: unknown }).cache_generated_at === 'string'
          ? ((data as { cache_generated_at?: string | null }).cache_generated_at ?? null)
          : null,
      ll2LaunchId:
        typeof (data as { ll2_launch_uuid?: unknown }).ll2_launch_uuid === 'string'
          ? ((data as { ll2_launch_uuid?: string | null }).ll2_launch_uuid ?? null)
          : null,
      refreshStateClient: publicClient
    });
    const payload = launchDetailVersionSchemaV1.parse({
      launchId: parsedLaunch.launchId,
      scope: 'public',
      tier: 'anon',
      intervalSeconds: publicIntervalSeconds,
      updatedAt: detailVersionSeed.updatedAt,
      version: detailVersionSeed.version,
      moduleUpdatedAt: detailVersionSeed.moduleUpdatedAt,
      recommendedIntervalSeconds: publicIntervalSeconds,
      cadenceReason: 'default',
      cadenceAnchorNet: null
    });

    logLaunchRefreshDiagnostic('route_response', {
      route: 'api_v1_launch_detail_version',
      scope: 'public',
      launchId: parsedLaunch.launchId,
      cacheControl: 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
      version: payload.version,
      updatedAt: payload.updatedAt,
      recommendedIntervalSeconds: payload.recommendedIntervalSeconds ?? payload.intervalSeconds
    });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('v1 launch detail version failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
