import { NextResponse } from 'next/server';
import { searchPayload } from '@/lib/server/v1/mobileApi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const payload = await searchPayload(request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60'
      }
    });
  } catch (error) {
    console.error('v1 search failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
