import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { toProviderSlug } from '@/lib/utils/launchLinks';

export type ProviderSummary = {
  name: string;
  slug: string;
  type?: string;
  countryCode?: string;
  description?: string;
  logoUrl?: string;
  imageUrl?: string;
};

const PAGE_SIZE = 1000;

export const fetchProviders = cache(async (): Promise<ProviderSummary[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();
  const cacheRes = await supabase
    .from('providers_public_cache')
    .select('name, provider_type, provider_country_code, provider_description, provider_logo_url, provider_image_url')
    .order('name', { ascending: true })
    .limit(2000);

  if (!cacheRes.error && Array.isArray(cacheRes.data) && cacheRes.data.length > 0) {
    return mapProviderRows(
      cacheRes.data as Array<{
        name: string;
        provider_type?: string | null;
        provider_country_code?: string | null;
        provider_description?: string | null;
        provider_logo_url?: string | null;
        provider_image_url?: string | null;
      }>,
      (row) => row.name
    );
  }

  // Fallback if the cache table isn't deployed yet.
  return fetchProvidersFromLaunchesPublicCache(supabase);
});

export async function fetchProviderBySlug(slug: string): Promise<ProviderSummary | null> {
  const normalized = toProviderSlug(slug);
  if (!normalized) return null;
  const providers = await fetchProviders();
  return providers.find((provider) => provider.slug === normalized) ?? null;
}

function mapProviderRows<T extends Record<string, unknown>>(
  rows: T[],
  getName: (row: T) => string
): ProviderSummary[] {
  const providers = new Map<string, ProviderSummary>();

  for (const raw of rows) {
    const name = getName(raw).trim();
    if (!name || name.toLowerCase() === 'unknown') continue;
    const slug = toProviderSlug(name);
    if (!slug) continue;

    const existing = providers.get(slug);
    providers.set(
      slug,
      mergeProviderSummary(
        existing,
        {
          provider_type: (raw as any).provider_type ?? null,
          provider_country_code: (raw as any).provider_country_code ?? null,
          provider_description: (raw as any).provider_description ?? null,
          provider_logo_url: (raw as any).provider_logo_url ?? null,
          provider_image_url: (raw as any).provider_image_url ?? null
        },
        name,
        slug
      )
    );
  }

  return Array.from(providers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchProvidersFromLaunchesPublicCache(
  supabase: ReturnType<typeof createSupabasePublicClient>
): Promise<ProviderSummary[]> {
  const rows: Array<{
    provider: string | null;
    provider_type?: string | null;
    provider_country_code?: string | null;
    provider_description?: string | null;
    provider_logo_url?: string | null;
    provider_image_url?: string | null;
  }> = [];

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('provider, provider_type, provider_country_code, provider_description, provider_logo_url, provider_image_url')
      .order('provider', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE_SIZE) break;
    offset += data.length;
  }

  return mapProviderRows(rows, (row) => (typeof row.provider === 'string' ? row.provider : ''));
}

function mergeProviderSummary(
  existing: ProviderSummary | undefined,
  row: {
    provider_type?: string | null;
    provider_country_code?: string | null;
    provider_description?: string | null;
    provider_logo_url?: string | null;
    provider_image_url?: string | null;
  },
  name: string,
  slug: string
) {
  const next: ProviderSummary = existing ?? { name, slug };
  return {
    ...next,
    type: next.type ?? nullishTrim(row.provider_type),
    countryCode: next.countryCode ?? nullishTrim(row.provider_country_code),
    description: next.description ?? nullishTrim(row.provider_description),
    logoUrl: next.logoUrl ?? nullishTrim(row.provider_logo_url),
    imageUrl: next.imageUrl ?? nullishTrim(row.provider_image_url)
  };
}

function nullishTrim(value?: string | null) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
