import { NextResponse } from 'next/server';
import { searchSite, warmSiteSearchIndex } from '@/lib/server/siteSearch';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';

export const dynamic = 'force-dynamic';

const SEARCH_CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=60';
const WARM_CACHE_CONTROL = 'no-store';

function parseNumberParam(raw: string | null, fallback: number) {
  const value = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(value) ? value : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = parseNumberParam(searchParams.get('limit'), 8);
  const offset = parseNumberParam(searchParams.get('offset'), 0);
  const types = searchParams.get('types');
  const shouldWarm = searchParams.get('warm') === '1';

  const rateLimited = await enforceDurableRateLimit(request, {
    scope: 'api_search',
    limit: 60,
    windowSeconds: 60
  });
  if (rateLimited) {
    return rateLimited;
  }

  if (shouldWarm && !(query || '').trim()) {
    const payload = await warmSiteSearchIndex();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': WARM_CACHE_CONTROL
      }
    });
  }

  try {
    const payload = await searchSite(query, { limit, offset, types });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': SEARCH_CACHE_CONTROL
      }
    });
  } catch (error) {
    console.error('search query error', error);
    return NextResponse.json({ error: 'search_query_failed' }, { status: 500 });
  }
}
