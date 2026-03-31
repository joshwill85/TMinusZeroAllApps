import { NextResponse } from 'next/server';
import { launchDetailVersionSchemaV1 } from '@tminuszero/contracts';
import { isSupabaseConfigured } from '@/lib/server/env';
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
    const session = await resolveViewerSession(request);
    const viewer = await getViewerTier({ session, reconcileStripe: false });
    const scope = resolveScope(new URL(request.url).searchParams.get('scope'), viewer.mode);

    if (scope === 'live') {
      if (!viewer.isAuthed) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (viewer.tier !== 'premium') {
        return NextResponse.json({ error: 'payment_required' }, { status: 402 });
      }
    }

    const liveClient =
      session.authMode === 'bearer' && session.accessToken
        ? createSupabaseAccessTokenClient(session.accessToken)
        : session.authMode === 'cookie'
          ? createSupabaseServerClient()
          : createSupabasePublicClient();

    const sourceQuery =
      scope === 'live'
        ? liveClient
            .from('launches')
            .select('id, last_updated_source')
            .eq('id', parsedLaunch.launchId)
            .eq('hidden', false)
        : createSupabasePublicClient()
            .from('launches_public_cache')
            .select('launch_id, cache_generated_at')
            .eq('launch_id', parsedLaunch.launchId);

    const { data, error } = await sourceQuery.maybeSingle();
    if (error) {
      console.error('v1 launch detail version failed', error);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const updatedAt =
      scope === 'live'
        ? (typeof (data as { last_updated_source?: unknown }).last_updated_source === 'string'
            ? ((data as { last_updated_source?: string | null }).last_updated_source ?? null)
            : null)
        : (typeof (data as { cache_generated_at?: unknown }).cache_generated_at === 'string'
            ? ((data as { cache_generated_at?: string | null }).cache_generated_at ?? null)
            : null);

    const payload = launchDetailVersionSchemaV1.parse({
      launchId: parsedLaunch.launchId,
      scope,
      tier: viewer.tier,
      intervalSeconds: viewer.refreshIntervalSeconds,
      updatedAt,
      version: `${parsedLaunch.launchId}|${scope}|${updatedAt ?? 'null'}`
    });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 launch detail version failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
