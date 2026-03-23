import { NextResponse } from 'next/server';
import { loadInfoHubPayload } from '@/lib/server/v1/mobileReference';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = loadInfoHubPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('info hub v1 api error', error);
    return NextResponse.json({ error: 'info_hub_failed' }, { status: 500 });
  }
}
