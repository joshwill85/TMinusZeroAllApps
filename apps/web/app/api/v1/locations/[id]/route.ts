import { NextResponse } from 'next/server';
import { loadLocationDetailPayload } from '@/lib/server/v1/mobileCoreEntities';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const payload = await loadLocationDetailPayload(params.id);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('location detail v1 api error', error);
    return NextResponse.json({ error: 'location_detail_failed' }, { status: 500 });
  }
}
