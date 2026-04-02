import { NextResponse } from 'next/server';
import { enforceLaunchDetailPayloadRateLimit } from '@/lib/server/launchApiRateLimit';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import { loadLaunchDetailPayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
    const rateLimited = await enforceLaunchDetailPayloadRateLimit(request, {
      scope: entitlement.mode === 'live' ? 'live' : 'public',
      viewerId: entitlement.userId
    });
    if (rateLimited) {
      return rateLimited;
    }

    const payload = await loadLaunchDetailPayload(params.id, session, entitlement);
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
