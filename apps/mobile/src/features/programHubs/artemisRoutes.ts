import type { ArtemisMissionKeyV1 } from '@tminuszero/api-client';

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

export function normalizeArtemisMissionParam(value: string | string[] | undefined) {
  const raw = takeFirst(value);
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return ARTEMIS_ALIAS_MAP[normalized] || null;
}

export function normalizeArtemisContractPiidParam(value: string | string[] | undefined) {
  const raw = takeFirst(value).trim();
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return raw || null;
  }
}

export function normalizeArtemisAwardeeSlugParam(value: string | string[] | undefined) {
  const raw = takeFirst(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return raw || null;
}

export function buildArtemisMissionHref(mission: ArtemisMissionKeyV1) {
  return `/${mission}`;
}

export function buildArtemisContractsHref() {
  return '/artemis/contracts';
}

export function buildArtemisContractHref(piid: string) {
  const normalized = normalizeArtemisContractPiidParam(piid);
  return normalized ? `/artemis/contracts/${encodeURIComponent(normalized)}` : buildArtemisContractsHref();
}

export function buildArtemisAwardeesHref() {
  return '/artemis/awardees';
}

export function buildArtemisAwardeeHref(slug: string) {
  const normalized = normalizeArtemisAwardeeSlugParam(slug);
  return normalized ? `/artemis/awardees/${encodeURIComponent(normalized)}` : buildArtemisAwardeesHref();
}

export function buildArtemisContentHref() {
  return '/artemis/content';
}

export function artemisMissionLabel(mission: ArtemisMissionKeyV1) {
  return mission.toUpperCase().replace('ARTEMIS-', 'Artemis ');
}

export function artemisMissionOrProgramLabel(mission: ArtemisMissionKeyV1 | 'program' | null | undefined) {
  if (!mission || mission === 'program') return 'Artemis Program';
  return artemisMissionLabel(mission);
}

function takeFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}
