import { NextResponse } from 'next/server';
import {
  buildCanonicalContractSearchText,
  fetchCanonicalContractsIndex,
  type CanonicalContractScope
} from '@/lib/server/contracts';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 5000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get('scope'));
  if (!scope) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }

  const query = normalizeQuery(searchParams.get('q'));
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000_000);

  try {
    const rows = await fetchCanonicalContractsIndex();
    const scoped = scope === 'all' ? rows : rows.filter((row) => row.scope === scope);
    const filtered = query
      ? scoped.filter((row) => buildCanonicalContractSearchText(row).includes(query))
      : scoped;

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        scope,
        q: query,
        total,
        offset,
        limit,
        hasMore: offset + items.length < total,
        items
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=21600, stale-if-error=86400'
        }
      }
    );
  } catch (error) {
    console.error('public contracts api error', error);
    return NextResponse.json({ error: 'contracts_failed' }, { status: 500 });
  }
}

function parseScope(value: string | null): CanonicalContractScope | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'all') return 'all';
  if (normalized === 'spacex') return 'spacex';
  if (
    normalized === 'blue-origin' ||
    normalized === 'blue_origin' ||
    normalized === 'blueorigin'
  ) {
    return 'blue-origin';
  }
  if (normalized === 'artemis') return 'artemis';
  return null;
}

function normalizeQuery(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.slice(0, 160);
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
