import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';

export const dynamic = 'force-dynamic';
const CATALOG_SELECT_BASE =
  'entity_type, entity_id, name, slug, description, country_codes, image_url, fetched_at' as const;
const CATALOG_SELECT_WITH_DATA =
  'entity_type, entity_id, name, slug, description, country_codes, image_url, data, fetched_at' as const;

const ENTITY_TYPES = [
  'agencies',
  'astronauts',
  'space_stations',
  'expeditions',
  'docking_events',
  'launcher_configurations',
  'launchers',
  'spacecraft_configurations',
  'locations',
  'pads',
  'events'
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

type CatalogRow = {
  entity_type: EntityType;
  entity_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  country_codes?: string[] | null;
  image_url?: string | null;
  data?: Record<string, unknown> | null;
  fetched_at?: string | null;
  launch_count?: number | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entity = resolveEntity(searchParams.get('entity'));
  const region = resolveRegion(searchParams.get('region'));
  const query = normalizeQuery(searchParams.get('q'));
  const limit = clampInt(searchParams.get('limit'), 36, 1, 200);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);
  const includeCounts = parseBoolean(searchParams.get('include_counts'));
  const includeData = parseBoolean(searchParams.get('include_data'));

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const catalogSource = supabase.from('ll2_catalog_public_cache');
  const catalogSelected = includeData
    ? catalogSource.select(CATALOG_SELECT_WITH_DATA)
    : catalogSource.select(CATALOG_SELECT_BASE);
  let catalogQuery = catalogSelected.eq('entity_type', entity);

  if (region === 'us') {
    catalogQuery = catalogQuery.overlaps('country_codes', US_PAD_COUNTRY_CODES);
  }

  if (query) {
    const pattern = `%${query}%`;
    catalogQuery = catalogQuery.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  catalogQuery = catalogQuery.order('name', { ascending: true }).range(offset, offset + limit - 1);

  const { data, error } = await catalogQuery;
  if (error) {
    console.error('ll2 catalog query error', error);
    return NextResponse.json({ error: 'catalog_query_failed' }, { status: 500 });
  }

  let items = (data || []) as CatalogRow[];

  if (includeCounts && isSupabaseAdminConfigured() && (entity === 'astronauts' || entity === 'launchers')) {
    const admin = createSupabaseAdminClient();
    if (entity === 'astronauts') {
      items = await attachLaunchCounts({
        admin,
        items,
        table: 'll2_astronaut_launches',
        idField: 'll2_astronaut_id'
      });
    } else {
      items = await attachLaunchCounts({
        admin,
        items,
        table: 'll2_launcher_launches',
        idField: 'll2_launcher_id'
      });
    }
  }

  return NextResponse.json(
    {
      entity,
      region,
      limit,
      offset,
      items
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
      }
    }
  );
}

async function attachLaunchCounts({
  admin,
  items,
  table,
  idField
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  items: CatalogRow[];
  table: 'll2_astronaut_launches' | 'll2_launcher_launches';
  idField: 'll2_astronaut_id' | 'll2_launcher_id';
}) {
  const ids = items
    .map((item) => Number(item.entity_id))
    .filter((value) => Number.isFinite(value)) as number[];
  if (!ids.length) return items;

  const { data, error } = await admin.from(table).select(idField).in(idField, ids);
  if (error || !data) return items;

  const counts = new Map<number, number>();
  for (const row of data as Array<Record<string, unknown>>) {
    const id = Number(row[idField]);
    if (!Number.isFinite(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return items.map((item) => ({
    ...item,
    launch_count: counts.get(Number(item.entity_id)) ?? 0
  }));
}

function resolveEntity(raw: string | null): EntityType {
  const value = (raw || '').trim();
  return (ENTITY_TYPES.find((entity) => entity === value) || 'agencies') as EntityType;
}

function resolveRegion(raw: string | null): 'all' | 'us' {
  return raw === 'us' ? 'us' : 'all';
}

function normalizeQuery(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, 80);
  if (!trimmed) return null;
  return trimmed.replace(/[,%]/g, ' ');
}

function parseBoolean(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
