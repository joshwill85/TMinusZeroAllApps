import { NextResponse } from 'next/server';
import { MobileApiRouteError, rotateEmbedWidgetPayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await rotateEmbedWidgetPayload(session, params.id);
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
    console.error('v1 embed widget rotate failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
