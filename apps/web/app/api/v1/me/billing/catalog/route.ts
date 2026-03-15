import { NextResponse } from 'next/server';
import type { BillingPlatformV1 } from '@tminuszero/contracts';
import { BillingApiRouteError, loadBillingCatalog } from '@/lib/server/billingCore';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

function readPlatform(request: Request): BillingPlatformV1 {
  const platform = new URL(request.url).searchParams.get('platform');
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }
  return 'web';
}

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = loadBillingCatalog(session, readPlatform(request));
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 billing catalog failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
