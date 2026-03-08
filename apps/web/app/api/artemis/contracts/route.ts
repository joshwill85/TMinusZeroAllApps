import { NextResponse } from 'next/server';
import { fetchArtemisContracts } from '@/lib/server/artemisContracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const piid = url.searchParams.get('piid');
  const limitValue = url.searchParams.get('limit');
  const limit = parseLimit(limitValue, 200, 1, 1000);

  const contracts = await fetchArtemisContracts({ piid, limit });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: contracts.length,
    contracts
  });
}

function parseLimit(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
