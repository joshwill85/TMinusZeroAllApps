import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import type { Launch } from '@/lib/types/launch';

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
  'pad_state',
  'pad_timezone',
  'pad_location_name',
  'pad_country_code',
  'll2_pad_id',
  'll2_rocket_config_id',
  'rocket_full_name',
  'image_thumbnail_url'
].join(',');

export type ProviderScheduleResult = {
  upcoming: Launch[];
  recent: Launch[];
};

export const fetchProviderSchedule = cache(async function fetchProviderSchedule({
  providerName,
  upcomingLimit = 200,
  recentLimit = 200
}: {
  providerName: string;
  upcomingLimit?: number;
  recentLimit?: number;
}): Promise<ProviderScheduleResult> {
  const normalizedProviderName = String(providerName || '').trim();
  if (!normalizedProviderName || !isSupabaseConfigured()) {
    return { upcoming: [], recent: [] };
  }

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select(SELECT_COLUMNS)
      .eq('provider', normalizedProviderName)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(upcomingLimit),
    supabase
      .from('launches_public_cache')
      .select(SELECT_COLUMNS)
      .eq('provider', normalizedProviderName)
      .in('pad_country_code', US_PAD_COUNTRY_CODES)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(recentLimit)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('provider schedule query error', { upcoming: upcomingRes.error, recent: recentRes.error });
    return { upcoming: [], recent: [] };
  }

  return {
    upcoming: (upcomingRes.data || []).map(mapPublicCacheRow),
    recent: (recentRes.data || []).map(mapPublicCacheRow)
  };
});
