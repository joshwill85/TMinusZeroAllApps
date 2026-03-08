import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { fetchProviderBySlug } from '@/lib/server/providers';
import { toProviderSlug } from '@/lib/utils/launchLinks';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  slug: z.string().trim().min(1).optional(),
  provider: z.string().trim().min(1).optional(),
  upcomingLimit: z.coerce.number().int().min(1).max(500).optional(),
  recentLimit: z.coerce.number().int().min(1).max(500).optional()
});

const FALLBACK_PROVIDERS: Record<string, { name: string }> = {
  spacex: { name: 'SpaceX' },
  nasa: { name: 'NASA' },
  'united-launch-alliance-ula': { name: 'United Launch Alliance (ULA)' },
  'rocket-lab': { name: 'Rocket Lab' },
  'blue-origin': { name: 'Blue Origin' }
};

const SELECT_COLUMNS = [
  'launch_id',
  'name',
  'slug',
  'provider',
  'vehicle',
  'net',
  'net_precision',
  'status_name',
  'status_abbrev',
  'tier',
  'featured',
  'pad_name',
  'pad_short_code',
  'pad_state_code',
  'pad_timezone',
  'pad_location_name',
  'pad_country_code',
  'll2_pad_id',
  'll2_rocket_config_id',
  'rocket_full_name',
  'image_thumbnail_url'
].join(',');

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    slug: searchParams.get('slug') ?? undefined,
    provider: searchParams.get('provider') ?? undefined,
    upcomingLimit: searchParams.get('upcomingLimit') ?? undefined,
    recentLimit: searchParams.get('recentLimit') ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }

  const slugInput = parsed.data.slug ? toProviderSlug(parsed.data.slug) : null;
  const providerInput = parsed.data.provider?.trim() || null;
  const upcomingLimit = parsed.data.upcomingLimit ?? 200;
  const recentLimit = parsed.data.recentLimit ?? 200;

  const provider =
    slugInput && isSupabaseConfigured()
      ? await fetchProviderBySlug(slugInput)
      : null;

  const providerName =
    provider?.name ||
    (slugInput ? FALLBACK_PROVIDERS[slugInput]?.name : null) ||
    providerInput;

  if (!providerName) {
    return NextResponse.json({ error: 'provider_required' }, { status: 400 });
  }

  const providerSlug = provider?.slug || (slugInput ? slugInput : toProviderSlug(providerName));

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select(SELECT_COLUMNS)
      .eq('provider', providerName)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(upcomingLimit),
    supabase
      .from('launches_public_cache')
      .select(SELECT_COLUMNS)
      .eq('provider', providerName)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(recentLimit)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('provider schedule query error', { upcoming: upcomingRes.error, recent: recentRes.error });
    return NextResponse.json({ error: 'provider_schedule_query_failed' }, { status: 500 });
  }

  const freshness: 'public-cache-db' = 'public-cache-db';
  const intervalMinutes = 15;

  return NextResponse.json(
    {
      freshness,
      intervalMinutes,
      provider: { name: providerName, slug: providerSlug },
      upcoming: (upcomingRes.data || []).map(mapPublicCacheRow),
      recent: (recentRes.data || []).map(mapPublicCacheRow)
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400'
      }
    }
  );
}

