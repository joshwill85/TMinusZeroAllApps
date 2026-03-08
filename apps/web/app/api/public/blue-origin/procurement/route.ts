import { NextResponse } from 'next/server';
import { fetchBlueOriginAuditTrailPage } from '@/lib/server/blueOriginAuditTrail';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 50_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

  try {
    const payload = await fetchBlueOriginAuditTrailPage(limit);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin procurement api error', error);
    return NextResponse.json({ error: 'procurement_failed' }, { status: 500 });
  }
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
