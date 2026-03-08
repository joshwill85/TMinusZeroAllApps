import { fetchBlueOriginLaunchBuckets } from '@/lib/server/blueOrigin';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import type {
  BlueOriginContentItem,
  BlueOriginContentKind,
  BlueOriginContentResponse
} from '@/lib/types/blueOrigin';
import {
  getBlueOriginMissionKeyFromLaunch,
  type BlueOriginMissionKey
} from '@/lib/utils/blueOrigin';

const CONTENT_DEFAULT_LIMIT = 24;
const CONTENT_MAX_LIMIT = 60;
const CHUNK_SIZE = 200;

const SNAPI_SELECT =
  'snapi_uid,item_type,title,url,news_site,summary,image_url,published_at';

type SnapiJoinRow = {
  snapi_uid: string;
  launch_id: string;
};

type SnapiRow = {
  snapi_uid: string;
  item_type: string;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
};

type LaunchSocialRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  social_primary_post_url: string | null;
  social_primary_post_platform: string | null;
  social_primary_post_handle: string | null;
  social_primary_post_matched_at: string | null;
  spacex_x_post_url: string | null;
  spacex_x_post_captured_at: string | null;
};

const OFFICIAL_FALLBACK_CONTENT: BlueOriginContentItem[] = [
  {
    id: 'official:missions',
    missionKey: 'blue-origin-program',
    kind: 'article',
    title: 'Blue Origin Missions',
    summary: 'Official mission index and notable flight pages.',
    url: 'https://www.blueorigin.com/missions',
    imageUrl: null,
    publishedAt: null,
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin',
    confidence: 'high'
  },
  {
    id: 'official:news',
    missionKey: 'blue-origin-program',
    kind: 'article',
    title: 'Blue Origin News',
    summary: 'Official mission and program announcements.',
    url: 'https://www.blueorigin.com/news',
    imageUrl: null,
    publishedAt: null,
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin',
    confidence: 'high'
  },
  {
    id: 'official:gallery',
    missionKey: 'blue-origin-program',
    kind: 'photo',
    title: 'Blue Origin Gallery',
    summary: 'Official mission photos and media assets.',
    url: 'https://www.blueorigin.com/gallery',
    imageUrl: null,
    publishedAt: null,
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin',
    confidence: 'high'
  }
];

export async function fetchBlueOriginContentViewModel({
  mission,
  kind,
  limit,
  cursor
}: {
  mission: BlueOriginMissionKey | 'all';
  kind: BlueOriginContentKind | 'all';
  limit: number;
  cursor: string | null;
}): Promise<BlueOriginContentResponse> {
  const generatedAt = new Date().toISOString();
  const effectiveLimit = clampInt(limit, CONTENT_DEFAULT_LIMIT, 1, CONTENT_MAX_LIMIT);
  const offset = decodeCursor(cursor);

  const unified = await fetchUnifiedContent({ mission, kind, limit: effectiveLimit, offset });
  if (unified.items.length > 0) {
    return {
      generatedAt,
      mission,
      kind,
      items: unified.items,
      nextCursor: unified.nextCursor
    };
  }

  const fallback = filterFallbackByQuery({ mission, kind }).slice(offset, offset + effectiveLimit);
  const nextCursor = offset + fallback.length < filterFallbackByQuery({ mission, kind }).length ? encodeCursor(offset + fallback.length) : null;

  return {
    generatedAt,
    mission,
    kind,
    items: fallback,
    nextCursor
  };
}

async function fetchUnifiedContent({
  mission,
  kind,
  limit,
  offset
}: {
  mission: BlueOriginMissionKey | 'all';
  kind: BlueOriginContentKind | 'all';
  limit: number;
  offset: number;
}) {
  if (!isSupabaseConfigured()) {
    return {
      items: [] as BlueOriginContentItem[],
      nextCursor: null
    };
  }

  const supabase = createSupabasePublicClient();
  const buckets = await fetchBlueOriginLaunchBuckets();
  const launches = [...buckets.upcoming, ...buckets.recent];
  const launchIds = launches.map((launch) => launch.id);
  const missionByLaunch = new Map(launches.map((launch) => [launch.id, getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program']));

  const items: BlueOriginContentItem[] = [];

  if ((kind === 'all' || kind === 'article' || kind === 'photo') && launchIds.length) {
    const snapiUids = new Set<string>();

    for (const chunk of chunkArray(launchIds, CHUNK_SIZE)) {
      const { data: joinRows, error: joinError } = await supabase
        .from('snapi_item_launches')
        .select('snapi_uid,launch_id')
        .in('launch_id', chunk)
        .limit(1000);

      if (joinError) {
        console.error('blue origin snapi join query error', joinError);
        continue;
      }

      for (const row of (joinRows || []) as SnapiJoinRow[]) {
        const rowMission = missionByLaunch.get(row.launch_id) || 'blue-origin-program';
        if (mission !== 'all' && rowMission !== mission) continue;
        snapiUids.add(row.snapi_uid);
      }
    }

    const allUids = [...snapiUids.values()];
    for (const uidChunk of chunkArray(allUids, CHUNK_SIZE)) {
      const { data: rows, error } = await supabase
        .from('snapi_items')
        .select(SNAPI_SELECT)
        .in('snapi_uid', uidChunk)
        .order('published_at', { ascending: false })
        .limit(1000);

      if (error) {
        console.error('blue origin snapi items query error', error);
        continue;
      }

      for (const row of (rows || []) as SnapiRow[]) {
        const inferredKind = row.image_url ? 'photo' : 'article';
        if (kind !== 'all' && kind !== inferredKind) continue;

        items.push({
          id: `snapi:${row.snapi_uid}`,
          missionKey: mission === 'all' ? 'all' : mission,
          kind: inferredKind,
          title: row.title,
          summary: row.summary,
          url: row.url,
          imageUrl: row.image_url,
          publishedAt: row.published_at,
          sourceType: 'snapi',
          sourceLabel: row.news_site || 'Spaceflight News',
          confidence: 'medium'
        });
      }
    }
  }

  if (kind === 'all' || kind === 'social') {
    const { data: socialRows, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,mission_name,net,social_primary_post_url,social_primary_post_platform,social_primary_post_handle,social_primary_post_matched_at,spacex_x_post_url,spacex_x_post_captured_at')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%')
      .order('net', { ascending: false })
      .limit(300);

    if (error) {
      console.error('blue origin social query error', error);
    } else {
      for (const row of (socialRows || []) as LaunchSocialRow[]) {
        const rowMission = missionByLaunch.get(row.launch_id) || inferMissionFromNames(row.name, row.mission_name);
        if (mission !== 'all' && rowMission !== mission) continue;

        if (row.social_primary_post_url) {
          items.push({
            id: `social:${row.launch_id}:primary`,
            missionKey: rowMission,
            kind: 'social',
            title: row.name || row.mission_name || 'Blue Origin social update',
            summary: row.social_primary_post_handle ? `@${row.social_primary_post_handle}` : 'Official social post link',
            url: row.social_primary_post_url,
            imageUrl: null,
            publishedAt: row.social_primary_post_matched_at,
            sourceType: 'official-social',
            sourceLabel: row.social_primary_post_platform || 'social',
            confidence: 'medium'
          });
        }

        if (row.spacex_x_post_url) {
          items.push({
            id: `social:${row.launch_id}:x`,
            missionKey: rowMission,
            kind: 'social',
            title: row.name || row.mission_name || 'Related launch social update',
            summary: 'Launch-linked social post',
            url: row.spacex_x_post_url,
            imageUrl: null,
            publishedAt: row.spacex_x_post_captured_at,
            sourceType: 'launch-social',
            sourceLabel: 'X',
            confidence: 'low'
          });
        }
      }
    }
  }

  if (kind === 'all' || kind === 'data') {
    items.push({
      id: `data:upcoming:${mission}`,
      missionKey: mission,
      kind: 'data',
      title: 'Upcoming launches tracked',
      summary: String(
        launches.filter((launch) => {
          const key = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
          return mission === 'all' ? true : key === mission;
        }).length
      ),
      url: 'https://www.blueorigin.com/missions',
      imageUrl: null,
      publishedAt: new Date().toISOString(),
      sourceType: 'derived-metric',
      sourceLabel: 'T-Minus Zero',
      confidence: 'medium'
    });
  }

  const deduped = dedupeContent(items);
  const paged = deduped.slice(offset, offset + limit);
  const nextCursor = offset + paged.length < deduped.length ? encodeCursor(offset + paged.length) : null;

  return {
    items: paged,
    nextCursor
  };
}

export function parseBlueOriginContentMissionFilter(value: string | null): BlueOriginMissionKey | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'program' || normalized === 'blue-origin' || normalized === 'blue-origin-program') return 'blue-origin-program';
  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  return null;
}

export function parseBlueOriginContentKindFilter(value: string | null): BlueOriginContentKind | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'article' || normalized === 'articles' || normalized === 'news') return 'article';
  if (normalized === 'photo' || normalized === 'photos' || normalized === 'image' || normalized === 'images') return 'photo';
  if (normalized === 'social' || normalized === 'tweet' || normalized === 'posts') return 'social';
  if (normalized === 'data' || normalized === 'metrics') return 'data';
  return null;
}

export function parseBlueOriginContentLimit(value: string | null) {
  if (value == null || value === '') return CONTENT_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampInt(parsed, CONTENT_DEFAULT_LIMIT, 1, CONTENT_MAX_LIMIT);
}

export function parseBlueOriginContentCursor(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  return value.trim();
}

function filterFallbackByQuery({ mission, kind }: { mission: BlueOriginMissionKey | 'all'; kind: BlueOriginContentKind | 'all' }) {
  return OFFICIAL_FALLBACK_CONTENT.filter((item) => {
    const missionMatches = mission === 'all' ? true : item.missionKey === mission || item.missionKey === 'blue-origin-program';
    const kindMatches = kind === 'all' ? true : item.kind === kind;
    return missionMatches && kindMatches;
  });
}

function dedupeContent(items: BlueOriginContentItem[]) {
  const seen = new Set<string>();
  const deduped: BlueOriginContentItem[] = [];

  for (const item of items) {
    const key = `${item.kind}:${item.url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => Date.parse(b.publishedAt || '1970-01-01T00:00:00Z') - Date.parse(a.publishedAt || '1970-01-01T00:00:00Z'));
  return deduped;
}

function inferMissionFromNames(name: string | null, missionName: string | null): BlueOriginMissionKey {
  const text = `${name || ''} ${missionName || ''}`.toLowerCase();
  if (/new\s*shepard|\bns\s*-?\s*\d+/.test(text)) return 'new-shepard';
  if (/new\s*glenn|\bng\s*-?\s*\d+/.test(text)) return 'new-glenn';
  if (/blue\s*moon/.test(text)) return 'blue-moon';
  if (/blue\s*ring/.test(text)) return 'blue-ring';
  if (/\bbe\s*-?\s*4\b/.test(text)) return 'be-4';
  return 'blue-origin-program';
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function encodeCursor(offset: number) {
  return String(Math.max(0, Math.trunc(offset)));
}

function decodeCursor(cursor: string | null) {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, Math.trunc(value)));
  return clamped;
}
