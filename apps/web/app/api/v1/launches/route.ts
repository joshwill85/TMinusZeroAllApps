import { NextResponse } from 'next/server';
import { loadLaunchFeedPayload } from '@/lib/server/v1/mobileApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadLaunchFeedPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('v1 launches feed failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
