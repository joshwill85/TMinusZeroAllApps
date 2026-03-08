import { NextResponse } from 'next/server';
import { fetchSpaceXDroneShipsIndex } from '@/lib/server/spacexDroneShips';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await fetchSpaceXDroneShipsIndex();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex drone ships api error', error);
    return NextResponse.json({ error: 'drone_ships_failed' }, { status: 500 });
  }
}
