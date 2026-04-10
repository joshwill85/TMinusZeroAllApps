import { cache } from 'react';
import { buildArtemisFaq, fetchArtemisLaunchBuckets } from '@/lib/server/artemis';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { fetchArtemisMissionProfile } from '@/lib/server/artemisMissionProfiles';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ArtemisChangeItem,
  ArtemisMissionEvidenceLink,
  ArtemisMissionHubData,
  ArtemisMissionHubKey,
  ArtemisMissionNewsItem,
  ArtemisMissionSocialItem,
  ArtemisMissionWatchLink
} from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';
import { getArtemisMissionKeyFromLaunch } from '@/lib/utils/artemis';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const MAX_LAUNCH_ITEMS = 32;
const MAX_CHANGE_ITEMS = 12;
const MAX_NEWS_ITEMS = 12;
const MAX_SOCIAL_ITEMS = 16;
const MAX_TIMELINE_EVIDENCE_ITEMS = 10;
const CHUNK_SIZE = 200;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

const SNAPI_SELECT =
  'snapi_uid, item_type, title, url, news_site, summary, image_url, published_at, authors, featured';

type SnapiNewsRow = {
  snapi_uid: string;
  item_type: string;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  authors: Array<{ name?: string | null }> | null;
  featured: boolean | null;
};

type SnapiJoinRow = {
  snapi_uid: string;
  launch_id: string;
};

type SocialPostRow = {
  id: string;
  launch_id: string;
  platform: string;
  post_type: string;
  status: string;
  post_text: string | null;
  reply_text: string | null;
  external_id: string | null;
  scheduled_for: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ArtemisTimelineEvidenceRow = {
  id: string;
  title: string;
  summary: string | null;
  event_time: string | null;
  announced_time: string | null;
  source_url: string | null;
  source_document_id: string | null;
  source_type: string;
};

type ArtemisSourceDocumentRow = {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  published_at: string | null;
  fetched_at: string | null;
};

export const fetchArtemisMissionHubData = cache(async (missionKey: ArtemisMissionHubKey): Promise<ArtemisMissionHubData> => {
  const [profile, buckets] = await Promise.all([fetchArtemisMissionProfile(missionKey), fetchArtemisLaunchBuckets()]);

  const upcoming = buckets.upcoming.filter((launch) => getArtemisMissionKeyFromLaunch(launch) === missionKey).slice(0, MAX_LAUNCH_ITEMS);
  const recent = buckets.recent.filter((launch) => getArtemisMissionKeyFromLaunch(launch) === missionKey).slice(0, MAX_LAUNCH_ITEMS);
  const combined = dedupeLaunches([...upcoming, ...recent]);
  const nextLaunch = upcoming[0] || null;
  const primaryLaunch = nextLaunch || recent[0] || combined[0] || null;
  const launchIds = combined.map((launch) => launch.id);
  const launchNameById = new Map(combined.map((launch) => [launch.id, launch.name]));

  const [news, socialPosts, timelineEvidenceLinks] = await Promise.all([
    fetchMissionNews({ keywords: profile.keywords, launchIds }),
    fetchMissionSocialPosts({
      missionKey,
      keywords: profile.keywords,
      launchNameById
    }),
    fetchTimelineEvidenceLinks(missionKey)
  ]);

  const social = mergeSocialFeeds({
    launches: combined,
    socialPosts
  }).slice(0, MAX_SOCIAL_ITEMS);

  const watchLinks = mergeWatchLinks(buildWatchLinks(primaryLaunch), profile.watchLinks);
  const evidenceLinks = mergeEvidenceLinks(buildEvidenceLinks(primaryLaunch), timelineEvidenceLinks, profile.evidenceLinks);
  const launchCrew = buildCrewHighlights(primaryLaunch);
  const crewHighlights = launchCrew.length ? launchCrew : profile.crewHighlights.slice(0, 8);

  const changes = buildMissionChanges(combined);
  const lastUpdated = resolveLastUpdated(combined, buckets.generatedAt);

  const fallbackFaq = missionKey === 'artemis-ii' ? buildArtemisFaq('mission') : buildArtemisFaq('program');
  const faq = profile.faq && profile.faq.length > 0 ? profile.faq : fallbackFaq;

  return {
    missionKey,
    missionName: profile.missionName,
    generatedAt: buckets.generatedAt,
    lastUpdated,
    nextLaunch,
    upcoming,
    recent,
    crewHighlights,
    changes,
    faq,
    watchLinks,
    evidenceLinks,
    news,
    social,
    coverage: {
      hasLaunch: Boolean(primaryLaunch),
      hasCrew: crewHighlights.length > 0,
      hasWatchLinks: watchLinks.length > 0,
      hasEvidenceLinks: evidenceLinks.length > 0,
      hasNews: news.length > 0,
      hasSocial: social.length > 0
    }
  };
});

async function fetchMissionNews({ keywords, launchIds }: { keywords: string[]; launchIds: string[] }) {
  if (!isSupabaseConfigured()) return [] as ArtemisMissionNewsItem[];

  const supabase = createSupabasePublicClient();
  const launchMatchedUids = new Set<string>();
  const keywordMatchedUids = new Set<string>();
  const rowsByUid = new Map<string, SnapiNewsRow>();

  if (launchIds.length > 0) {
    for (const chunk of chunkArray(launchIds, CHUNK_SIZE)) {
      const { data: joinRows, error: joinError } = await supabase.from('snapi_item_launches').select('snapi_uid,launch_id').in('launch_id', chunk);
      if (joinError) {
        console.error('artemis mission join query error', joinError);
        continue;
      }

      const launchLinks = (joinRows || []) as SnapiJoinRow[];
      const uids = dedupeStrings(launchLinks.map((row) => row.snapi_uid));
      if (!uids.length) continue;
      uids.forEach((uid) => launchMatchedUids.add(uid));

      for (const uidChunk of chunkArray(uids, CHUNK_SIZE)) {
        const { data: itemRows, error: itemError } = await supabase
          .from('snapi_items')
          .select(SNAPI_SELECT)
          .in('snapi_uid', uidChunk)
          .order('published_at', { ascending: false });
        if (itemError) {
          console.error('artemis mission launch news query error', itemError);
          continue;
        }
        for (const row of (itemRows || []) as SnapiNewsRow[]) {
          if (!row?.snapi_uid || !row?.title || !row?.url) continue;
          rowsByUid.set(row.snapi_uid, row);
        }
      }
    }
  }

  const keywordFilter = buildKeywordOrFilter({ keywords, fields: ['title', 'summary'] });
  if (keywordFilter) {
    const { data: keywordRows, error: keywordError } = await supabase
      .from('snapi_items')
      .select(SNAPI_SELECT)
      .or(keywordFilter)
      .order('published_at', { ascending: false })
      .limit(160);
    if (keywordError) {
      console.error('artemis mission keyword news query error', keywordError);
    } else {
      for (const row of (keywordRows || []) as SnapiNewsRow[]) {
        if (!row?.snapi_uid || !row?.title || !row?.url) continue;
        keywordMatchedUids.add(row.snapi_uid);
        rowsByUid.set(row.snapi_uid, row);
      }
    }
  }

  const scored = [...rowsByUid.values()].map((row) => {
    const launchMatched = launchMatchedUids.has(row.snapi_uid);
    const keywordMatched = keywordMatchedUids.has(row.snapi_uid);
    const score =
      (launchMatched ? 3 : 0) +
      (keywordMatched ? 2 : 0) +
      (row.featured ? 1 : 0) +
      (matchesKeyword(row.title, keywords) ? 1 : 0);

    const relevance: ArtemisMissionNewsItem['relevance'] = launchMatched && keywordMatched ? 'both' : launchMatched ? 'launch-join' : 'mission-keyword';
    return { row, score, relevance };
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return parseDateOrZero(b.row.published_at) - parseDateOrZero(a.row.published_at);
  });

  return scored.slice(0, MAX_NEWS_ITEMS).map(({ row, relevance }) => ({
    snapiUid: row.snapi_uid,
    itemType: row.item_type,
    title: row.title,
    url: row.url,
    newsSite: row.news_site,
    summary: row.summary,
    imageUrl: row.image_url,
    publishedAt: row.published_at,
    authors: mapAuthorNames(row.authors),
    featured: Boolean(row.featured),
    relevance
  }));
}

async function fetchMissionSocialPosts({
  missionKey,
  keywords,
  launchNameById
}: {
  missionKey: ArtemisMissionHubKey;
  keywords: string[];
  launchNameById: Map<string, string>;
}) {
  const socialItems: ArtemisMissionSocialItem[] = [];

  if (isSupabaseConfigured()) {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase
      .from('artemis_content_items')
      .select('id,url,summary,platform,published_at,captured_at,external_id,mission_key')
      .eq('kind', 'social')
      .in('mission_key', [missionKey, 'program'])
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('captured_at', { ascending: false, nullsFirst: false })
      .limit(80);

    if (error) {
      console.error('artemis mission content social query error', error);
    } else {
      for (const row of (data || []) as Array<{
        id: string;
        url: string;
        summary: string | null;
        platform: string | null;
        published_at: string | null;
        captured_at: string | null;
        external_id: string | null;
        mission_key: string;
      }>) {
        const publishedAt = row.published_at || row.captured_at;
        socialItems.push({
          id: row.id,
          launchId: row.mission_key || 'program',
          launchName: null,
          platform: row.platform || 'x',
          postType: 'social_post',
          status: 'captured',
          text: row.summary,
          replyText: null,
          externalId: row.external_id,
          externalUrl: row.url,
          scheduledFor: null,
          postedAt: publishedAt,
          createdAt: publishedAt || row.captured_at || new Date().toISOString(),
          updatedAt: row.captured_at || publishedAt || new Date().toISOString()
        });
      }
    }
  }

  if (!isSupabaseAdminConfigured()) return socialItems;

  const launchIds = [...launchNameById.keys()];
  const supabase = createSupabaseAdminClient();

  const launchLinkedRows = launchIds.length
    ? await supabase
        .from('social_posts')
        .select('id,launch_id,platform,post_type,status,post_text,reply_text,external_id,scheduled_for,posted_at,created_at,updated_at')
        .in('launch_id', launchIds)
        .order('created_at', { ascending: false })
        .limit(120)
    : { data: [] as SocialPostRow[], error: null };

  if (launchLinkedRows.error) {
    console.error('artemis mission social query error', launchLinkedRows.error);
    return socialItems;
  }

  let rows = (launchLinkedRows.data || []) as SocialPostRow[];

  if (rows.length === 0) {
    const keywordFilter = buildKeywordOrFilter({ keywords, fields: ['post_text', 'reply_text'] });
    if (keywordFilter) {
      const fallbackRows = await supabase
        .from('social_posts')
        .select('id,launch_id,platform,post_type,status,post_text,reply_text,external_id,scheduled_for,posted_at,created_at,updated_at')
        .or(keywordFilter)
        .order('created_at', { ascending: false })
        .limit(80);
      if (fallbackRows.error) {
        console.error('artemis mission social fallback query error', fallbackRows.error);
      } else {
        rows = (fallbackRows.data || []) as SocialPostRow[];
      }
    }
  }

  const legacyItems = rows.map((row) => ({
    id: row.id,
    launchId: row.launch_id,
    launchName: launchNameById.get(row.launch_id) || null,
    platform: row.platform,
    postType: row.post_type,
    status: row.status,
    text: row.post_text,
    replyText: row.reply_text,
    externalId: row.external_id,
    externalUrl: buildSocialExternalUrl(row.platform, row.external_id),
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return [...socialItems, ...legacyItems];
}

async function fetchTimelineEvidenceLinks(missionKey: ArtemisMissionHubKey) {
  if (!isSupabaseConfigured()) return [] as ArtemisMissionEvidenceLink[];
  const supabase = createSupabasePublicClient();

  const { data: eventRows, error: eventError } = await supabase
    .from('artemis_timeline_events')
    .select('id,title,summary,event_time,announced_time,source_url,source_document_id,source_type')
    .eq('mission_key', missionKey)
    .order('announced_time', { ascending: false })
    .limit(28);

  if (eventError) {
    console.error('artemis timeline evidence query error', eventError);
    return [] as ArtemisMissionEvidenceLink[];
  }

  const rows = (eventRows || []) as ArtemisTimelineEvidenceRow[];
  const documentIds = dedupeStrings(rows.map((row) => row.source_document_id || ''));

  const docsById = new Map<string, ArtemisSourceDocumentRow>();
  if (documentIds.length > 0) {
    const { data: docs, error: docsError } = await supabase
      .from('artemis_source_documents')
      .select('id,url,title,source_type,published_at,fetched_at')
      .in('id', documentIds)
      .limit(64);

    if (docsError) {
      console.error('artemis source document evidence query error', docsError);
    } else {
      for (const doc of (docs || []) as ArtemisSourceDocumentRow[]) {
        docsById.set(doc.id, doc);
      }
    }
  }

  const links: ArtemisMissionEvidenceLink[] = [];
  const seen = new Set<string>();

  const push = (entry: ArtemisMissionEvidenceLink | null) => {
    if (!entry?.url) return;
    const key = `${entry.kind || 'reference'}:${entry.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(entry);
  };

  for (const row of rows) {
    const timelineUrl = normalizeUrl(row.source_url);
    if (timelineUrl) {
      push({
        label: row.title || 'Timeline source',
        url: timelineUrl,
        source: formatTimelineSourceLabel(row.source_type),
        detail: normalizeText(row.summary),
        capturedAt: row.announced_time || row.event_time || null,
        kind: 'reference'
      });
    }

    const sourceDoc = row.source_document_id ? docsById.get(row.source_document_id) : null;
    if (sourceDoc && sourceDoc.url) {
      push({
        label: normalizeText(sourceDoc.title) || row.title || 'Artemis source document',
        url: sourceDoc.url,
        source: formatTimelineSourceLabel(sourceDoc.source_type),
        detail: normalizeText(row.summary),
        capturedAt: sourceDoc.published_at || sourceDoc.fetched_at || row.announced_time || row.event_time || null,
        kind: 'reference'
      });
    }

    if (links.length >= MAX_TIMELINE_EVIDENCE_ITEMS) break;
  }

  return links;
}

function mergeSocialFeeds({
  launches,
  socialPosts
}: {
  launches: Launch[];
  socialPosts: ArtemisMissionSocialItem[];
}) {
  const merged: ArtemisMissionSocialItem[] = [];
  const seen = new Set<string>();

  const push = (item: ArtemisMissionSocialItem) => {
    const key = `${item.platform}:${item.externalId || item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };

  for (const post of socialPosts) {
    push(post);
  }

  for (const launch of launches) {
    const updates = Array.isArray(launch.updates) ? launch.updates : [];
    for (let index = 0; index < updates.length; index += 1) {
      const update = updates[index];
      const infoUrl = normalizeUrl(update?.info_url);
      const xStatusId = infoUrl ? extractXStatusId(infoUrl) : null;
      const publishedAt = normalizeText(update?.created_on);
      const resolvedExternalUrl = xStatusId
        ? `https://x.com/i/web/status/${encodeURIComponent(xStatusId)}`
        : infoUrl;
      const text = normalizeText(update?.comment);
      if (!resolvedExternalUrl && !text) continue;

      push({
        id: `launch-update:${launch.id}:${update?.id || index}`,
        launchId: launch.id,
        launchName: launch.name,
        platform: xStatusId ? 'x' : 'launch-update',
        postType: 'launch_update',
        status: 'captured',
        text,
        replyText: null,
        externalId: xStatusId,
        externalUrl: resolvedExternalUrl,
        scheduledFor: null,
        postedAt: publishedAt,
        createdAt: publishedAt || launch.lastUpdated || launch.net,
        updatedAt: publishedAt || launch.lastUpdated || launch.net
      });
    }

    const providerPrimaryUrl =
      launch.socialPrimaryPostUrl ||
      (launch.socialPrimaryPostId
        ? `https://x.com/i/web/status/${encodeURIComponent(launch.socialPrimaryPostId)}`
        : null);
    if (providerPrimaryUrl) {
      push({
        id: `launch-primary:${launch.id}`,
        launchId: launch.id,
        launchName: launch.name,
        platform: launch.socialPrimaryPostPlatform || 'x',
        postType: 'provider_primary',
        status: 'captured',
        text: null,
        replyText: null,
        externalId: launch.socialPrimaryPostId || null,
        externalUrl: providerPrimaryUrl,
        scheduledFor: null,
        postedAt: launch.socialPrimaryPostMatchedAt || null,
        createdAt: launch.socialPrimaryPostMatchedAt || launch.net,
        updatedAt: launch.socialPrimaryPostMatchedAt || launch.net
      });
    }

    const fallbackUrl =
      launch.spacexXPostUrl ||
      (launch.spacexXPostId ? `https://x.com/SpaceX/status/${encodeURIComponent(launch.spacexXPostId)}` : null);
    if (!fallbackUrl) continue;

    push({
      id: `launch-x:${launch.id}`,
      launchId: launch.id,
      launchName: launch.name,
      platform: 'x',
      postType: 'provider_snapshot',
      status: 'captured',
      text: null,
      replyText: null,
      externalId: launch.spacexXPostId || null,
      externalUrl: fallbackUrl,
      scheduledFor: null,
      postedAt: launch.spacexXPostCapturedAt || null,
      createdAt: launch.spacexXPostCapturedAt || launch.net,
      updatedAt: launch.spacexXPostCapturedAt || launch.net
    });
  }

  merged.sort((a, b) => parseDateOrZero(b.postedAt || b.scheduledFor || b.createdAt) - parseDateOrZero(a.postedAt || a.scheduledFor || a.createdAt));
  return merged;
}

function mergeWatchLinks(primary: ArtemisMissionWatchLink[], fallback: ArtemisMissionWatchLink[]) {
  const links: ArtemisMissionWatchLink[] = [];
  const seen = new Set<string>();

  for (const entry of [...primary, ...fallback]) {
    const url = normalizeUrl(entry.url);
    const label = normalizeText(entry.label);
    if (!url || !label) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label });
    if (links.length >= 12) break;
  }

  return links;
}

function mergeEvidenceLinks(
  launchEvidence: ArtemisMissionEvidenceLink[],
  timelineEvidence: ArtemisMissionEvidenceLink[],
  profileEvidence: ArtemisMissionEvidenceLink[]
) {
  const links: ArtemisMissionEvidenceLink[] = [];
  const seen = new Set<string>();

  for (const entry of [...launchEvidence, ...timelineEvidence, ...profileEvidence]) {
    const url = normalizeUrl(entry.url);
    const label = normalizeText(entry.label);
    if (!url || !label) continue;
    const key = `${entry.kind || 'reference'}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ ...entry, url, label });
    if (links.length >= 16) break;
  }

  return links;
}

function buildWatchLinks(launch: Launch | null) {
  if (!launch) return [] as ArtemisMissionWatchLink[];
  const links: ArtemisMissionWatchLink[] = [];
  const seen = new Set<string>();

  const push = (url: string | null | undefined, label: string) => {
    if (!url) return;
    const normalized = url.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    links.push({ url: normalized, label });
  };

  push(launch.videoUrl, 'Primary webcast');
  for (const link of launch.launchVidUrls || []) {
    push(link?.url, link?.title?.trim() || 'Launch video link');
  }
  for (const link of launch.mission?.vidUrls || []) {
    push(link?.url, link?.title?.trim() || 'Mission video link');
  }

  return links.slice(0, 10);
}

function buildEvidenceLinks(launch: Launch | null) {
  if (!launch) return [] as ArtemisMissionEvidenceLink[];
  const links: ArtemisMissionEvidenceLink[] = [];
  const seen = new Set<string>();

  const push = (entry: ArtemisMissionEvidenceLink | null) => {
    if (!entry || !entry.url) return;
    const key = `${entry.kind || 'reference'}:${entry.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(entry);
  };

  push({
    label: 'Launch status',
    url: '#status',
    source: 'Launch feed',
    detail: launch.statusText || launch.status || 'Status pending',
    capturedAt: launch.lastUpdated || launch.cacheGeneratedAt || launch.net,
    kind: 'status'
  });

  if (launch.videoUrl) {
    push({
      label: 'Primary webcast',
      url: launch.videoUrl,
      source: launch.provider,
      capturedAt: launch.net,
      kind: 'stream'
    });
  }

  for (const link of launch.launchInfoUrls || []) {
    if (!link?.url) continue;
    push({
      label: link.title?.trim() || 'Launch information',
      url: link.url,
      source: link.source || 'Launch feed',
      detail: link.description || null,
      kind: 'report'
    });
  }

  for (const link of launch.mission?.infoUrls || []) {
    if (!link?.url) continue;
    push({
      label: link.title?.trim() || 'Mission reference',
      url: link.url,
      source: link.source || 'Mission feed',
      detail: link.description || launch.mission?.name || null,
      kind: 'reference'
    });
  }

  for (const link of launch.launchVidUrls || []) {
    if (!link?.url) continue;
    push({
      label: link.title?.trim() || 'Launch stream',
      url: link.url,
      source: link.source || link.publisher || launch.provider,
      detail: link.description || null,
      kind: 'stream'
    });
  }

  for (const link of launch.mission?.vidUrls || []) {
    if (!link?.url) continue;
    push({
      label: link.title?.trim() || 'Mission stream',
      url: link.url,
      source: link.source || link.publisher || 'Mission feed',
      detail: link.description || launch.mission?.name || null,
      kind: 'stream'
    });
  }

  for (const [index, update] of (launch.updates || []).entries()) {
    const infoUrl = normalizeUrl(update?.info_url);
    if (!infoUrl) continue;
    const xStatusId = extractXStatusId(infoUrl);
    push({
      label: xStatusId ? 'Mission social update' : `Launch update source ${index + 1}`,
      url: xStatusId ? `https://x.com/i/web/status/${encodeURIComponent(xStatusId)}` : infoUrl,
      source: normalizeText(update?.created_by) || 'Launch update',
      detail: normalizeText(update?.comment),
      capturedAt: normalizeText(update?.created_on),
      kind: xStatusId ? 'social' : 'report'
    });
  }

  if (launch.flightclubUrl) {
    push({
      label: 'Trajectory profile',
      url: launch.flightclubUrl,
      source: 'FlightClub',
      kind: 'reference'
    });
  }

  const socialUrl =
    launch.spacexXPostUrl ||
    (launch.spacexXPostId ? `https://x.com/SpaceX/status/${encodeURIComponent(launch.spacexXPostId)}` : null);
  if (socialUrl) {
    push({
      label: 'Mission social update',
      url: socialUrl,
      source: 'X',
      capturedAt: launch.spacexXPostCapturedAt || null,
      kind: 'social'
    });
  }

  return links.slice(0, 12);
}

function buildCrewHighlights(launch: Launch | null) {
  if (!launch || !Array.isArray(launch.crew)) return [] as string[];
  return launch.crew
    .map((entry) => {
      const astronaut = entry?.astronaut?.trim();
      const role = entry?.role?.trim();
      if (!astronaut) return null;
      return role ? `${astronaut} (${role})` : astronaut;
    })
    .filter(Boolean)
    .slice(0, 8) as string[];
}

function buildMissionChanges(launches: Launch[]) {
  const mapped = launches
    .map((launch): ArtemisChangeItem | null => {
      const date = resolveLaunchIso(launch);
      if (!date) return null;
      const status = launch.statusText?.trim() || launch.status || 'Status pending';
      return {
        title: launch.name,
        summary: `Status: ${status}. NET: ${formatDateLabel(launch.net)}.`,
        date,
        href: buildLaunchHref(launch)
      };
    })
    .filter((entry): entry is ArtemisChangeItem => Boolean(entry));

  mapped.sort((a, b) => parseDateOrZero(b.date) - parseDateOrZero(a.date));
  return mapped.slice(0, MAX_CHANGE_ITEMS);
}

function resolveLastUpdated(launches: Launch[], fallbackIso: string) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = launches
    .flatMap((launch) => [launch.cacheGeneratedAt, launch.lastUpdated, launch.net])
    .map((value) => toIsoOrNull(value))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });
  if (!candidates.length) {
    const fallback = toIsoOrNull(fallbackIso);
    if (!fallback) return null;
    const parsedFallbackMs = Date.parse(fallback);
    return Number.isFinite(parsedFallbackMs) && parsedFallbackMs <= maxAllowedMs ? fallback : null;
  }
  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function dedupeLaunches(launches: Launch[]) {
  const seen = new Set<string>();
  const deduped: Launch[] = [];
  for (const launch of launches) {
    if (seen.has(launch.id)) continue;
    seen.add(launch.id);
    deduped.push(launch);
  }
  return deduped;
}

function buildKeywordOrFilter({ keywords, fields }: { keywords: string[]; fields: string[] }) {
  const filters: string[] = [];
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword);
    if (!normalized) continue;
    const escaped = normalized.replace(/,/g, ' ').trim();
    const term = `%${escaped}%`;
    for (const field of fields) {
      filters.push(`${field}.ilike.${term}`);
    }
  }
  return filters.join(',');
}

function matchesKeyword(value: string | null | undefined, keywords: string[]) {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

function formatTimelineSourceLabel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return 'Timeline source';
  return `Timeline (${normalized.replace(/_/g, ' ')})`;
}

function mapAuthorNames(authors: SnapiNewsRow['authors']) {
  if (!Array.isArray(authors)) return [] as string[];
  return authors
    .map((author) => (typeof author?.name === 'string' ? author.name.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function chunkArray<T>(values: T[], size: number) {
  if (size <= 0) return [values];
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function resolveLaunchIso(launch: Launch) {
  const values = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
  for (const value of values) {
    const iso = toIsoOrNull(value);
    if (iso) return iso;
  }
  return null;
}

function buildSocialExternalUrl(platform: string, externalId: string | null) {
  if (!externalId) return null;
  if (/^https?:\/\//i.test(externalId)) return externalId;
  const normalized = platform.trim().toLowerCase();
  if (normalized === 'x' || normalized === 'twitter') {
    return `https://x.com/i/web/status/${encodeURIComponent(externalId)}`;
  }
  if (normalized === 'facebook') {
    return `https://www.facebook.com/${encodeURIComponent(externalId)}`;
  }
  return null;
}

function extractXStatusId(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('x.com') && !host.endsWith('twitter.com')) return null;
    const segments = parsed.pathname.split('/').map((entry) => entry.trim()).filter(Boolean);
    const statusIndex = segments.findIndex((entry) => entry.toLowerCase() === 'status');
    if (statusIndex < 0) return null;
    const rawId = segments[statusIndex + 1] || '';
    const id = rawId.trim();
    return id || null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeUrl(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function formatDateLabel(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
