import { NextResponse } from 'next/server';
import { loadContentPagePayload } from '@/lib/server/v1/mobileReference';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { slug?: string[] } }) {
  const slug = Array.isArray(params.slug) ? params.slug.filter(Boolean).join('/') : null;
  if (!slug) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }

  try {
    const payload = loadContentPagePayload(slug);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('content page v1 api error', error);
    return NextResponse.json({ error: 'content_page_failed' }, { status: 500 });
  }
}
