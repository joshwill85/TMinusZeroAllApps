import { NextResponse } from 'next/server';
import { loadNewsStreamPayload } from '@/lib/server/v1/mobileNews';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await loadNewsStreamPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('news v1 api error', error);
    return NextResponse.json({ error: 'news_stream_failed' }, { status: 500 });
  }
}
