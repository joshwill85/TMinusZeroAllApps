import type { Launch } from '@/lib/types/launch';
import type { SpaceXMissionKey } from '@/lib/types/spacexProgram';
import { isStarshipProgramLaunch } from '@/lib/utils/starship';

type SpaceXLaunchLike = Pick<Launch, 'name' | 'mission' | 'programs' | 'provider' | 'vehicle' | 'rocket'>;

const SPACEX_PROVIDER_PATTERN = /\bspace\s*x\b|\bspacex\b/i;
const FALCON_HEAVY_PATTERN = /\bfalcon\s*heavy\b/i;
const FALCON9_PATTERN = /\bfalcon\s*9\b|\bf9\b/i;
const DRAGON_PATTERN = /\bdragon\b|\bcrew-\d+\b|\bcargo\s*dragon\b/i;

const MISSION_KEYS: readonly SpaceXMissionKey[] = ['spacex-program', 'starship', 'falcon-9', 'falcon-heavy', 'dragon'];

export function isSpaceXProgramLaunch(launch: SpaceXLaunchLike): boolean {
  const candidates = collectTextCandidates(launch);
  if (candidates.some((text) => SPACEX_PROVIDER_PATTERN.test(text))) return true;
  if (isStarshipProgramLaunch(launch as Launch)) return true;
  return candidates.some((text) => FALCON_HEAVY_PATTERN.test(text) || FALCON9_PATTERN.test(text) || DRAGON_PATTERN.test(text));
}

export function getSpaceXMissionKeyFromLaunch(launch: SpaceXLaunchLike): SpaceXMissionKey {
  const candidates = collectTextCandidates(launch);
  if (candidates.some((text) => isStarshipProgramLaunch({ ...launch, name: text } as Launch))) return 'starship';
  if (candidates.some((text) => FALCON_HEAVY_PATTERN.test(text))) return 'falcon-heavy';
  if (candidates.some((text) => DRAGON_PATTERN.test(text))) return 'dragon';
  if (candidates.some((text) => FALCON9_PATTERN.test(text))) return 'falcon-9';
  return 'spacex-program';
}

export function getSpaceXMissionKeyFromText(value: string | null | undefined): SpaceXMissionKey | null {
  const text = normalize(value);
  if (!text) return null;
  if (isStarshipProgramLaunch({ name: text, mission: {}, programs: [], provider: '', vehicle: '', rocket: {} } as SpaceXLaunchLike)) return 'starship';
  if (FALCON_HEAVY_PATTERN.test(text)) return 'falcon-heavy';
  if (DRAGON_PATTERN.test(text)) return 'dragon';
  if (FALCON9_PATTERN.test(text)) return 'falcon-9';
  if (SPACEX_PROVIDER_PATTERN.test(text)) return 'spacex-program';
  return null;
}

export function parseSpaceXMissionFilter(value: string | null): SpaceXMissionKey | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'program' || normalized === 'spacex' || normalized === 'space-x' || normalized === 'spacex-program') return 'spacex-program';
  if (normalized === 'starship') return 'starship';
  if (normalized === 'falcon-9' || normalized === 'falcon9' || normalized === 'f9') return 'falcon-9';
  if (normalized === 'falcon-heavy' || normalized === 'falconheavy' || normalized === 'fh') return 'falcon-heavy';
  if (normalized === 'dragon' || normalized === 'crew-dragon' || normalized === 'cargodragon' || normalized === 'cargo-dragon') return 'dragon';
  return null;
}

export function buildSpaceXFlightSlug(launch: Pick<Launch, 'id' | 'name'>) {
  const base = (launch.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return `${base || 'launch'}-${launch.id.slice(0, 8)}`;
}

export function parseSpaceXFlightSlug(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!normalized.length) return null;
  if (!normalized.includes('-')) return null;
  return normalized;
}

export function getSpaceXMissionLabel(mission: SpaceXMissionKey): string {
  if (mission === 'spacex-program') return 'SpaceX Program';
  if (mission === 'starship') return 'Starship';
  if (mission === 'falcon-9') return 'Falcon 9';
  if (mission === 'falcon-heavy') return 'Falcon Heavy';
  return 'Dragon';
}

export function isSpaceXMissionKey(value: string): value is SpaceXMissionKey {
  return MISSION_KEYS.includes(value as SpaceXMissionKey);
}

function collectTextCandidates(launch: SpaceXLaunchLike) {
  const candidates: Array<string | null | undefined> = [
    launch.provider,
    launch.name,
    launch.mission?.name,
    launch.mission?.description,
    launch.vehicle,
    launch.rocket?.fullName
  ];

  for (const program of launch.programs || []) {
    candidates.push(program?.name);
    candidates.push(program?.description);
  }

  return candidates.map(normalize).filter(Boolean);
}

function normalize(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

