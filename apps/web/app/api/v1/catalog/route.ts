import { NextResponse } from 'next/server';
import { loadCatalogHubPayload } from '@/lib/server/v1/mobileReference';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = loadCatalogHubPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('catalog hub v1 api error', error);
    return NextResponse.json({ error: 'catalog_hub_failed' }, { status: 500 });
  }
}
