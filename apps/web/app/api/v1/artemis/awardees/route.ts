import { NextResponse } from 'next/server';
import { loadArtemisAwardeesPayload } from '@/lib/server/v1/mobileArtemis';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitValue = searchParams.get('limit');
  const parsedLimit = limitValue && /^\d+$/.test(limitValue) ? Number(limitValue) : null;

  try {
    const payload = await loadArtemisAwardeesPayload(searchParams.get('q'), parsedLimit);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis awardees v1 api error', error);
    return NextResponse.json({ error: 'artemis_awardees_failed' }, { status: 500 });
  }
}
