import { NextResponse } from 'next/server';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';

export const dynamic = 'force-dynamic';

export async function GET() {
  const launches = await fetchArEligibleLaunches();
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      launches
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800, stale-if-error=86400'
      }
    }
  );
}
