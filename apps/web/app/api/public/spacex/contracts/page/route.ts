import { NextResponse } from 'next/server';
import { fetchSpaceXContractPage } from '@/lib/server/spacexProgram';
import { parseSpaceXMissionFilter } from '@/lib/utils/spacexProgram';

export const dynamic = 'force-dynamic';

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mission = parseSpaceXMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  const limit = clampInt(searchParams.get('limit'), 100, 1, 500);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000_000);

  try {
    const page = await fetchSpaceXContractPage(limit, offset, mission);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        mission,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        items: page.items
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
        }
      }
    );
  } catch (error) {
    console.error('spacex contracts page api error', error);
    return NextResponse.json({ error: 'contracts_page_failed' }, { status: 500 });
  }
}
