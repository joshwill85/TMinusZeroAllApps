import { NextResponse } from 'next/server';
import { loadArtemisAwardeeDetailPayload } from '@/lib/server/v1/mobileArtemis';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const payload = await loadArtemisAwardeeDetailPayload(params.slug);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis awardee detail v1 api error', error);
    return NextResponse.json({ error: 'artemis_awardee_detail_failed' }, { status: 500 });
  }
}
