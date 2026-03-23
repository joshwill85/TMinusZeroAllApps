import { NextResponse } from 'next/server';
import { loadArtemisContentPayload } from '@/lib/server/v1/mobileArtemis';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const payload = await loadArtemisContentPayload(searchParams);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis content v1 api error', error);
    return NextResponse.json({ error: 'artemis_content_failed' }, { status: 500 });
  }
}
