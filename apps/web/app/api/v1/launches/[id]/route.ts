import { NextResponse } from 'next/server';
import { loadLaunchDetailPayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadLaunchDetailPayload(params.id, session);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 launch detail failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
