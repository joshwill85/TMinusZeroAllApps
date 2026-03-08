import { NextResponse } from 'next/server';
import { fetchSpaceXFinanceSignals } from '@/lib/server/spacexProgram';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await fetchSpaceXFinanceSignals();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex finance api error', error);
    return NextResponse.json({ error: 'finance_failed' }, { status: 500 });
  }
}
