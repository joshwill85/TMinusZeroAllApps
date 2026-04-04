import { NextResponse } from 'next/server';
import { loadAuthMethodsPayload } from '@/lib/server/authMethods';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadAuthMethodsPayload(session);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 auth methods failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
