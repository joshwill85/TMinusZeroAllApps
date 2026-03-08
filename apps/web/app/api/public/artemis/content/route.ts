import { NextResponse } from 'next/server';
import {
  fetchArtemisContentViewModel,
  parseArtemisContentCursor,
  parseArtemisContentKindFilter,
  parseArtemisContentLimit,
  parseArtemisContentMissionFilter,
  parseArtemisContentTierFilter
} from '@/lib/server/artemisContent';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mission = parseArtemisContentMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  const kind = parseArtemisContentKindFilter(searchParams.get('kind'));
  if (!kind) return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });

  const tier = parseArtemisContentTierFilter(searchParams.get('tier'));
  if (!tier) return NextResponse.json({ error: 'invalid_tier' }, { status: 400 });

  const limit = parseArtemisContentLimit(searchParams.get('limit'));
  if (limit == null) return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });

  const cursor = parseArtemisContentCursor(searchParams.get('cursor'));
  if (searchParams.get('cursor') && cursor == null) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
  }

  try {
    const payload = await fetchArtemisContentViewModel({
      mission,
      kind,
      tier,
      limit,
      cursor
    });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis content api error', error);
    return NextResponse.json({ error: 'content_failed' }, { status: 500 });
  }
}
