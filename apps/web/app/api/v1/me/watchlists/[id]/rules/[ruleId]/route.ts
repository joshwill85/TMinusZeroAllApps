import { NextResponse } from 'next/server';
import { deleteWatchlistRulePayload, MobileApiRouteError } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, { params }: { params: { id: string; ruleId: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await deleteWatchlistRulePayload(session, params.id, params.ruleId);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 watchlist rule delete failed', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }
}
