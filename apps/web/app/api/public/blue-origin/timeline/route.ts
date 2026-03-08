import { NextResponse } from 'next/server';
import type { BlueOriginTimelineQuery } from '@/lib/types/blueOrigin';
import {
  fetchBlueOriginTimelineViewModel,
  parseBlueOriginAudienceMode,
  parseBlueOriginMissionFilter,
  parseBlueOriginSourceFilter,
  parseBooleanParam,
  parseIsoDateParam,
  parseTimelineCursor,
  parseTimelineLimit
} from '@/lib/server/blueOriginUi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = parseBlueOriginAudienceMode(searchParams.get('mode'));
  if (!mode) return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });

  const mission = parseBlueOriginMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  const sourceType = parseBlueOriginSourceFilter(searchParams.get('sourceType'));
  if (!sourceType) return NextResponse.json({ error: 'invalid_source_type' }, { status: 400 });

  const includeSuperseded = parseBooleanParam(searchParams.get('includeSuperseded'), false);
  if (includeSuperseded == null) return NextResponse.json({ error: 'invalid_include_superseded' }, { status: 400 });

  const from = parseIsoDateParam(searchParams.get('from'));
  if (from === 'invalid') return NextResponse.json({ error: 'invalid_from' }, { status: 400 });

  const to = parseIsoDateParam(searchParams.get('to'));
  if (to === 'invalid') return NextResponse.json({ error: 'invalid_to' }, { status: 400 });

  if (from && to && from > to) {
    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
  }

  const limit = parseTimelineLimit(searchParams.get('limit'));
  if (limit == null) return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });

  const cursorRaw = searchParams.get('cursor');
  if (cursorRaw && !/^\d+$/.test(cursorRaw.trim())) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
  }

  const cursor = parseTimelineCursor(cursorRaw);
  const query: BlueOriginTimelineQuery = {
    mode,
    mission,
    sourceType,
    includeSuperseded,
    from,
    to,
    cursor,
    limit
  };

  try {
    const payload = await fetchBlueOriginTimelineViewModel(query);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin timeline api error', error);
    return NextResponse.json({ error: 'timeline_failed' }, { status: 500 });
  }
}
