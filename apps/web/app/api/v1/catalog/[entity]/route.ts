import { NextResponse } from 'next/server';
import { loadCatalogCollectionPayload } from '@/lib/server/v1/mobileReference';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { entity: string } }) {
  try {
    const payload = await loadCatalogCollectionPayload(request, params.entity);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('catalog collection v1 api error', error);
    return NextResponse.json({ error: 'catalog_collection_failed' }, { status: 500 });
  }
}
