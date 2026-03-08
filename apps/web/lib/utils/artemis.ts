import type { Launch } from '@/lib/types/launch';

type ArtemisLaunchLike = Pick<Launch, 'name' | 'mission'> & { programs?: Launch['programs']; provider?: string | null };

export type ArtemisProgramMissionKey =
  | 'artemis-i'
  | 'artemis-ii'
  | 'artemis-iii'
  | 'artemis-iv'
  | 'artemis-v'
  | 'artemis-vi'
  | 'artemis-vii';

const ARTEMIS_PROGRAM_PATTERN = /\bartem[iu]s\b/i;
const ARTEMIS_MISSION_PATTERN = /\bartem[iu]s(?:\s*[-:]?\s*)(i{1,3}|iv|v|vi|vii|[1-7])\b/i;
const NASA_PROVIDER_PATTERN = /\b(nasa|national aeronautics and space administration)\b/i;
const ARTEMIS_PROGRAM_CONTEXT_PATTERN =
  /\b(sls|orion|gateway|exploration ground systems|human landing system|lunar)\b/i;

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectLaunchTextCandidates(launch: ArtemisLaunchLike) {
  const candidates = [launch.name, launch.mission?.name];
  for (const program of launch.programs || []) {
    if (program?.name) candidates.push(program.name);
    if (program?.description) candidates.push(program.description);
  }
  return candidates.map(normalizeText).filter(Boolean);
}

function normalizeArtemisOrdinal(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === '1' || normalized === 'i') return 'artemis-i';
  if (normalized === '2' || normalized === 'ii') return 'artemis-ii';
  if (normalized === '3' || normalized === 'iii') return 'artemis-iii';
  if (normalized === '4' || normalized === 'iv') return 'artemis-iv';
  if (normalized === '5' || normalized === 'v') return 'artemis-v';
  if (normalized === '6' || normalized === 'vi') return 'artemis-vi';
  if (normalized === '7' || normalized === 'vii') return 'artemis-vii';
  return null;
}

function missionKeyFromText(value: string | null | undefined): ArtemisProgramMissionKey | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const match = normalized.match(ARTEMIS_MISSION_PATTERN);
  if (!match?.[1]) return null;
  return normalizeArtemisOrdinal(match[1]);
}

export function isArtemisProgramText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (missionKeyFromText(normalized)) return true;
  return ARTEMIS_PROGRAM_PATTERN.test(normalized) && ARTEMIS_PROGRAM_CONTEXT_PATTERN.test(normalized);
}

export function isArtemisProgramLaunch(launch: ArtemisLaunchLike) {
  const missionKey = getArtemisMissionKeyFromLaunch(launch);
  if (missionKey) return true;

  const provider = normalizeText(launch.provider);
  if (!NASA_PROVIDER_PATTERN.test(provider)) return false;
  return collectLaunchTextCandidates(launch).some((candidate) => ARTEMIS_PROGRAM_PATTERN.test(candidate));
}

export function isArtemisIILaunch(launch: ArtemisLaunchLike) {
  return getArtemisMissionKeyFromLaunch(launch) === 'artemis-ii';
}

export function getArtemisMissionKeyFromLaunch(launch: ArtemisLaunchLike): ArtemisProgramMissionKey | null {
  for (const candidate of collectLaunchTextCandidates(launch)) {
    const key = missionKeyFromText(candidate);
    if (key) return key;
  }
  return null;
}

export function getArtemisVariantLabel(launch: ArtemisLaunchLike): 'artemis-ii' | 'artemis' | null {
  if (isArtemisIILaunch(launch)) return 'artemis-ii';
  if (isArtemisProgramLaunch(launch)) return 'artemis';
  return null;
}
