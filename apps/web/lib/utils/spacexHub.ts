import type { Launch } from '@/lib/types/launch';
import { getSpaceXMissionKeyFromLaunch } from '@/lib/utils/spacexProgram';

export const SPACEX_MISSION_ITEMS = [
  { key: 'starship', label: 'Starship', href: '/spacex/missions/starship' },
  { key: 'falcon-9', label: 'Falcon 9', href: '/spacex/missions/falcon-9' },
  { key: 'falcon-heavy', label: 'Falcon Heavy', href: '/spacex/missions/falcon-heavy' },
  { key: 'dragon', label: 'Dragon', href: '/spacex/missions/dragon' }
] as const;

export const SPACEX_FALLBACK_TWEET_IDS = [
  '2024678839796854899',
  '2024677800884449462',
  '2024663255675813955',
  '2024661082992693413',
  '2024659880091533557'
] as const;

export type SpaceXMissionPulseEntry = {
  key: string;
  label: string;
  upcoming: number;
  recent: number;
  total: number;
};

export type SpaceXVideoArchiveEntry = {
  id: string;
  url: string;
  label: string;
  launchName: string;
  dateLabel: string;
};

export type SpaceXEmbeddedPost = {
  id: string;
  tweetId: string;
  tweetUrl: string;
};

export function formatUpdatedLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

export function formatLaunchDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(parsed));
}

export function formatFinanceValue(value: number, unit: string | null) {
  if (unit === 'USD') return `$${Math.round(value).toLocaleString()}`;
  if (unit) return `${Math.round(value).toLocaleString()} ${unit}`;
  return Math.round(value).toLocaleString();
}

export function buildMissionPulse(launches: Launch[]): SpaceXMissionPulseEntry[] {
  const byMission = new Map<string, { upcoming: number; recent: number }>();
  const nowMs = Date.now();

  for (const mission of SPACEX_MISSION_ITEMS) {
    byMission.set(mission.key, { upcoming: 0, recent: 0 });
  }

  for (const launch of launches) {
    const missionKey = getSpaceXMissionKeyFromLaunch(launch);
    if (!missionKey || missionKey === 'spacex-program') continue;
    const bucket = byMission.get(missionKey);
    if (!bucket) continue;
    const netMs = Date.parse(launch.net || '');
    if (Number.isFinite(netMs) && netMs >= nowMs) {
      bucket.upcoming += 1;
    } else {
      bucket.recent += 1;
    }
  }

  return SPACEX_MISSION_ITEMS.map((mission) => {
    const value = byMission.get(mission.key) || { upcoming: 0, recent: 0 };
    return {
      key: mission.key,
      label: mission.label,
      upcoming: value.upcoming,
      recent: value.recent,
      total: value.upcoming + value.recent
    };
  });
}

export function buildVideoArchive(launches: Launch[], limit: number): SpaceXVideoArchiveEntry[] {
  const rows: Array<SpaceXVideoArchiveEntry & { netMs: number }> = [];
  const seen = new Set<string>();

  for (const launch of launches) {
    const netMs = Date.parse(launch.net || '');
    const dateLabel = formatLaunchDate(launch.net || '');
    const primaryUrl = normalizeUrl(launch.videoUrl || null);
    if (primaryUrl && !seen.has(primaryUrl)) {
      seen.add(primaryUrl);
      rows.push({
        id: `${launch.id}:video:primary`,
        url: primaryUrl,
        label: 'Primary webcast',
        launchName: launch.name,
        dateLabel,
        netMs: Number.isFinite(netMs) ? netMs : 0
      });
    }

    for (const video of launch.launchVidUrls || []) {
      const url = normalizeUrl(video?.url || null);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push({
        id: `${launch.id}:video:${url}`,
        url,
        label: video?.title?.trim() || 'Mission video link',
        launchName: launch.name,
        dateLabel,
        netMs: Number.isFinite(netMs) ? netMs : 0
      });
    }
  }

  return rows
    .sort((left, right) => right.netMs - left.netMs)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      url: row.url,
      label: row.label,
      launchName: row.launchName,
      dateLabel: row.dateLabel
    }));
}

export function topUpEmbeddedPosts(
  primary: SpaceXEmbeddedPost[],
  fallback: SpaceXEmbeddedPost[],
  limit: number
): SpaceXEmbeddedPost[] {
  const byTweet = new Map<string, SpaceXEmbeddedPost>();
  for (const row of [...primary, ...fallback]) {
    if (!row.tweetId || !row.tweetUrl) continue;
    if (!byTweet.has(row.tweetId)) byTweet.set(row.tweetId, row);
    if (byTweet.size >= limit) break;
  }
  return [...byTweet.values()].slice(0, limit);
}

function normalizeUrl(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}
