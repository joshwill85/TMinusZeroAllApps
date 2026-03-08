import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hoursRaw = searchParams.get('hours');
  const hours = clampInt(hoursRaw ? Number(hoursRaw) : 24, 1, 168);

  return NextResponse.json(
    {
      hours,
      results: [],
      restricted: true,
      reason: 'premium_only'
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
  );
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
