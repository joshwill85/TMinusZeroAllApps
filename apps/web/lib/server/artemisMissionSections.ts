import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type { ArtemisContentMissionKey, ArtemisMissionComponent, ArtemisPersonProfile } from '@/lib/types/artemis';

type PersonRow = {
  id: string;
  mission_key: string;
  sort_order: number | null;
  name: string;
  agency: string;
  role: string | null;
  bio_url: string;
  portrait_url: string | null;
  summary: string | null;
  updated_at: string;
};

type ComponentRow = {
  id: string;
  mission_key: string;
  sort_order: number | null;
  component: string;
  description: string;
  official_urls: string[] | null;
  image_url: string | null;
  updated_at: string;
};

export const fetchArtemisPeople = cache(async (missionKey: ArtemisContentMissionKey): Promise<ArtemisPersonProfile[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabasePublicClient();

  const { data, error } = await supabase
    .from('artemis_people')
    .select('id,mission_key,sort_order,name,agency,role,bio_url,portrait_url,summary,updated_at')
    .eq('mission_key', missionKey)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(50);

  if (error) {
    console.error('artemis people query error', error);
    return [];
  }

  return ((data || []) as PersonRow[]).map((row) => ({
    id: row.id,
    missionKey: normalizeMissionKey(row.mission_key) || missionKey,
    sortOrder: Number(row.sort_order ?? 0),
    name: row.name,
    agency: row.agency,
    role: row.role,
    bioUrl: row.bio_url,
    portraitUrl: row.portrait_url,
    summary: row.summary,
    updatedAt: row.updated_at
  }));
});

export const fetchArtemisMissionComponents = cache(
  async (missionKey: ArtemisContentMissionKey): Promise<ArtemisMissionComponent[]> => {
    if (!isSupabaseConfigured()) return [];
    const supabase = createSupabasePublicClient();

    const { data, error } = await supabase
      .from('artemis_mission_components')
      .select('id,mission_key,sort_order,component,description,official_urls,image_url,updated_at')
      .eq('mission_key', missionKey)
      .order('sort_order', { ascending: true })
      .order('component', { ascending: true })
      .limit(80);

    if (error) {
      console.error('artemis mission components query error', error);
      return [];
    }

    return ((data || []) as ComponentRow[]).map((row) => ({
      id: row.id,
      missionKey: normalizeMissionKey(row.mission_key) || missionKey,
      sortOrder: Number(row.sort_order ?? 0),
      component: row.component,
      description: row.description,
      officialUrls: Array.isArray(row.official_urls) ? row.official_urls : [],
      imageUrl: row.image_url,
      updatedAt: row.updated_at
    }));
  }
);

function normalizeMissionKey(value: string | null | undefined): ArtemisContentMissionKey | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'program') return 'program';
  if (
    normalized === 'artemis-i' ||
    normalized === 'artemis-ii' ||
    normalized === 'artemis-iii' ||
    normalized === 'artemis-iv' ||
    normalized === 'artemis-v' ||
    normalized === 'artemis-vi' ||
    normalized === 'artemis-vii'
  ) {
    return normalized as ArtemisContentMissionKey;
  }
  return null;
}

