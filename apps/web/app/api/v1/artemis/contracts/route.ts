import { NextResponse } from 'next/server';
import { loadArtemisContractsPayload } from '@/lib/server/v1/mobileArtemis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await loadArtemisContractsPayload();
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('artemis contracts v1 api error', error);
    return NextResponse.json({ error: 'artemis_contracts_failed' }, { status: 500 });
  }
}
