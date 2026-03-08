import type { Launch } from '@/lib/types/launch';

type StarshipLaunchLike = Pick<Launch, 'name' | 'mission' | 'programs' | 'vehicle' | 'rocket'>;

const STARSHIP_TEXT_PATTERN = /\bstarship\b|\bsuper\s*heavy\b/i;
const FLIGHT_NUMBER_PATTERNS = [
  /\bstarship\s*(?:integrated\s*)?flight\s*(?:test\s*)?(\d{1,3})\b/i,
  /\bift\s*[-#: ]?\s*(\d{1,3})\b/i,
  /\bflight\s*[-#: ]?\s*(\d{1,3})\b/i
] as const;

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectLaunchTextCandidates(launch: StarshipLaunchLike) {
  const candidates: Array<string | null | undefined> = [launch.name, launch.mission?.name, launch.vehicle, launch.rocket?.fullName];
  for (const program of launch.programs || []) {
    if (program?.name) candidates.push(program.name);
    if (program?.description) candidates.push(program.description);
  }
  return candidates.map(normalizeText).filter(Boolean);
}

export function isStarshipProgramText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return STARSHIP_TEXT_PATTERN.test(normalized);
}

export function isStarshipProgramLaunch(launch: StarshipLaunchLike) {
  const candidates = collectLaunchTextCandidates(launch);
  return candidates.some((candidate) => isStarshipProgramText(candidate) || /\bift\s*[-#: ]?\s*\d{1,3}\b/i.test(candidate));
}

export function extractStarshipFlightNumberFromText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  for (const pattern of FLIGHT_NUMBER_PATTERNS) {
    const match = normalized.match(pattern);
    const raw = match?.[1];
    if (!raw) continue;
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    const int = Math.trunc(number);
    if (int <= 0 || int > 999) continue;

    // Generic "Flight <n>" should only count when Starship context is present.
    if (pattern === FLIGHT_NUMBER_PATTERNS[2] && !STARSHIP_TEXT_PATTERN.test(normalized)) {
      continue;
    }

    return int;
  }

  return null;
}

export function extractStarshipFlightNumber(launch: StarshipLaunchLike) {
  for (const candidate of collectLaunchTextCandidates(launch)) {
    const number = extractStarshipFlightNumberFromText(candidate);
    if (number != null) return number;
  }
  return null;
}

export function buildStarshipFlightSlug(flightNumber: number): `flight-${number}` {
  return `flight-${Math.max(1, Math.trunc(flightNumber))}` as `flight-${number}`;
}

export function parseStarshipFlightSlug(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^flight-(\d{1,3})$/);
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const int = Math.trunc(number);
  if (int <= 0 || int > 999) return null;
  return int;
}

export function getStarshipVariantLabel(launch: StarshipLaunchLike): `flight-${number}` | 'starship' | null {
  const flightNumber = extractStarshipFlightNumber(launch);
  if (flightNumber != null) return buildStarshipFlightSlug(flightNumber);
  if (isStarshipProgramLaunch(launch)) return 'starship';
  return null;
}
