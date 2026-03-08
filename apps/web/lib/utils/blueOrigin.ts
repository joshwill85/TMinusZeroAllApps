import type { Launch } from '@/lib/types/launch';
import { slugify } from '@/lib/utils/slug';

export type BlueOriginMissionKey =
  | 'blue-origin-program'
  | 'new-shepard'
  | 'new-glenn'
  | 'blue-moon'
  | 'blue-ring'
  | 'be-4';

type BlueOriginLaunchLike = Pick<Launch, 'name' | 'mission' | 'programs' | 'provider' | 'vehicle' | 'rocket'>;

const BLUE_ORIGIN_PROVIDER_PATTERN = /\bblue\s*origin\b/i;
const BLUE_ORIGIN_PROGRAM_PATTERN = /\b(blue\s*origin|new\s*shepard|new\s*glenn|blue\s*moon|blue\s*ring|be-?4|be4)\b/i;
const BLUE_ORIGIN_LAUNCH_PATTERN = /\b(blue\s*origin|new\s*shepard|new\s*glenn|blue\s*moon|blue\s*ring)\b/i;
const BLUE_ORIGIN_BE4_CONTEXT_PATTERN = /\b(blue\s*origin\b.*\bbe\s*-?\s*4\b|\bbe\s*-?\s*4\b.*\bblue\s*origin)\b/i;

const NEW_SHEPARD_PATTERN = /\b(new\s*shepard|ns\s*[-#:]?\s*\d{1,3})\b/i;
const NEW_GLENN_PATTERN = /\b(new\s*glenn|ng\s*[-#:]?\s*\d{1,3})\b/i;
const BLUE_MOON_PATTERN = /\bblue\s*moon\b/i;
const BLUE_RING_PATTERN = /\bblue\s*ring\b/i;
const BE4_PATTERN = /\bbe\s*-?\s*4\b/i;

const NS_FLIGHT_PATTERN = /\bns\s*[-#:]?\s*(\d{1,3})\b/i;
const NG_FLIGHT_PATTERN = /\bng\s*[-#:]?\s*(\d{1,3})\b/i;
const BLUE_ORIGIN_FLIGHT_PATH_PATTERN = /\b(ns|ng)-\d{1,3}\b/i;
const BLUE_ORIGIN_FLIGHT_MISSION_UPDATES_PATH_PATTERN = /^\/news\/(?:ns|ng)-\d{1,3}-mission-updates$/i;
const BLUE_ORIGIN_LEGACY_MISSION_NEWS_PATH_PATTERN =
  /^\/news\/(?:new-(?:shepard|glenn)-(?:ns|ng)-\d{1,3}-mission|(?:ns|ng)-\d{1,3}-mission|new-(?:shepard|glenn)-mission-(?:ns|ng)-\d{1,3})$/i;
const BLUE_ORIGIN_OPEN_SOURCE_PROFILE_HOST_SUFFIXES = [
  'thespacedevs.com',
  'wikipedia.org',
  'wikidata.org'
] as const;
const BLUE_ORIGIN_TRAVELER_HONORIFIC_PREFIX_PATTERN =
  /^(dr|mr|mrs|ms|prof|capt|col|gen|lt|cmdr|h\.?e)\.?\s+/i;
const BLUE_ORIGIN_TRAVELER_ALIAS_BY_FLIGHT = new Map<string, Map<string, string>>([
  [
    'ns-36',
    new Map<string, string>([
      ['william h lewis', 'Will Lewis'],
      ['vitalii ostrovsky', 'Vitalii Ostrovskyi']
    ])
  ],
  [
    'ns-33',
    new Map<string, string>([
      ['james sitkin', 'Jim Sitkin'],
      ['leland larson', 'Leland (Lee) Larson']
    ])
  ]
]);
const BLUE_ORIGIN_TRAVELER_GLOBAL_ALIASES = new Map<string, string>([
  ['clint kelly', 'Clint Kelly III'],
  ['clint kelly iii', 'Clint Kelly III'],
  ['freddie rescigno', 'Freddie Rescigno, Jr.'],
  ['justin sun', 'Justin Sun'],
  ['james russell', 'J.D. Russell'],
  ['russel wilson', 'Russell Wilson'],
  ['elaine hyde', 'Elaine Chia Hyde'],
  ['lee larson', 'Leland (Lee) Larson'],
  ['michaela benthaus', 'Michaela Benthaus'],
  ['michaela michi benthaus', 'Michaela Benthaus'],
  ['amy medina jorge', 'Aymette Medina Jorge'],
  ['arvi bahal', 'Arvinder Singh Bahal'],
  ['mario ferreira', 'Mário Ferreira'],
  ['vanessa obrien', "Vanessa O'Brien"],
  ['victor hespanha', 'Victor Correa Hespanha'],
  ['henry wolfond', 'Hank Wolfond']
]);

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectLaunchTextCandidates(launch: BlueOriginLaunchLike) {
  const candidates: Array<string | null | undefined> = [
    launch.name,
    launch.mission?.name,
    launch.vehicle,
    launch.rocket?.fullName,
    launch.provider
  ];

  for (const program of launch.programs || []) {
    if (program?.name) candidates.push(program.name);
    if (program?.description) candidates.push(program.description);
  }

  return candidates.map(normalizeText).filter(Boolean);
}

export function isBlueOriginProgramText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return BLUE_ORIGIN_PROGRAM_PATTERN.test(normalized);
}

export function isBlueOriginProgramLaunch(launch: BlueOriginLaunchLike) {
  const provider = normalizeText(launch.provider);
  if (BLUE_ORIGIN_PROVIDER_PATTERN.test(provider)) return true;
  return collectLaunchTextCandidates(launch).some((candidate) => BLUE_ORIGIN_LAUNCH_PATTERN.test(candidate));
}

export function getBlueOriginMissionKeyFromText(value: string | null | undefined): BlueOriginMissionKey | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  if (NEW_SHEPARD_PATTERN.test(normalized)) return 'new-shepard';
  if (NEW_GLENN_PATTERN.test(normalized)) return 'new-glenn';
  if (BLUE_MOON_PATTERN.test(normalized)) return 'blue-moon';
  if (BLUE_RING_PATTERN.test(normalized)) return 'blue-ring';
  if (BE4_PATTERN.test(normalized) && BLUE_ORIGIN_BE4_CONTEXT_PATTERN.test(normalized)) return 'be-4';
  if (BLUE_ORIGIN_PROGRAM_PATTERN.test(normalized)) return 'blue-origin-program';

  return null;
}

export function getBlueOriginMissionKeyFromLaunch(launch: BlueOriginLaunchLike): BlueOriginMissionKey | null {
  for (const candidate of collectLaunchTextCandidates(launch)) {
    const key = getBlueOriginMissionKeyFromText(candidate);
    if (key) return key;
  }

  if (isBlueOriginProgramLaunch(launch)) {
    return 'blue-origin-program';
  }

  return null;
}

export function extractBlueOriginFlightCodeFromText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const nsMatch = normalized.match(NS_FLIGHT_PATTERN);
  if (nsMatch?.[1]) {
    const number = Number(nsMatch[1]);
    if (Number.isFinite(number) && number > 0 && number <= 999) {
      return `ns-${Math.trunc(number)}`;
    }
  }

  const ngMatch = normalized.match(NG_FLIGHT_PATTERN);
  if (ngMatch?.[1]) {
    const number = Number(ngMatch[1]);
    if (Number.isFinite(number) && number > 0 && number <= 999) {
      return `ng-${Math.trunc(number)}`;
    }
  }

  return null;
}

export function extractBlueOriginFlightCode(launch: BlueOriginLaunchLike) {
  for (const candidate of collectLaunchTextCandidates(launch)) {
    const code = extractBlueOriginFlightCodeFromText(candidate);
    if (code) return code;
  }
  return null;
}

export function extractBlueOriginFlightCodeFromUrl(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const rawUrl = normalized.includes('://') || normalized.startsWith('/')
    ? normalized
    : `https://www.blueorigin.com/${normalized.replace(/^\/+/, '')}`;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'blueorigin.com') return null;

  const path = decodeURIComponent(parsed.pathname || '').toLowerCase();
  const match = path.match(BLUE_ORIGIN_FLIGHT_PATH_PATTERN);
  if (!match?.[0]) return null;

  return extractBlueOriginFlightCodeFromText(match[0]);
}

export function normalizeBlueOriginTravelerProfileUrl(
  value: string | null | undefined,
  options?: {
    allowOpenSource?: boolean;
  }
) {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = normalizeUrlHost(parsed.hostname);
  if (!host) return null;
  if (!options?.allowOpenSource && isBlueOriginOpenSourceProfileHost(host)) return null;

  if (host === 'blueorigin.com') {
    const pathname = normalizeBlueOriginLocalePath(parsed.pathname);
    if (!pathname) return 'https://www.blueorigin.com';
    if (BLUE_ORIGIN_FLIGHT_MISSION_UPDATES_PATH_PATTERN.test(pathname)) {
      return `https://www.blueorigin.com${pathname}`;
    }

    if (BLUE_ORIGIN_LEGACY_MISSION_NEWS_PATH_PATTERN.test(pathname)) {
      const flightCode = extractBlueOriginFlightCodeFromUrl(`https://www.blueorigin.com${pathname}`);
      if (flightCode) return `https://www.blueorigin.com/news/${flightCode}-mission-updates`;
    }

    return `https://www.blueorigin.com${pathname}`;
  }

  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
  return parsed.toString();
}

export function isBlueOriginOpenSourceProfileUrl(value: string | null | undefined) {
  if (!value) return false;
  const normalized = normalizeText(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return isBlueOriginOpenSourceProfileHost(normalizeUrlHost(parsed.hostname));
  } catch {
    return false;
  }
}

export function normalizeBlueOriginTravelerRole(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const normalized = raw.toLowerCase();
  if (normalized.includes('tourist') || normalized.includes('private')) return 'Crew';
  if (normalized.includes('crew') || normalized.includes('astronaut')) return 'Crew';
  if (normalized.includes('passenger')) return 'Crew';
  return raw;
}

export function isBlueOriginNonHumanCrewEntry(name: string | null | undefined, role: string | null | undefined) {
  const normalizedName = normalizeText(name).toLowerCase();
  const normalizedRole = normalizeText(role).toLowerCase();
  if (!normalizedName && !normalizedRole) return false;
  if (/\b(?:anthropomorphic|test\s+device|dummy|atd)\b/i.test(normalizedRole)) return true;
  if (/\bmannequin\b/i.test(normalizedName)) return true;
  return false;
}

export function buildBlueOriginFlightSlug(flightCode: string) {
  return normalizeFlightCode(flightCode);
}

export function parseBlueOriginFlightSlug(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeFlightCode(value);
  if (/^(ns|ng)-\d{1,3}$/.test(normalized)) return normalized;
  return null;
}

function normalizeFlightCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/-+/g, '-');
}

export function getBlueOriginVariantLabel(launch: BlueOriginLaunchLike): string | null {
  const flight = extractBlueOriginFlightCode(launch);
  if (flight) return flight;
  const mission = getBlueOriginMissionKeyFromLaunch(launch);
  if (mission && mission !== 'blue-origin-program') return mission;
  if (isBlueOriginProgramLaunch(launch)) return 'blue-origin';
  return null;
}

export function normalizeBlueOriginTravelerName(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBlueOriginTravelerNameKey(value: string | null | undefined) {
  const normalized = normalizeBlueOriginTravelerName(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(BLUE_ORIGIN_TRAVELER_HONORIFIC_PREFIX_PATTERN, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

export function resolveBlueOriginTravelerCanonicalName(
  value: string | null | undefined,
  flightCode?: string | null
) {
  const normalized = normalizeBlueOriginTravelerName(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const key = normalizeBlueOriginTravelerNameKey(normalized);
  if (!key) return normalized;

  const normalizedFlightCode = parseBlueOriginFlightSlug(flightCode || '');
  if (normalizedFlightCode) {
    const aliases = BLUE_ORIGIN_TRAVELER_ALIAS_BY_FLIGHT.get(normalizedFlightCode);
    if (aliases?.has(key)) {
      return aliases.get(key) || normalized;
    }
  }

  return BLUE_ORIGIN_TRAVELER_GLOBAL_ALIASES.get(key) || normalized;
}

export function buildBlueOriginTravelerIdentityKey(
  value: string | null | undefined,
  flightCode?: string | null
) {
  const canonical = resolveBlueOriginTravelerCanonicalName(value, flightCode);
  return normalizeBlueOriginTravelerNameKey(canonical);
}

export function buildBlueOriginTravelerSlug(name: string) {
  const normalizedName = normalizeBlueOriginTravelerName(name);
  const slug = slugify(normalizedName, 96);
  return slug || 'traveler';
}

export function parseBlueOriginTravelerSlug(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}

export function isBlueOriginTravelerSlugMatch(name: string, slug: string) {
  const normalizedSlug = parseBlueOriginTravelerSlug(slug);
  if (!normalizedSlug) return false;
  return buildBlueOriginTravelerSlug(name) === normalizedSlug;
}

function normalizeBlueOriginLocalePath(pathname: string) {
  if (typeof pathname !== 'string') return '';
  const trimmed = pathname.trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/+$/g, '');
  if (!withoutTrailingSlash) return '';

  const localeAware = withoutTrailingSlash.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, '');
  return localeAware || '/';
}

function normalizeUrlHost(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function isBlueOriginOpenSourceProfileHost(host: string | null | undefined) {
  const normalizedHost = normalizeUrlHost(host);
  if (!normalizedHost) return false;
  return BLUE_ORIGIN_OPEN_SOURCE_PROFILE_HOST_SUFFIXES.some(
    (suffix) => normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)
  );
}
