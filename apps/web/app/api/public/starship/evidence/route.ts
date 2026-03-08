import { NextResponse } from 'next/server';
import { fetchStarshipEventEvidence } from '@/lib/server/starshipUi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId')?.trim();

  if (!eventId) {
    return NextResponse.json({ error: 'event_id_required' }, { status: 400 });
  }

  try {
    const evidence = await fetchStarshipEventEvidence(eventId);
    if (!evidence) {
      return NextResponse.json({ error: 'event_not_found' }, { status: 404 });
    }

    return NextResponse.json(evidence, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('starship evidence api error', error);
    return NextResponse.json({ error: 'evidence_failed' }, { status: 500 });
  }
}
