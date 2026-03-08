import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ArtemisFaqItem,
  ArtemisMissionEvidenceLink,
  ArtemisMissionHubKey,
  ArtemisMissionProfile,
  ArtemisMissionWatchLink
} from '@/lib/types/artemis';
import { ARTEMIS_MISSION_HUB_KEYS } from '@/lib/types/artemis';

type ArtemisMissionProfileRow = {
  entity_key: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
};

const DEFAULT_PROFILE_BY_MISSION: Record<ArtemisMissionHubKey, ArtemisMissionProfile> = {
  'artemis-i': {
    missionKey: 'artemis-i',
    missionName: 'Artemis I (Artemis 1)',
    shortLabel: 'Artemis I',
    status: 'completed',
    summary: 'Uncrewed lunar mission that validated the Orion spacecraft and Space Launch System stack.',
    detail: 'Mission recap, baseline timeline context, and historical launch evidence.',
    hubHref: '/artemis-i',
    keywords: ['Artemis I', 'Artemis 1'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis I mission page', url: 'https://www.nasa.gov/mission/artemis-i/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis I mission page',
        url: 'https://www.nasa.gov/mission/artemis-i/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2022-11-16T06:47:00Z'
  },
  'artemis-ii': {
    missionKey: 'artemis-ii',
    missionName: 'Artemis II (Artemis 2)',
    shortLabel: 'Artemis II',
    status: 'in-preparation',
    summary: 'First planned crewed Artemis mission flying a lunar flyby profile before future lunar landing missions.',
    detail: 'Canonical mission route for crewed timing, countdown updates, and schedule changes.',
    hubHref: '/artemis-ii',
    keywords: ['Artemis II', 'Artemis 2'],
    crewHighlights: [
      'Reid Wiseman (Commander)',
      'Victor Glover (Pilot)',
      'Christina Koch (Mission Specialist)',
      'Jeremy Hansen (Mission Specialist)'
    ],
    watchLinks: [{ label: 'NASA Artemis II mission page', url: 'https://www.nasa.gov/mission/artemis-ii/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis II mission page',
        url: 'https://www.nasa.gov/mission/artemis-ii/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2026-03-07T01:29:00Z'
  },
  'artemis-iii': {
    missionKey: 'artemis-iii',
    missionName: 'Artemis III (Artemis 3)',
    shortLabel: 'Artemis III',
    status: 'planned',
    summary: 'Planned mission targeting the first crewed lunar landing in the Artemis sequence.',
    detail: 'Forward-looking mission planning context and schedule signals.',
    hubHref: '/artemis-iii',
    keywords: ['Artemis III', 'Artemis 3'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis III mission page', url: 'https://www.nasa.gov/mission/artemis-iii/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis III mission page',
        url: 'https://www.nasa.gov/mission/artemis-iii/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2027-06-30T00:00:00Z'
  },
  'artemis-iv': {
    missionKey: 'artemis-iv',
    missionName: 'Artemis IV (Artemis 4)',
    shortLabel: 'Artemis IV',
    status: 'planned',
    summary: 'Planned Artemis mission extending sustained lunar campaign operations.',
    detail: 'Program-level planning mission with timeline and launch signal tracking.',
    hubHref: '/artemis-iv',
    keywords: ['Artemis IV', 'Artemis 4'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis campaign', url: 'https://www.nasa.gov/humans-in-space/artemis/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis campaign',
        url: 'https://www.nasa.gov/humans-in-space/artemis/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2028-09-01T00:00:00Z'
  },
  'artemis-v': {
    missionKey: 'artemis-v',
    missionName: 'Artemis V (Artemis 5)',
    shortLabel: 'Artemis V',
    status: 'planned',
    summary: 'Planned Artemis mission continuing lunar surface and infrastructure objectives.',
    detail: 'Program-level planning mission with timeline and launch signal tracking.',
    hubHref: '/artemis-v',
    keywords: ['Artemis V', 'Artemis 5'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis campaign', url: 'https://www.nasa.gov/humans-in-space/artemis/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis campaign',
        url: 'https://www.nasa.gov/humans-in-space/artemis/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2029-09-01T00:00:00Z'
  },
  'artemis-vi': {
    missionKey: 'artemis-vi',
    missionName: 'Artemis VI (Artemis 6)',
    shortLabel: 'Artemis VI',
    status: 'planned',
    summary: 'Planned Artemis mission in the long-range lunar campaign sequence.',
    detail: 'Program-level planning mission with timeline and launch signal tracking.',
    hubHref: '/artemis-vi',
    keywords: ['Artemis VI', 'Artemis 6'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis campaign', url: 'https://www.nasa.gov/humans-in-space/artemis/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis campaign',
        url: 'https://www.nasa.gov/humans-in-space/artemis/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2030-09-01T00:00:00Z'
  },
  'artemis-vii': {
    missionKey: 'artemis-vii',
    missionName: 'Artemis VII (Artemis 7)',
    shortLabel: 'Artemis VII',
    status: 'planned',
    summary: 'Planned Artemis mission extending long-range lunar campaign sequencing.',
    detail: 'Program-level planning mission with timeline and launch signal tracking.',
    hubHref: '/artemis-vii',
    keywords: ['Artemis VII', 'Artemis 7'],
    crewHighlights: [],
    watchLinks: [{ label: 'NASA Artemis campaign', url: 'https://www.nasa.gov/humans-in-space/artemis/' }],
    evidenceLinks: [
      {
        label: 'NASA Artemis campaign',
        url: 'https://www.nasa.gov/humans-in-space/artemis/',
        source: 'NASA',
        kind: 'reference'
      }
    ],
    targetDate: '2031-09-01T00:00:00Z'
  }
};

export function getArtemisMissionProfileDefault(missionKey: ArtemisMissionHubKey): ArtemisMissionProfile {
  return DEFAULT_PROFILE_BY_MISSION[missionKey];
}

export function listArtemisMissionProfileDefaults() {
  return ARTEMIS_MISSION_HUB_KEYS.map((missionKey) => getArtemisMissionProfileDefault(missionKey));
}

export async function fetchArtemisMissionProfile(missionKey: ArtemisMissionHubKey): Promise<ArtemisMissionProfile> {
  const fallback = getArtemisMissionProfileDefault(missionKey);
  if (!isSupabaseConfigured()) return fallback;

  const supabase = createSupabasePublicClient();
  const entityKeys = [missionKey, `mission_profile:${missionKey}`];
  const { data, error } = await supabase
    .from('artemis_entities')
    .select('entity_key,name,description,metadata')
    .eq('entity_type', 'mission_profile')
    .in('entity_key', entityKeys)
    .limit(2);

  if (error) {
    console.error('artemis mission profile override query error', error);
    return fallback;
  }

  const rows = (data || []) as ArtemisMissionProfileRow[];
  if (!rows.length) return fallback;

  const preferred = rows.find((row) => row.entity_key === `mission_profile:${missionKey}`) || rows[0];
  return mergeMissionProfile(fallback, preferred);
}

function mergeMissionProfile(base: ArtemisMissionProfile, row: ArtemisMissionProfileRow): ArtemisMissionProfile {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const missionName = readString(metadata.missionName) || readString(row.name) || base.missionName;
  const shortLabel = readString(metadata.shortLabel) || base.shortLabel;
  const status = readMissionStatus(metadata.status) || base.status;
  const summary = readString(metadata.summary) || readString(row.description) || base.summary;
  const detail = readString(metadata.detail) || base.detail;
  const hubHref = readString(metadata.hubHref) || base.hubHref;
  const keywords = readStringArray(metadata.keywords, 12) || base.keywords;
  const crewHighlights = readStringArray(metadata.crewHighlights, 12) || base.crewHighlights;
  const watchLinks = readWatchLinks(metadata.watchLinks) || base.watchLinks;
  const evidenceLinks = readEvidenceLinks(metadata.evidenceLinks) || base.evidenceLinks;
  const targetDate = readString(metadata.targetDate) || base.targetDate;
  const faq = readFaq(metadata.faq) || base.faq;

  return {
    ...base,
    missionName,
    shortLabel,
    status,
    summary,
    detail,
    hubHref,
    keywords,
    crewHighlights,
    watchLinks,
    evidenceLinks,
    targetDate,
    faq
  };
}

function readMissionStatus(value: unknown): ArtemisMissionProfile['status'] | null {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'in-preparation' || normalized === 'in_preparation') return 'in-preparation';
  if (normalized === 'planned') return 'planned';
  return null;
}

function readFaq(value: unknown): ArtemisFaqItem[] | null {
  if (!Array.isArray(value)) return null;
  const faq = value
    .map((entry) => {
      const row = isRecord(entry) ? entry : null;
      const question = row ? readString(row.question) : null;
      const answer = row ? readString(row.answer) : null;
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter((entry): entry is ArtemisFaqItem => Boolean(entry))
    .slice(0, 12);
  return faq.length > 0 ? faq : null;
}

function readWatchLinks(value: unknown): ArtemisMissionWatchLink[] | null {
  if (!Array.isArray(value)) return null;
  const links = value
    .map((entry) => {
      const row = isRecord(entry) ? entry : null;
      const url = row ? readString(row.url) : null;
      const label = row ? readString(row.label) : null;
      if (!url || !label) return null;
      return { url, label };
    })
    .filter((entry): entry is ArtemisMissionWatchLink => Boolean(entry))
    .slice(0, 12);
  return links.length > 0 ? links : null;
}

function readEvidenceLinks(value: unknown): ArtemisMissionEvidenceLink[] | null {
  if (!Array.isArray(value)) return null;
  const links = value
    .map((entry) => {
      const row = isRecord(entry) ? entry : null;
      const url = row ? readString(row.url) : null;
      const label = row ? readString(row.label) : null;
      if (!url || !label) return null;
      const evidence: ArtemisMissionEvidenceLink = {
        url,
        label,
        source: readString(row?.source),
        detail: readString(row?.detail),
        capturedAt: readString(row?.capturedAt),
        kind: readEvidenceKind(row?.kind)
      };
      return evidence;
    })
    .filter((entry): entry is ArtemisMissionEvidenceLink => entry !== null)
    .slice(0, 16);
  return links.length > 0 ? links : null;
}

function readEvidenceKind(value: unknown): ArtemisMissionEvidenceLink['kind'] | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === 'stream') return 'stream';
  if (normalized === 'report') return 'report';
  if (normalized === 'reference') return 'reference';
  if (normalized === 'status') return 'status';
  if (normalized === 'social') return 'social';
  return undefined;
}

function readStringArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return out.length > 0 ? out : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
