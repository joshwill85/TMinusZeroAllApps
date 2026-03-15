import { NextResponse } from 'next/server';
import { loadLaunchTrajectoryPayload } from '@/lib/server/arTrajectory';
import { getViewerTier } from '@/lib/server/viewerTier';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const viewer = await getViewerTier({ session });
    if (!viewer.isAuthed) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (viewer.tier !== 'premium') {
      return NextResponse.json({ error: 'payment_required' }, { status: 402 });
    }

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
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 launch trajectory failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
