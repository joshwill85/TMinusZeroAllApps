import { NextResponse } from 'next/server';
import { buildViewerSessionPayload } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await resolveViewerSession(request);
  const payload = await buildViewerSessionPayload(session);
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'private, no-store'
    }
  });
}
