import { NextResponse } from 'next/server';
import { loadNewsArticleDetailPayload } from '@/lib/server/v1/mobileNews';

export const dynamic = 'force-dynamic';

function getNewsId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id?: string | string[] }> }
) {
  try {
    const params = await context.params;
    const payload = await loadNewsArticleDetailPayload(getNewsId(params.id));
    if (!payload) {
      return NextResponse.json({ error: 'news_article_not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('news detail v1 api error', error);
    return NextResponse.json({ error: 'news_article_failed' }, { status: 500 });
  }
}
