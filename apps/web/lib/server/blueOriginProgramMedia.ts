import { cache } from 'react';
import { fetchBlueOriginLaunchBuckets } from '@/lib/server/blueOrigin';
import { fetchBlueOriginContentViewModel } from '@/lib/server/blueOriginContent';
import type { Launch } from '@/lib/types/launch';
import type { BlueOriginMediaImage, BlueOriginSocialPost, BlueOriginYouTubeVideo } from '@/lib/types/blueOrigin';
import { getBlueOriginMissionKeyFromLaunch } from '@/lib/utils/blueOrigin';

const JINA_TLD = String.fromCharCode(97, 105);
const BLUE_ORIGIN_X_TIMELINE_URL = `https://r.jina.${JINA_TLD}/http://x.com/blueorigin`;
const BLUE_ORIGIN_X_FALLBACK_STATUS_URL = 'https://twstalker.com/blueorigin';
const BLUE_ORIGIN_YOUTUBE_FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCVxTHEKKLxNjGcvVaZindlg';
const X_OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';
const REQUEST_TIMEOUT_MS = 9000;
const X_OEMBED_TIMEOUT_MS = 3000;

const FALLBACK_X_STATUS_IDS = [
  '2024169814697071052',
  '2023482362156196051',
  '2021616327861940531',
  '2018477072595738900',
  '2018372200407986616'
] as const;

const FALLBACK_YOUTUBE_VIDEOS: BlueOriginYouTubeVideo[] = [
  {
    id: 'youtube:Aa9Dy3INues',
    title: 'The Journey of NS-38',
    url: 'https://www.youtube.com/watch?v=Aa9Dy3INues',
    thumbnailUrl: 'https://i2.ytimg.com/vi/Aa9Dy3INues/hqdefault.jpg',
    publishedAt: '2026-01-23T23:36:29Z',
    summary: 'Mission recap video from New Shepard NS-38.',
    source: 'youtube-feed:fallback',
    confidence: 'medium'
  },
  {
    id: 'youtube:paZspH-TRXM',
    title: 'New Shepard Mission NS-38: Apogee',
    url: 'https://www.youtube.com/watch?v=paZspH-TRXM',
    thumbnailUrl: 'https://i1.ytimg.com/vi/paZspH-TRXM/hqdefault.jpg',
    publishedAt: '2026-01-23T00:30:35Z',
    summary: 'Official NS-38 mission clip.',
    source: 'youtube-feed:fallback',
    confidence: 'medium'
  },
  {
    id: 'youtube:-T_hA6mPiIY',
    title: 'Replay: New Shepard Mission NS-38 Webcast',
    url: 'https://www.youtube.com/watch?v=-T_hA6mPiIY',
    thumbnailUrl: 'https://i2.ytimg.com/vi/-T_hA6mPiIY/hqdefault.jpg',
    publishedAt: '2026-01-22T17:13:03Z',
    summary: 'Official webcast replay.',
    source: 'youtube-feed:fallback',
    confidence: 'medium'
  },
  {
    id: 'youtube:Tyx4AN4cBbU',
    title: 'Blue Origin 2025 Recap',
    url: 'https://www.youtube.com/watch?v=Tyx4AN4cBbU',
    thumbnailUrl: 'https://i1.ytimg.com/vi/Tyx4AN4cBbU/hqdefault.jpg',
    publishedAt: '2025-12-31T15:34:36Z',
    summary: 'Year-in-review short from Blue Origin.',
    source: 'youtube-feed:fallback',
    confidence: 'medium'
  },
  {
    id: 'youtube:w3uZ-TPpe9s',
    title: 'The Journey of NS-37',
    url: 'https://www.youtube.com/watch?v=w3uZ-TPpe9s',
    thumbnailUrl: 'https://i2.ytimg.com/vi/w3uZ-TPpe9s/hqdefault.jpg',
    publishedAt: '2025-12-22T16:38:34Z',
    summary: 'Mission recap video from New Shepard NS-37.',
    source: 'youtube-feed:fallback',
    confidence: 'medium'
  }
];

const FALLBACK_MEDIA_IMAGES: BlueOriginMediaImage[] = [
  {
    id: 'fallback-image:2024169814697071052',
    title: 'Blue Ring mission illustration',
    imageUrl: 'https://pbs.twimg.com/media/HBdLs-aW8AAmuxj?format=jpg',
    sourceUrl: 'https://x.com/blueorigin/status/2024169814697071052',
    publishedAt: null,
    sourceLabel: 'Blue Origin on X',
    confidence: 'medium'
  },
  {
    id: 'fallback-image:2023482362156196051',
    title: 'MK1 lunar lander thermal-vacuum testing',
    imageUrl: 'https://pbs.twimg.com/media/HBTad-DWQAA2NZ6?format=jpg',
    sourceUrl: 'https://x.com/blueorigin/status/2023482362156196051',
    publishedAt: null,
    sourceLabel: 'Blue Origin on X',
    confidence: 'medium'
  },
  {
    id: 'fallback-image:2021616327861940531',
    title: 'Mars Telecommunication Orbiter concept',
    imageUrl: 'https://pbs.twimg.com/media/HA45F8xW4AEJ5Me?format=jpg',
    sourceUrl: 'https://x.com/blueorigin/status/2021616327861940531',
    publishedAt: null,
    sourceLabel: 'Blue Origin on X',
    confidence: 'medium'
  }
];

type ParsedXTimelinePost = {
  url: string;
  handle: string;
  externalId: string;
  summary: string | null;
  mediaImageUrl: string | null;
};

type ParsedXTimelineImage = {
  imageUrl: string;
  sourceUrl: string;
};

type XTimelineSnapshot = {
  posts: ParsedXTimelinePost[];
  images: ParsedXTimelineImage[];
};

export const fetchBlueOriginSocialPosts = cache(async (limit = 5): Promise<BlueOriginSocialPost[]> => {
  const boundedLimit = clampInt(limit, 5, 1, 20);
  const [buckets, timelineSnapshot, fallbackStatusIds] = await Promise.all([
    fetchBlueOriginLaunchBuckets(),
    fetchBlueOriginXTimelineSnapshot(),
    fetchBlueOriginFallbackStatusIds()
  ]);

  const launchPosts = buildLaunchSocialPosts([...buckets.upcoming, ...buckets.recent]);
  const timelinePosts = buildTimelineSocialPosts(timelineSnapshot.posts);
  const fallbackPosts = buildFallbackSocialPosts(fallbackStatusIds);
  const fallbackTopUp = buildFallbackSocialPosts(FALLBACK_X_STATUS_IDS);

  const merged = dedupeSocialPosts([...launchPosts, ...timelinePosts, ...fallbackPosts]);
  const prioritized = dedupeSocialPosts([...merged, ...fallbackTopUp]);
  const validated = await selectEmbeddableSocialPosts(prioritized, boundedLimit);
  if (validated.length >= boundedLimit) return validated.slice(0, boundedLimit);
  return dedupeSocialPosts([...validated, ...fallbackTopUp]).slice(0, boundedLimit);
});

export const fetchBlueOriginYouTubeVideos = cache(async (limit = 8): Promise<BlueOriginYouTubeVideo[]> => {
  const boundedLimit = clampInt(limit, 8, 1, 24);
  const [buckets, feedVideos] = await Promise.all([fetchBlueOriginLaunchBuckets(), fetchBlueOriginYouTubeFeed()]);

  const launchVideos = buildLaunchVideoRows([...buckets.upcoming, ...buckets.recent]);
  const merged = dedupeYouTubeVideos([...feedVideos, ...launchVideos, ...FALLBACK_YOUTUBE_VIDEOS]);
  if (merged.length > 0) return merged.slice(0, boundedLimit);
  return FALLBACK_YOUTUBE_VIDEOS.slice(0, boundedLimit);
});

export const fetchBlueOriginMediaImages = cache(async (limit = 12): Promise<BlueOriginMediaImage[]> => {
  const boundedLimit = clampInt(limit, 12, 1, 40);
  const [buckets, photoContent, timelineSnapshot] = await Promise.all([
    fetchBlueOriginLaunchBuckets(),
    fetchBlueOriginContentViewModel({ mission: 'all', kind: 'photo', limit: 32, cursor: null }),
    fetchBlueOriginXTimelineSnapshot()
  ]);

  const launchImages = buildLaunchImageRows([...buckets.upcoming, ...buckets.recent]);
  const contentImages = photoContent.items
    .filter((item) => item.imageUrl)
    .map<BlueOriginMediaImage>((item) => ({
      id: `photo:${item.id}`,
      title: item.title,
      imageUrl: item.imageUrl as string,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
      sourceLabel: item.sourceLabel || 'Blue Origin media',
      confidence: item.confidence
    }));
  const timelineImages = timelineSnapshot.images.map<BlueOriginMediaImage>((image, index) => ({
    id: `x-image:${index}:${image.sourceUrl}`,
    title: 'Blue Origin update image',
    imageUrl: image.imageUrl,
    sourceUrl: image.sourceUrl,
    publishedAt: null,
    sourceLabel: 'Blue Origin on X',
    confidence: 'low'
  }));

  const merged = dedupeMediaImages([...launchImages, ...contentImages, ...timelineImages, ...FALLBACK_MEDIA_IMAGES]);
  return merged.slice(0, boundedLimit);
});

const fetchBlueOriginXTimelineSnapshot = cache(async (): Promise<XTimelineSnapshot> => {
  const markdown = await fetchTextWithTimeout(BLUE_ORIGIN_X_TIMELINE_URL, REQUEST_TIMEOUT_MS);
  if (!markdown) {
    return { posts: [], images: [] };
  }

  const imageByStatusUrl = new Map<string, string>();
  const imageRows: ParsedXTimelineImage[] = [];
  const imagePattern = /\[!\[[^\]]*]\((https:\/\/pbs\.twimg\.com\/[^)]+)\)]\((https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+(?:\/photo\/\d+)?)\)/g;
  for (const match of markdown.matchAll(imagePattern)) {
    const imageUrl = normalizeMediaUrl(match[1]);
    const sourceUrl = normalizeXStatusUrl(match[2]);
    if (!imageUrl || !sourceUrl) continue;
    if (!imageByStatusUrl.has(sourceUrl)) {
      imageByStatusUrl.set(sourceUrl, imageUrl);
    }
    imageRows.push({ imageUrl, sourceUrl });
  }

  const posts: ParsedXTimelinePost[] = [];
  const postPattern = /https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/g;
  for (const match of markdown.matchAll(postPattern)) {
    const handle = (match[1] || '').trim();
    const externalId = (match[2] || '').trim();
    if (!handle || !externalId) continue;

    const url = `https://x.com/${handle}/status/${externalId}`;
    posts.push({
      url,
      handle,
      externalId,
      summary: extractPostSnippet(markdown, match.index || 0),
      mediaImageUrl: imageByStatusUrl.get(url) || null
    });
  }

  return {
    posts: dedupeParsedTimelinePosts(posts),
    images: dedupeParsedTimelineImages(imageRows)
  };
});

async function fetchBlueOriginFallbackStatusIds() {
  const html = await fetchTextWithTimeout(BLUE_ORIGIN_X_FALLBACK_STATUS_URL, REQUEST_TIMEOUT_MS);
  if (!html) return [...FALLBACK_X_STATUS_IDS];

  const ids: string[] = [];
  const pattern = /blueorigin\/status\/(\d+)/g;
  for (const match of html.matchAll(pattern)) {
    const id = (match[1] || '').trim();
    if (!id) continue;
    if (!ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= 12) break;
  }

  for (const fallbackId of FALLBACK_X_STATUS_IDS) {
    if (!ids.includes(fallbackId)) {
      ids.push(fallbackId);
    }
  }

  return ids;
}

async function fetchBlueOriginYouTubeFeed(): Promise<BlueOriginYouTubeVideo[]> {
  const xml = await fetchTextWithTimeout(BLUE_ORIGIN_YOUTUBE_FEED_URL, REQUEST_TIMEOUT_MS);
  if (!xml) return [];
  return parseBlueOriginYouTubeFeedXml(xml);
}

function parseBlueOriginYouTubeFeedXml(xml: string): BlueOriginYouTubeVideo[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const videos: BlueOriginYouTubeVideo[] = [];

  for (const entry of entries) {
    const videoId = readXmlTag(entry, 'yt:videoId');
    const title = decodeXmlText(readXmlTag(entry, 'title') || 'Blue Origin video');
    const link = readXmlLinkHref(entry) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
    if (!link) continue;

    videos.push({
      id: `youtube:${videoId || slugifyValue(link)}`,
      title,
      url: link,
      thumbnailUrl: readXmlThumbnail(entry),
      publishedAt: normalizeIso(readXmlTag(entry, 'published')),
      summary: nullableText(decodeXmlText(readXmlTag(entry, 'media:description') || '')),
      source: 'youtube-feed:official',
      confidence: 'high'
    });
  }

  return videos;
}

function buildLaunchSocialPosts(launches: Launch[]): BlueOriginSocialPost[] {
  const sorted = [...launches].sort((a, b) => normalizeDateMs(b.net) - normalizeDateMs(a.net));
  const posts: BlueOriginSocialPost[] = [];

  for (const launch of sorted) {
    const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
    if (launch.socialPrimaryPostUrl) {
      const normalized = normalizeXStatusUrl(launch.socialPrimaryPostUrl);
      if (normalized) {
        posts.push({
          id: `launch-social:${launch.id}:primary`,
          missionKey,
          launchId: launch.id || null,
          launchName: launch.name || null,
          url: normalized,
          platform: 'x',
          handle: normalizeHandle(launch.socialPrimaryPostHandle, normalized),
          externalId: extractStatusId(normalized),
          postedAt: normalizeIso(launch.socialPrimaryPostMatchedAt) || normalizeIso(launch.net),
          summary: launch.name || 'Launch-linked social update',
          mediaImageUrl: null,
          source: 'launches_public_cache.social_primary_post_url',
          confidence: 'high'
        });
      }
    }

    if (launch.spacexXPostUrl) {
      const normalized = normalizeXStatusUrl(launch.spacexXPostUrl);
      if (normalized) {
        posts.push({
          id: `launch-social:${launch.id}:secondary`,
          missionKey,
          launchId: launch.id || null,
          launchName: launch.name || null,
          url: normalized,
          platform: 'x',
          handle: normalizeHandle('blueorigin', normalized),
          externalId: extractStatusId(normalized),
          postedAt: normalizeIso(launch.spacexXPostCapturedAt) || normalizeIso(launch.net),
          summary: launch.name || 'Launch-linked social update',
          mediaImageUrl: null,
          source: 'launches_public_cache.spacex_x_post_url',
          confidence: 'medium'
        });
      }
    }
  }

  return posts;
}

function buildTimelineSocialPosts(posts: ParsedXTimelinePost[]): BlueOriginSocialPost[] {
  return posts
    .filter((post) => post.handle.toLowerCase() === 'blueorigin')
    .map((post, index) => ({
    id: `timeline:${post.externalId}:${index}`,
    missionKey: 'blue-origin-program',
    launchId: null,
    launchName: null,
    url: post.url,
    platform: 'x',
    handle: post.handle,
    externalId: post.externalId,
    postedAt: null,
    summary: post.summary,
    mediaImageUrl: post.mediaImageUrl,
    source: 'x-timeline-scrape',
    confidence: 'medium'
  }));
}

function buildFallbackSocialPosts(statusIds: readonly string[]): BlueOriginSocialPost[] {
  return statusIds.slice(0, 20).map((statusId, index) => ({
    id: `fallback-x:${statusId}:${index}`,
    missionKey: 'blue-origin-program',
    launchId: null,
    launchName: null,
    url: `https://x.com/blueorigin/status/${statusId}`,
    platform: 'x',
    handle: 'blueorigin',
    externalId: statusId,
    postedAt: null,
    summary: 'Blue Origin mission/program post on X',
    mediaImageUrl: null,
    source: 'curated-fallback',
    confidence: 'low'
  }));
}

function buildLaunchVideoRows(launches: Launch[]): BlueOriginYouTubeVideo[] {
  const rows: BlueOriginYouTubeVideo[] = [];
  const sorted = [...launches].sort((a, b) => normalizeDateMs(b.net) - normalizeDateMs(a.net));

  for (const launch of sorted) {
    const urls = [launch.videoUrl || null, ...(launch.launchVidUrls || []).map((item) => item.url || null)];
    for (const value of urls) {
      const normalized = normalizeVideoUrl(value);
      if (!normalized) continue;
      const videoId = parseYouTubeVideoId(normalized);
      rows.push({
        id: `launch-video:${launch.id}:${videoId || slugifyValue(normalized)}`,
        title: launch.name ? `${launch.name} webcast/video` : 'Blue Origin webcast/video',
        url: normalized,
        thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
        publishedAt: normalizeIso(launch.net),
        summary: `Linked from launch record ${launch.name || launch.id}.`,
        source: 'launches_public_cache.video',
        confidence: 'medium'
      });
    }
  }

  return rows;
}

function buildLaunchImageRows(launches: Launch[]): BlueOriginMediaImage[] {
  const rows: BlueOriginMediaImage[] = [];
  const sorted = [...launches].sort((a, b) => normalizeDateMs(b.net) - normalizeDateMs(a.net));

  for (const launch of sorted) {
    const imageUrl = normalizeMediaUrl(launch.image?.full || launch.image?.thumbnail || null);
    if (!imageUrl) continue;

    rows.push({
      id: `launch-image:${launch.id}`,
      title: launch.name || 'Blue Origin mission image',
      imageUrl,
      sourceUrl: null,
      publishedAt: normalizeIso(launch.net),
      sourceLabel: 'Launch cache',
      confidence: 'high'
    });
  }

  return rows;
}

function dedupeSocialPosts(items: BlueOriginSocialPost[]) {
  const byUrl = new Map<string, BlueOriginSocialPost>();

  for (const item of items) {
    const key = normalizeXStatusUrl(item.url);
    if (!key) continue;

    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...item, url: key });
      continue;
    }

    if (compareSocialPostRows(item, existing) > 0) {
      byUrl.set(key, { ...item, url: key });
    }
  }

  return [...byUrl.values()].sort(compareSocialRowsDesc);
}

function dedupeYouTubeVideos(items: BlueOriginYouTubeVideo[]) {
  const byUrl = new Map<string, BlueOriginYouTubeVideo>();

  for (const item of items) {
    const key = normalizeVideoUrl(item.url);
    if (!key) continue;

    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...item, url: key });
      continue;
    }

    const candidateMs = normalizeDateMs(item.publishedAt);
    const existingMs = normalizeDateMs(existing.publishedAt);
    if (candidateMs > existingMs) {
      byUrl.set(key, { ...item, url: key });
    }
  }

  return [...byUrl.values()].sort((a, b) => normalizeDateMs(b.publishedAt) - normalizeDateMs(a.publishedAt));
}

function dedupeMediaImages(items: BlueOriginMediaImage[]) {
  const byUrl = new Map<string, BlueOriginMediaImage>();

  for (const item of items) {
    const key = normalizeMediaUrl(item.imageUrl);
    if (!key) continue;

    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...item, imageUrl: key });
      continue;
    }

    if (normalizeDateMs(item.publishedAt) > normalizeDateMs(existing.publishedAt)) {
      byUrl.set(key, { ...item, imageUrl: key });
    }
  }

  return [...byUrl.values()].sort((a, b) => normalizeDateMs(b.publishedAt) - normalizeDateMs(a.publishedAt));
}

function dedupeParsedTimelinePosts(items: ParsedXTimelinePost[]) {
  const byUrl = new Map<string, ParsedXTimelinePost>();

  for (const item of items) {
    const key = normalizeXStatusUrl(item.url);
    if (!key) continue;
    if (!byUrl.has(key)) {
      byUrl.set(key, { ...item, url: key });
    }
  }

  return [...byUrl.values()];
}

function dedupeParsedTimelineImages(items: ParsedXTimelineImage[]) {
  const byKey = new Map<string, ParsedXTimelineImage>();

  for (const item of items) {
    const imageUrl = normalizeMediaUrl(item.imageUrl);
    const sourceUrl = normalizeXStatusUrl(item.sourceUrl);
    if (!imageUrl || !sourceUrl) continue;
    const key = `${imageUrl}|${sourceUrl}`;
    if (!byKey.has(key)) {
      byKey.set(key, { imageUrl, sourceUrl });
    }
  }

  return [...byKey.values()];
}

async function selectEmbeddableSocialPosts(items: BlueOriginSocialPost[], limit: number) {
  const rows: BlueOriginSocialPost[] = [];
  const byUrl = new Set<string>();

  for (const item of items) {
    const normalizedUrl = normalizeXStatusUrl(item.url);
    if (!normalizedUrl || byUrl.has(normalizedUrl)) continue;
    byUrl.add(normalizedUrl);
    if (await isEmbeddableXPost(normalizedUrl)) {
      rows.push(item);
    }
    if (rows.length >= limit) break;
  }

  return rows;
}

async function isEmbeddableXPost(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), X_OEMBED_TIMEOUT_MS);
  try {
    const endpoint = new URL(X_OEMBED_ENDPOINT);
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('omit_script', '1');
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      next: { revalidate: 60 * 10 }
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { html?: unknown };
    return typeof payload?.html === 'string' && payload.html.includes('twitter-tweet');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function compareSocialPostRows(candidate: BlueOriginSocialPost, current: BlueOriginSocialPost) {
  const candidatePosted = normalizeDateMs(candidate.postedAt);
  const currentPosted = normalizeDateMs(current.postedAt);
  if (candidatePosted !== currentPosted) return candidatePosted - currentPosted;

  const candidateScore = socialConfidenceScore(candidate.confidence);
  const currentScore = socialConfidenceScore(current.confidence);
  if (candidateScore !== currentScore) return candidateScore - currentScore;

  return 0;
}

function compareSocialRowsDesc(left: BlueOriginSocialPost, right: BlueOriginSocialPost) {
  return compareSocialPostRows(right, left);
}

function socialConfidenceScore(value: BlueOriginSocialPost['confidence']) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function normalizeXStatusUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com'))) {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex((part) => part.toLowerCase() === 'status');
    if (statusIndex < 1 || statusIndex + 1 >= parts.length) return null;
    const handle = parts[statusIndex - 1];
    const statusId = parts[statusIndex + 1];
    if (!handle || !/^\d+$/.test(statusId)) return null;
    return `https://x.com/${handle}/status/${statusId}`;
  } catch {
    return null;
  }
}

function normalizeVideoUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    parsed.hash = '';
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com')) {
      const videoId = parseYouTubeVideoId(parsed.toString());
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeMediaUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    parsed.hash = '';
    if (parsed.hostname.toLowerCase() === 'pbs.twimg.com') {
      parsed.searchParams.delete('name');
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeHandle(value: string | null | undefined, url: string) {
  const cleaned = (value || '').replace(/^@+/, '').trim();
  if (cleaned) return cleaned;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] || 'blueorigin';
  } catch {
    return 'blueorigin';
  }
}

function extractStatusId(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\/status\/(\d+)/i);
  return match?.[1] || null;
}

function extractPostSnippet(markdown: string, matchIndex: number) {
  const start = Math.max(0, matchIndex - 360);
  const snippet = markdown
    .slice(start, matchIndex)
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!snippet) return null;
  const lines = snippet
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 14 && !/^quote$/i.test(line));

  const candidate = lines[lines.length - 1] || null;
  return candidate && candidate.length <= 220 ? candidate : candidate?.slice(Math.max(0, (candidate?.length || 0) - 220)) || null;
}

function parseYouTubeVideoId(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const shortId = parsed.pathname.split('/').filter(Boolean)[0];
      return shortId || null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.pathname === '/watch') {
        const watchId = parsed.searchParams.get('v');
        return watchId && watchId.trim() ? watchId.trim() : null;
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments[0] === 'shorts' && segments[1]) return segments[1];
      if (segments[0] === 'live' && segments[1]) return segments[1];
      if (segments[0] === 'embed' && segments[1]) return segments[1];
    }
    return null;
  } catch {
    return null;
  }
}

function readXmlTag(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = xml.match(pattern);
  return match?.[1]?.trim() || null;
}

function readXmlLinkHref(xml: string) {
  const match = xml.match(/<link\s+[^>]*rel="alternate"[^>]*href="([^"]+)"/i);
  return match?.[1] || null;
}

function readXmlThumbnail(xml: string) {
  const match = xml.match(/<media:thumbnail[^>]*url="([^"]+)"/i);
  return match?.[1] || null;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeIso(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeDateMs(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function nullableText(value: string | null | undefined) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function slugifyValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      },
      signal: controller.signal,
      next: { revalidate: 60 * 30 }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
