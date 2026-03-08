import { NextResponse } from 'next/server';
import { fetchProgramUsaspendingAwardsPage } from '@/lib/server/usaspendingProgramAwards';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_OFFSET = 100_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(searchParams.get('offset'), 0, 0, MAX_OFFSET);

  try {
    const payload = await fetchProgramUsaspendingAwardsPage('spacex', {
      limit,
      offset
    });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex usaspending api error', error);
    return NextResponse.json({ error: 'usaspending_failed' }, { status: 500 });
  }
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
