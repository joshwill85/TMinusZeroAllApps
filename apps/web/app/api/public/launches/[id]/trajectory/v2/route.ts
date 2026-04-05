import { NextResponse } from 'next/server';
import { loadLaunchTrajectoryPayload } from '@/lib/server/arTrajectory';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  try {
    const result = await loadLaunchTrajectoryPayload(params.id);
    if (!result.ok) {
      const status = result.error === 'invalid_launch_id' ? 400 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    if (!result.payload) {
      return NextResponse.json({ error: 'trajectory_not_found' }, { status: 404 });
    }

    return NextResponse.json(result.payload, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('trajectory v2 product fetch error', error);
    return NextResponse.json({ error: 'trajectory_fetch_failed' }, { status: 500 });
  }
}
