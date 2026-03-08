import { NextResponse } from 'next/server';
import {
  fetchBlueOriginEngineDetail,
  parseBlueOriginEngineSlug
} from '@/lib/server/blueOriginEntities';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const slug = parseBlueOriginEngineSlug(params.slug);
  if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });

  try {
    const payload = await fetchBlueOriginEngineDetail(slug);
    if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin engine detail api error', error);
    return NextResponse.json({ error: 'engine_failed' }, { status: 500 });
  }
}
