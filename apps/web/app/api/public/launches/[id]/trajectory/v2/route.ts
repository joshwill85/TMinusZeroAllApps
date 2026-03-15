import { NextResponse } from 'next/server';
import { TRAJECTORY_CONTRACT_COLUMNS, buildTrajectoryPublicV2Response } from '@tminuszero/domain';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  const nowMs = Date.now();
  const eligible = await fetchArEligibleLaunches({ nowMs });
  if (!eligible.some((entry) => entry.launchId === parsed.launchId)) {
    return NextResponse.json({ error: 'not_eligible' }, { status: 404 });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('launch_trajectory_products')
    .select(TRAJECTORY_CONTRACT_COLUMNS)
    .eq('launch_id', parsed.launchId)
    .maybeSingle();

  if (error) {
    console.error('trajectory v2 product fetch error', error);
    return NextResponse.json({ error: 'trajectory_fetch_failed' }, { status: 500 });
  }

  const payload = buildTrajectoryPublicV2Response((data as any) ?? null);
  if (!payload) {
    return NextResponse.json({ error: 'trajectory_not_found' }, { status: 404 });
  }

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}
