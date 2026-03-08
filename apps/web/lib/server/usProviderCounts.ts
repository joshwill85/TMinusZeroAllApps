import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { toProviderSlug } from '@/lib/utils/launchLinks';

export type UsProviderCount = {
  name: string;
  slug: string;
  launchCountYear: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_DAYS = 3650;

type ProviderCountsRow = {
  provider: string | null;
  launch_count: number | null;
};

export const fetchUsProviderCounts = cache(async ({ lookbackDays = 365 }: { lookbackDays?: number } = {}): Promise<UsProviderCount[]> => {
  if (!isSupabaseConfigured()) return [];
  const nowMs = Date.now();
  const safeLookbackDays = Number.isFinite(lookbackDays) ? Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.trunc(lookbackDays))) : 365;
  const fallbackSinceIso = new Date(nowMs - safeLookbackDays * DAY_MS).toISOString();

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc('provider_counts_us', { lookback_days: safeLookbackDays });

  if (!error && Array.isArray(data) && data.length > 0) {
    return (data as ProviderCountsRow[])
      .map((row) => {
        const name = typeof row.provider === 'string' ? row.provider.trim() : '';
        if (!name || name.toLowerCase() === 'unknown') return null;
        const slug = toProviderSlug(name);
        if (!slug) return null;
        const launchCountYear = typeof row.launch_count === 'number' && Number.isFinite(row.launch_count) ? Math.max(0, row.launch_count) : 0;
        return { name, slug, launchCountYear } satisfies UsProviderCount;
      })
      .filter((row): row is UsProviderCount => Boolean(row))
      .sort((a, b) => b.launchCountYear - a.launchCountYear || a.name.localeCompare(b.name));
  }

  // Fallback if the RPC isn't deployed yet.
  const counts = new Map<string, { name: string; count: number }>();
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data: rows, error: queryError } = await supabase
      .from('launches_public_cache')
      .select('provider')
      .in('pad_country_code', ['USA', 'US'])
      .gte('net', fallbackSinceIso)
      .order('provider', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (queryError || !rows || rows.length === 0) break;

    for (const row of rows as Array<{ provider: string | null }>) {
      const name = typeof row.provider === 'string' ? row.provider.trim() : '';
      if (!name || name.toLowerCase() === 'unknown') continue;
      const slug = toProviderSlug(name);
      if (!slug) continue;
      const existing = counts.get(slug);
      if (existing) existing.count += 1;
      else counts.set(slug, { name, count: 1 });
    }

    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }

  return [...counts.entries()]
    .map(([slug, meta]) => ({ slug, name: meta.name, launchCountYear: meta.count }))
    .sort((a, b) => b.launchCountYear - a.launchCountYear || a.name.localeCompare(b.name));
});
