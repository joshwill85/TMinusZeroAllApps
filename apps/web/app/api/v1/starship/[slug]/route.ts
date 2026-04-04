import { NextResponse } from 'next/server';
import { loadStarshipFlightOverviewPayload } from '@/lib/server/v1/mobileSpaceX';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Params }
) {
  try {
    const payload = await loadStarshipFlightOverviewPayload(params.slug);
    if (!payload) {
      return NextResponse.json({ error: 'starship_flight_not_found' }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('starship flight overview v1 api error', error);
    return NextResponse.json({ error: 'starship_flight_overview_failed' }, { status: 500 });
  }
}
