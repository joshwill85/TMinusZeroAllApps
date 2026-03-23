import { NextResponse } from 'next/server';
import { deleteMobilePushRulePayload, MobilePushRouteError } from '@/lib/server/v1/mobilePushV2';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await deleteMobilePushRulePayload(session, params.id, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobilePushRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 mobile push rule delete failed', error);
    return NextResponse.json({ error: 'failed_to_remove' }, { status: 500 });
  }
}
