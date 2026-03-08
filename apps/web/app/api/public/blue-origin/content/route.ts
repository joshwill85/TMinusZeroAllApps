import { NextResponse } from 'next/server';
import {
  fetchBlueOriginContentViewModel,
  parseBlueOriginContentCursor,
  parseBlueOriginContentKindFilter,
  parseBlueOriginContentLimit,
  parseBlueOriginContentMissionFilter
} from '@/lib/server/blueOriginContent';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mission = parseBlueOriginContentMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  const kind = parseBlueOriginContentKindFilter(searchParams.get('kind'));
  if (!kind) return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });

  const limit = parseBlueOriginContentLimit(searchParams.get('limit'));
  if (limit == null) return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });

  const cursor = parseBlueOriginContentCursor(searchParams.get('cursor'));
  if (searchParams.get('cursor') && cursor == null) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
  }

  try {
    const payload = await fetchBlueOriginContentViewModel({ mission, kind, limit, cursor });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin content api error', error);
    return NextResponse.json({ error: 'content_failed' }, { status: 500 });
  }
}
