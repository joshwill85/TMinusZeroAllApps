import { cache } from 'react';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import type { CatalogEntityType, CatalogRegion } from '@/lib/utils/catalog';

export type CatalogCollectionItem = {
  entity_type: CatalogEntityType;
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

export type CatalogCollectionResult = {
  items: CatalogCollectionItem[];
  errorMessage: string | null;
  supabaseReady: boolean;
};

const CATALOG_SELECT_BASE =
  'entity_type, entity_id, name, slug, description, country_codes, image_url, fetched_at' as const;
const CATALOG_SELECT_WITH_DATA =
  'entity_type, entity_id, name, slug, description, country_codes, image_url, data, fetched_at' as const;

export const fetchCatalogCollection = cache(async function fetchCatalogCollection({
  entity,
  region,
  query,
  limit,
  offset,
  includeCounts = true,
  includeData = false
}: {
  entity: CatalogEntityType;
  region: CatalogRegion;
  query: string | null;
  limit: number;
  offset: number;
  includeCounts?: boolean;
  includeData?: boolean;
}): Promise<CatalogCollectionResult> {
  if (!isSupabaseConfigured()) {
    return { items: [], errorMessage: null, supabaseReady: false };
  }

  const supabase = createSupabaseServerClient();
  const catalogSource = supabase.from('ll2_catalog_public_cache');
  const catalogSelected = includeData ? catalogSource.select(CATALOG_SELECT_WITH_DATA) : catalogSource.select(CATALOG_SELECT_BASE);
  let catalogQuery = catalogSelected.eq('entity_type', entity);

  if (region === 'us') {
    catalogQuery = catalogQuery.overlaps('country_codes', US_PAD_COUNTRY_CODES);
  }

  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery) {
    const pattern = `%${normalizedQuery}%`;
    catalogQuery = catalogQuery.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  catalogQuery = catalogQuery.order('name', { ascending: true }).range(offset, offset + limit - 1);

  const { data, error } = await catalogQuery;
  if (error) {
    console.error('ll2 catalog query error', error);
    return { items: [], errorMessage: 'Catalog request failed.', supabaseReady: true };
  }

  let items = (data || []) as CatalogCollectionItem[];

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

  return { items, errorMessage: null, supabaseReady: true };
});

function normalizeQuery(raw: string | null) {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, 80);
  if (!trimmed) return null;
  return trimmed.replace(/[,%]/g, ' ');
}

async function attachLaunchCounts({
  admin,
  items,
  table,
  idField
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  items: CatalogCollectionItem[];
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
