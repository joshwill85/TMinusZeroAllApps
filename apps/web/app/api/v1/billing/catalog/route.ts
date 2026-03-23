import { NextResponse } from 'next/server';
import type { BillingPlatformV1 } from '@tminuszero/contracts';
import { BillingApiRouteError, loadBillingCatalog } from '@/lib/server/billingCore';

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
    const payload = loadBillingCatalog(readPlatform(request));
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 public billing catalog failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
