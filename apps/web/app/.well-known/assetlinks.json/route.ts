import { NextResponse } from 'next/server';
import { buildAndroidAssetLinksPayload } from '@/lib/server/mobileAppLinks';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(buildAndroidAssetLinksPayload(), {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
    }
  });
}
