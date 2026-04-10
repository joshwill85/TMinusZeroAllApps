import { NextResponse } from 'next/server';
import { isInternalContractsRevalidateTokenValid } from '@/lib/server/env';
import { refreshCanonicalContractsCacheAndRevalidate } from '@/lib/server/contractsCacheRefresh';

export const runtime = 'nodejs';

type RevalidateRequestBody = {
  source?: unknown;
  reason?: unknown;
};

export async function POST(request: Request) {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!isInternalContractsRevalidateTokenValid(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: RevalidateRequestBody;
  try {
    payload = (await request.json()) as RevalidateRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const summary = await refreshCanonicalContractsCacheAndRevalidate();
    return NextResponse.json({
      ok: true,
      source: normalizeOptionalText(payload.source),
      reason: normalizeOptionalText(payload.reason),
      ...summary
    });
  } catch (error) {
    console.error('internal contracts revalidate error', error);
    return NextResponse.json(
      {
        error: 'refresh_failed',
        source: normalizeOptionalText(payload.source),
        reason: normalizeOptionalText(payload.reason)
      },
      { status: 500 }
    );
  }
}

function parseBearerToken(value: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token || null;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}
