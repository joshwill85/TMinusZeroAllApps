import { NextResponse } from 'next/server';
import { fetchSpaceXFlightBySlug } from '@/lib/server/spacexProgram';
import { parseSpaceXFlightSlug } from '@/lib/utils/spacexProgram';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const slug = parseSpaceXFlightSlug(params.slug);
  if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });

  try {
    const payload = await fetchSpaceXFlightBySlug(slug);
    if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex flight detail api error', error);
    return NextResponse.json({ error: 'flight_failed' }, { status: 500 });
  }
}
