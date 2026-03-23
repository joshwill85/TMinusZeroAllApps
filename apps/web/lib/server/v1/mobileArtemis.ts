import {
  artemisAwardeeDetailSchemaV1,
  artemisAwardeesResponseSchemaV1,
  artemisContentResponseSchemaV1,
  artemisContractDetailSchemaV1,
  artemisContractsResponseSchemaV1,
  artemisMissionOverviewSchemaV1,
  artemisOverviewSchemaV1,
  type ArtemisMissionKeyV1
} from '@tminuszero/contracts';
import { fetchArtemisProgramSnapshot } from '@/lib/server/artemis';
import {
  fetchArtemisContentViewModel,
  parseArtemisContentCursor,
  parseArtemisContentKindFilter,
  parseArtemisContentLimit,
  parseArtemisContentMissionFilter,
  parseArtemisContentTierFilter
} from '@/lib/server/artemisContent';
import { fetchArtemisMissionHubData } from '@/lib/server/artemisMissionHub';
import { fetchArtemisMissionProfile, getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import { fetchArtemisProgramIntel } from '@/lib/server/artemisProgramIntel';
import { fetchArtemisAwardeeBySlug, fetchArtemisAwardeeIndex, fetchRelatedArtemisAwardees } from '@/lib/server/artemisAwardees';
import { fetchArtemisContractStoryByPiid, fetchArtemisContracts } from '@/lib/server/artemisContracts';
import { fetchArtemisTimelineViewModel } from '@/lib/server/artemisUi';
import { ARTEMIS_MISSION_HUB_KEYS, type ArtemisMissionHubKey } from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';
import { getArtemisMissionKeyFromLaunch } from '@/lib/utils/artemis';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const ARTEMIS_ALIAS_MAP: Record<string, ArtemisMissionKeyV1> = {
  'artemis-1': 'artemis-i',
  'artemis-i': 'artemis-i',
  'artemis-2': 'artemis-ii',
  'artemis-ii': 'artemis-ii',
  'artemis-3': 'artemis-iii',
  'artemis-iii': 'artemis-iii',
  'artemis-4': 'artemis-iv',
  'artemis-iv': 'artemis-iv',
  'artemis-5': 'artemis-v',
  'artemis-v': 'artemis-v',
  'artemis-6': 'artemis-vi',
  'artemis-vi': 'artemis-vi',
  'artemis-7': 'artemis-vii',
  'artemis-vii': 'artemis-vii'
};

export function normalizeArtemisMobileMissionParam(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return ARTEMIS_ALIAS_MAP[normalized] || null;
}

function mapLaunchSummary(launch: Launch) {
  return {
    id: launch.id,
    name: launch.name,
    provider: launch.provider,
    vehicle: launch.vehicle,
    net: launch.net,
    netPrecision: launch.netPrecision,
    status: launch.status,
    statusText: launch.statusText,
    imageUrl: launch.image?.thumbnail || null,
    padName: launch.pad?.name || null,
    padShortCode: launch.pad?.shortCode || null,
    padLocation: launch.pad?.locationName || null,
    missionName: launch.mission?.name || null,
    missionKey: getArtemisMissionKeyFromLaunch(launch),
    href: buildLaunchHref(launch)
  };
}

function dedupeContractsByPiid(contracts: Awaited<ReturnType<typeof fetchArtemisContracts>>) {
  const rowsByPiid = new Map<string, (typeof contracts)[number]>();
  for (const row of contracts) {
    const current = rowsByPiid.get(row.piid);
    if (!current || (row.updatedAt || '') > (current.updatedAt || '')) {
      rowsByPiid.set(row.piid, row);
    }
  }
  return [...rowsByPiid.values()].sort((a, b) => {
    const left = Date.parse(a.baseAwardDate || '');
    const right = Date.parse(b.baseAwardDate || '');
    return right - left || (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

function resolveArtemisMissionLabel(missionKey: string | null) {
  if (!missionKey || missionKey === 'program') return 'Artemis Program';
  if ((ARTEMIS_MISSION_HUB_KEYS as readonly string[]).includes(missionKey)) {
    return getArtemisMissionProfileDefault(missionKey as ArtemisMissionHubKey).shortLabel;
  }
  return missionKey;
}

export async function loadArtemisOverviewPayload() {
  const [snapshot, profiles, timeline, content, intel] = await Promise.all([
    fetchArtemisProgramSnapshot(),
    Promise.all(ARTEMIS_MISSION_HUB_KEYS.map((mission) => fetchArtemisMissionProfile(mission))),
    fetchArtemisTimelineViewModel({
      mode: 'quick',
      mission: 'all',
      sourceType: 'all',
      sourceClass: 'all',
      includeSuperseded: false,
      from: null,
      to: null,
      cursor: null,
      limit: 12
    }),
    fetchArtemisContentViewModel({
      mission: 'all',
      kind: 'all',
      tier: 'all',
      limit: 12,
      cursor: null
    }),
    fetchArtemisProgramIntel()
  ]);

  return artemisOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: 'Artemis',
    description: 'Native Artemis program hub with mission routing, timeline previews, and source-linked content snapshots.',
    snapshot: {
      generatedAt: snapshot.generatedAt,
      lastUpdated: snapshot.lastUpdated,
      nextLaunch: snapshot.nextLaunch ? mapLaunchSummary(snapshot.nextLaunch) : null,
      upcoming: snapshot.upcoming.map(mapLaunchSummary),
      recent: snapshot.recent.map(mapLaunchSummary),
      faq: snapshot.faq
    },
    stats: {
      missions: profiles.length,
      upcomingLaunches: snapshot.upcoming.length,
      recentLaunches: snapshot.recent.length,
      timelineEvents: timeline.events.length,
      contentItems: content.items.length,
      procurementAwards: intel.procurementAwards.length,
      budgetLines: intel.budgetLines.length
    },
    missions: profiles.map((profile) => ({
      missionKey: profile.missionKey,
      title: profile.shortLabel,
      description: profile.summary,
      href: profile.hubHref,
      statusLabel: profile.status,
      targetDate: profile.targetDate,
      highlight: profile.crewHighlights[0] || null
    })),
    timeline: timeline.events.map((event) => ({
      id: event.id,
      missionKey: event.mission,
      missionLabel: event.mission === 'artemis-program' ? 'Artemis Program' : event.mission.toUpperCase().replace('ARTEMIS-', 'Artemis '),
      title: event.title,
      summary: event.summary,
      date: event.date,
      status: event.status,
      sourceLabel: event.source.label,
      href: event.launch ? buildLaunchHref(event.launch) : event.source.href || null
    })),
    content: content.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: item.publishedAt,
      sourceLabel: item.sourceLabel,
      missionLabel: item.missionLabel
    }))
  });
}

export async function loadArtemisMissionOverviewPayload(missionKey: ArtemisMissionKeyV1) {
  const payload = await fetchArtemisMissionHubData(missionKey as ArtemisMissionHubKey);
  return artemisMissionOverviewSchemaV1.parse({
    generatedAt: payload.generatedAt,
    title: payload.missionName,
    description: `${payload.missionName} mission route with launch, crew, watch, evidence, news, and social coverage.`,
    snapshot: {
      generatedAt: payload.generatedAt,
      lastUpdated: payload.lastUpdated,
      missionKey: payload.missionKey,
      missionName: payload.missionName,
      nextLaunch: payload.nextLaunch ? mapLaunchSummary(payload.nextLaunch) : null,
      upcoming: payload.upcoming.map(mapLaunchSummary),
      recent: payload.recent.map(mapLaunchSummary),
      crewHighlights: payload.crewHighlights,
      changes: payload.changes,
      faq: payload.faq
    },
    watchLinks: payload.watchLinks,
    evidenceLinks: payload.evidenceLinks,
    news: payload.news.map((item) => ({
      id: item.snapiUid,
      title: item.title,
      url: item.url,
      newsSite: item.newsSite,
      summary: item.summary,
      publishedAt: item.publishedAt,
      relevance: item.relevance
    })),
    social: payload.social.map((item) => ({
      id: item.id,
      launchName: item.launchName || null,
      platform: item.platform,
      externalUrl: item.externalUrl || null,
      postedAt: item.postedAt || null,
      text: item.text || item.replyText || null,
      status: item.status
    })),
    coverage: payload.coverage
  });
}

export async function loadArtemisContractsPayload() {
  const rows = await fetchArtemisContracts({ limit: 500 });
  const families = dedupeContractsByPiid(rows);
  return artemisContractsResponseSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Artemis Contracts',
    description: 'Contract-family records and procurement story snapshots stitched from SAM-normalized Artemis data.',
    items: families,
    totalRows: rows.length,
    totalFamilies: families.length
  });
}

export async function loadArtemisContractDetailPayload(piid: string) {
  const story = await fetchArtemisContractStoryByPiid(piid, {
    contractLimit: 250,
    actionLimit: 1200,
    noticeLimit: 800,
    spendingLimit: 1200
  });
  if (!story || story.members.length === 0) return null;

  const primary = story.members[0];

  return artemisContractDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: primary.contractKey,
    description: primary.description || 'Artemis contract family with action, notice, and funding trend coverage.',
    story: {
      piid: story.piid,
      missionKey: primary.missionKey,
      missionLabel: resolveArtemisMissionLabel(primary.missionKey),
      members: story.members,
      actions: story.actions,
      notices: story.notices,
      spending: story.spending,
      bidders: story.bidders
    }
  });
}

export async function loadArtemisAwardeesPayload(query: string | null, limit: number | null) {
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  const items = await fetchArtemisAwardeeIndex({
    query: trimmedQuery || null,
    includeDraft: false,
    limit: typeof limit === 'number' ? limit : 250
  });

  return artemisAwardeesResponseSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Artemis Awardees',
    description: 'Recipient-level Artemis procurement pages focused on contracts, obligations, mission alignment, and source-backed award context.',
    query: trimmedQuery || null,
    items
  });
}

export async function loadArtemisAwardeeDetailPayload(slug: string) {
  const profile = await fetchArtemisAwardeeBySlug(slug, { includeDraft: false });
  if (!profile) return null;

  const related = await fetchRelatedArtemisAwardees(profile.recipientKey, {
    includeDraft: false,
    limit: 6
  });

  return artemisAwardeeDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: profile.recipientName,
    description: profile.summary,
    profile,
    related
  });
}

export async function loadArtemisContentPayload(searchParams: URLSearchParams) {
  const mission = parseArtemisContentMissionFilter(searchParams.get('mission')) ?? 'all';
  const kind = parseArtemisContentKindFilter(searchParams.get('kind')) ?? 'all';
  const tier = parseArtemisContentTierFilter(searchParams.get('tier')) ?? 'all';
  const cursor = parseArtemisContentCursor(searchParams.get('cursor'));
  const limit = parseArtemisContentLimit(searchParams.get('limit')) ?? 24;
  const payload = await fetchArtemisContentViewModel({
    mission,
    kind,
    tier,
    limit,
    cursor
  });

  return artemisContentResponseSchemaV1.parse(payload);
}
