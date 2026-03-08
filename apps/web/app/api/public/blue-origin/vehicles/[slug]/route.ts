import { NextResponse } from 'next/server';
import {
  fetchBlueOriginVehicleDetail,
  parseBlueOriginVehicleSlug
} from '@/lib/server/blueOriginEntities';

export const dynamic = 'force-dynamic';

type Params = {
  slug: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const slug = parseBlueOriginVehicleSlug(params.slug);
  if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });

  try {
    const payload = await fetchBlueOriginVehicleDetail(slug);
    if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin vehicle detail api error', error);
    return NextResponse.json({ error: 'vehicle_failed' }, { status: 500 });
  }
}
