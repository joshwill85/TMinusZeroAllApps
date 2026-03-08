import { NextResponse } from 'next/server';
import { fetchArtemisContractSpendingByPiid } from '@/lib/server/artemisContracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: { piid: string } }) {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 600, 1, 2400);
  const piid = decodeURIComponent(context.params.piid || '').trim();

  if (!piid) {
    return NextResponse.json({ error: 'piid_required' }, { status: 400 });
  }

  const spending = await fetchArtemisContractSpendingByPiid(piid, { limit });
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    piid,
    count: spending.length,
    spending
  });
}

function parseLimit(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
