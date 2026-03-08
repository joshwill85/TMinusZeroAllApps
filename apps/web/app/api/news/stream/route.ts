import { NextResponse } from 'next/server';
import { fetchNewsStreamPage, NEWS_STREAM_PAGE_SIZE } from '@/lib/server/newsStream';
import type { NewsType } from '@/lib/types/news';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursorParam = searchParams.get('cursor');
  const typeParam = searchParams.get('type');
  const providerParam = searchParams.get('provider');
  const limitParam = searchParams.get('limit');

  const cursor = clampInt(cursorParam, 0, 0, 2_000_000);
  const limit = clampInt(limitParam, NEWS_STREAM_PAGE_SIZE, 1, 80);
  const type = resolveTypeFilter(typeParam);
  const providerName = providerParam?.trim() ? providerParam.trim() : null;

  const { page, errorMessage } = await fetchNewsStreamPage({ type, providerName, cursor, limit });
  if (errorMessage) {
    if (errorMessage === 'supabase_not_configured') {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'news_stream_failed' }, { status: 500 });
  }

  return NextResponse.json(page, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

function resolveTypeFilter(raw?: string | null): NewsType | 'all' {
  const normalized = raw?.trim().toLowerCase() || '';
  if (!normalized) return 'all';
  if (normalized === 'article' || normalized === 'blog' || normalized === 'report') return normalized;
  if (normalized === 'articles') return 'article';
  if (normalized === 'blogs') return 'blog';
  if (normalized === 'reports') return 'report';
  return 'all';
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

