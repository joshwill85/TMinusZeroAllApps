import { NextResponse } from 'next/server';
import { loadProviderDetailPayload } from '@/lib/server/v1/mobileCoreEntities';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  try {
    const payload = await loadProviderDetailPayload(params.slug);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('provider detail v1 api error', error);
    return NextResponse.json({ error: 'provider_detail_failed' }, { status: 500 });
  }
}
