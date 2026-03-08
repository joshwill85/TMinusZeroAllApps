import { NextResponse } from 'next/server';
import { fetchBlueOriginPassengers } from '@/lib/server/blueOriginPeoplePayloads';
import { parseBlueOriginContractsMissionFilter } from '@/lib/server/blueOriginContracts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mission = parseBlueOriginContractsMissionFilter(searchParams.get('mission'));
  if (!mission) return NextResponse.json({ error: 'invalid_mission' }, { status: 400 });

  try {
    const payload = await fetchBlueOriginPassengers(mission);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('blue origin passengers api error', error);
    return NextResponse.json({ error: 'passengers_failed' }, { status: 500 });
  }
}
