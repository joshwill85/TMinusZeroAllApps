import fs from 'node:fs';
import path from 'node:path';

export type CandidateKind = 'page' | 'pdf';

export type CandidateLink = {
  url: string;
  kind: CandidateKind;
  sourcePage: string;
};

export type FetchTextResult = {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  finalUrl: string | null;
  attemptCount: number;
  challenge: boolean;
  error: string | null;
  text: string;
};

export type PageSignals = {
  slug: string | null;
  hasTrajectorySignals: boolean;
  orbitSignalCount: number;
  milestoneSignalCount: number;
  recoverySignalCount: number;
  numericOrbitSignalCount: number;
  matchedKeywords: string[];
};

export type RocketLabLaunchLike = {
  launchId: string;
  name: string | null;
  missionName: string | null;
  net: string | null;
  provider: string | null;
  vehicle: string | null;
  statusName: string | null;
};

export type RocketLabJoinStatus = 'deterministic' | 'probable' | 'ambiguous' | 'none';

export type RocketLabJoinCandidate = {
  url: string;
  slug: string | null;
  score: number;
  matchedAlias: string | null;
  reasons: string[];
};

export type RocketLabJoinResult = {
  status: RocketLabJoinStatus;
  bestMatchUrl: string | null;
  bestMatchScore: number | null;
  matchedAlias: string | null;
  aliases: string[];
  candidates: RocketLabJoinCandidate[];
  reasons: string[];
};

export const ROCKET_LAB_SOURCE_URLS = {
  missions: 'https://rocketlabcorp.com/missions/',
  updates: 'https://rocketlabcorp.com/updates/'
} as const;

const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_FETCH_BACKOFF_MS = 900;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

const ORBIT_KEYWORDS = [
  'inclination',
  'orbit',
  'orbital',
  'low earth orbit',
  'sun-synchronous',
  'sso',
  'gto',
  'geo',
  'perigee',
  'apogee'
] as const;

const MILESTONE_KEYWORDS = [
  'liftoff',
  'lift-off',
  'stage separation',
  'payload deployment',
  'second stage',
  'kick stage',
  'engine cutoff',
  'main engine cutoff',
  'fairing'
] as const;

const RECOVERY_KEYWORDS = [
  'recovery',
  'splashdown',
  'splash down',
  'parachute',
  'helicopter capture',
  'ocean landing',
  'return to earth'
] as const;

const NON_CONTENT_SLUGS = new Set(['launches', 'missions', 'updates']);
const NON_PAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.xml', '.css', '.js', '.json', '.txt'];
const ROCKET_LAB_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'electron',
  'for',
  'lab',
  'launch',
  'launches',
  'mission',
  'missions',
  'neutron',
  'of',
  'rocket',
  'the',
  'to',
  'with'
]);

type FetchTextOptions = {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export function readJsonFile<T>(pathArg: string): T {
  const full = path.resolve(process.cwd(), pathArg);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

export function writeJson(pathArg: string, value: unknown) {
  const full = path.resolve(process.cwd(), pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(pathArg: string, value: string) {
  const full = path.resolve(process.cwd(), pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value, 'utf8');
}

export async function fetchTextWithMeta(url: string, options: FetchTextOptions = {}): Promise<FetchTextResult> {
  const retries = clampInt(options.retries ?? DEFAULT_FETCH_RETRIES, 1, 6);
  const backoffMs = clampInt(options.backoffMs ?? DEFAULT_FETCH_BACKOFF_MS, 200, 20_000);
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS, 1_000, 60_000);
  const extraHeaders = options.headers || {};

  let lastResult: FetchTextResult = {
    url,
    ok: false,
    status: 0,
    contentType: null,
    finalUrl: null,
    attemptCount: 0,
    challenge: false,
    error: 'unreachable',
    text: ''
  };

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
          ...extraHeaders
        }
      });
      clearTimeout(timeout);

      const text = await response.text().catch(() => '');
      const challenge = looksLikeBrowserChallenge(response.status, response.headers, text);
      const ok = response.ok && !challenge;

      lastResult = {
        url,
        ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        finalUrl: response.url || url,
        attemptCount: attempt,
        challenge,
        error: ok ? null : `http_${response.status}${challenge ? '_challenge' : ''}`,
        text
      };

      if (ok) return lastResult;

      const shouldRetry = attempt < retries && (isRetryableStatus(response.status) || challenge);
      if (!shouldRetry) return lastResult;
      await sleep(buildBackoffMs(backoffMs, attempt));
    } catch (error) {
      clearTimeout(timeout);
      lastResult = {
        url,
        ok: false,
        status: 0,
        contentType: null,
        finalUrl: null,
        attemptCount: attempt,
        challenge: false,
        error: stringifyError(error),
        text: ''
      };
      if (attempt >= retries) return lastResult;
      await sleep(buildBackoffMs(backoffMs, attempt));
    }
  }

  return lastResult;
}

export function extractRocketLabCandidateLinks(html: string, sourceUrl: string): CandidateLink[] {
  const base = safeUrl(sourceUrl);
  if (!base) return [];

  const found = new Map<string, CandidateLink>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const rawHref = match[1];
    if (!rawHref) continue;

    const absolute = toAbsoluteUrl(rawHref, base);
    if (!absolute) continue;

    const parsed = safeUrl(absolute);
    if (!parsed) continue;
    if (parsed.host !== base.host) continue;

    const pathname = normalizePathname(parsed.pathname);
    if (pathname === '/missions' || pathname === '/updates') continue;

    let kind: CandidateKind | null = null;
    let normalizedUrl: string | null = null;

    if (pathname.endsWith('.pdf')) {
      kind = 'pdf';
      normalizedUrl = `${parsed.origin}${pathname}${parsed.search}`;
    } else if (pathname.startsWith('/missions/') || pathname.startsWith('/updates/')) {
      if (!isLikelyHtmlPagePath(pathname)) continue;
      kind = 'page';
      normalizedUrl = `${parsed.origin}${pathname}`;
    }

    if (!kind || !normalizedUrl) continue;
    if (!found.has(normalizedUrl)) {
      found.set(normalizedUrl, {
        url: normalizedUrl,
        kind,
        sourcePage: sourceUrl
      });
    }
  }

  return [...found.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'page' ? -1 : 1;
    return a.url.localeCompare(b.url);
  });
}

export function evaluateRocketLabPageSignals(url: string, html: string): PageSignals {
  const text = stripHtml(html).toLowerCase();
  const orbitMatches = matchKeywords(text, ORBIT_KEYWORDS);
  const milestoneMatches = matchKeywords(text, MILESTONE_KEYWORDS);
  const recoveryMatches = matchKeywords(text, RECOVERY_KEYWORDS);
  const numericOrbitSignalCount =
    orbitMatches.length > 0 && /\b\d{1,4}(?:\.\d+)?\s*(?:°|deg|degrees|km)\b/i.test(text) ? 1 : 0;

  return {
    slug: extractSlugFromUrl(url),
    hasTrajectorySignals: orbitMatches.length > 0 || milestoneMatches.length > 0 || recoveryMatches.length > 0,
    orbitSignalCount: orbitMatches.length,
    milestoneSignalCount: milestoneMatches.length,
    recoverySignalCount: recoveryMatches.length,
    numericOrbitSignalCount,
    matchedKeywords: [...orbitMatches, ...milestoneMatches, ...recoveryMatches]
  };
}

export function buildRocketLabJoinAliases(launch: RocketLabLaunchLike) {
  const candidates = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = normalizeRocketLabJoinText(value);
    if (!normalized || normalized.length < 3) return;
    candidates.add(normalized);

    const stripped = stripRocketLabParenthetical(normalized);
    if (stripped && stripped.length >= 3) candidates.add(stripped);

    for (const part of splitRocketLabAliasParts(normalized)) {
      if (part.length >= 3) candidates.add(part);
      const partStripped = stripRocketLabParenthetical(part);
      if (partStripped && partStripped.length >= 3) candidates.add(partStripped);
    }
  };

  push(launch.missionName);
  push(launch.name);
  return [...candidates.values()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function extractRocketLabCandidateSlug(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const pathname = normalizePathname(parsed.pathname);
  const slug = pathname.split('/').filter(Boolean).at(-1) || null;
  if (!slug || !isLikelyHtmlPagePath(pathname)) return null;
  return slug.toLowerCase();
}

export function classifyRocketLabCandidateMatches(launch: RocketLabLaunchLike, candidateUrls: string[]): RocketLabJoinResult {
  const aliases = buildRocketLabJoinAliases(launch);
  const scored = candidateUrls
    .map((url) => scoreRocketLabCandidate(url, aliases))
    .filter((candidate) => candidate.score >= 60)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

  if (!scored.length) {
    return {
      status: 'none',
      bestMatchUrl: null,
      bestMatchScore: null,
      matchedAlias: null,
      aliases,
      candidates: [],
      reasons: ['No candidate slug cleared the Rocket Lab join threshold for this launch.']
    };
  }

  const best = scored[0];
  const competing = scored.filter((candidate) => candidate.score >= best.score - 5);

  if (best.score >= 100 && competing.length === 1) {
    return {
      status: 'deterministic',
      bestMatchUrl: best.url,
      bestMatchScore: best.score,
      matchedAlias: best.matchedAlias,
      aliases,
      candidates: scored.slice(0, 5),
      reasons: [`Exact slug-to-alias match on "${best.matchedAlias}".`, ...best.reasons]
    };
  }

  if (competing.length > 1) {
    return {
      status: 'ambiguous',
      bestMatchUrl: best.url,
      bestMatchScore: best.score,
      matchedAlias: best.matchedAlias,
      aliases,
      candidates: scored.slice(0, 5),
      reasons: [`Multiple candidate pages scored within five points of the best match for this launch.`]
    };
  }

  return {
    status: 'probable',
    bestMatchUrl: best.url,
    bestMatchScore: best.score,
    matchedAlias: best.matchedAlias,
    aliases,
    candidates: scored.slice(0, 5),
    reasons: [`A single candidate cleared the fuzzy Rocket Lab join threshold, but not as an exact slug match.`]
  };
}

export function sortRocketLabCandidates(candidates: CandidateLink[]) {
  return [...candidates].sort((a, b) => {
    const rankDiff = rocketLabCandidateRank(a) - rocketLabCandidateRank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.kind !== b.kind) return a.kind === 'page' ? -1 : 1;
    return a.url.localeCompare(b.url);
  });
}

export function stripHtml(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSlugFromUrl(url: string) {
  return extractRocketLabCandidateSlug(url);
}

function matchKeywords(text: string, keywords: readonly string[]) {
  return keywords.filter((keyword) => text.includes(keyword));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function buildBackoffMs(backoffMs: number, attempt: number) {
  const jitter = Math.round(Math.random() * 350);
  const factor = Math.max(0, attempt - 1);
  return backoffMs * 2 ** factor + jitter;
}

function isRetryableStatus(status: number) {
  return status === 403 || status === 408 || status === 409 || status === 423 || status === 425 || status === 429 || status >= 500;
}

function looksLikeBrowserChallenge(status: number, headers: Headers, text: string) {
  const mitigated = (headers.get('x-vercel-mitigated') || '').toLowerCase();
  const challengeHeader = (headers.get('x-vercel-challenge-token') || '').trim();
  if (mitigated === 'challenge' || challengeHeader) return true;

  if (status === 403 || status === 429) {
    const normalized = text.toLowerCase();
    if (normalized.includes('vercel security checkpoint')) return true;
    if (normalized.includes("we're verifying your browser")) return true;
    if (normalized.includes('browser verification')) return true;
    if (normalized.includes('enable javascript to continue')) return true;
    if (normalized.includes('captcha')) return true;
  }
  return false;
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toAbsoluteUrl(href: string, base: URL) {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return null;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

function normalizePathname(value: string) {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed || '/';
}

function isLikelyHtmlPagePath(pathname: string) {
  const lastSegment = pathname.split('/').filter(Boolean).at(-1) || '';
  const normalized = lastSegment.toLowerCase();
  if (!normalized || normalized === '&') return false;
  if (NON_CONTENT_SLUGS.has(normalized)) return false;
  if (NON_PAGE_EXTENSIONS.some((extension) => normalized.endsWith(extension))) return false;
  return true;
}

function rocketLabCandidateRank(candidate: CandidateLink) {
  if (candidate.kind === 'pdf') return 100;
  try {
    const pathname = new URL(candidate.url).pathname.toLowerCase();
    if (pathname.startsWith('/missions/launches/')) return 0;
    if (pathname.startsWith('/updates/mission-success')) return 1;
    if (pathname.startsWith('/updates/') && pathname.includes('launch')) return 2;
    if (pathname.startsWith('/updates/')) return 3;
    if (pathname.startsWith('/missions/')) return 4;
    return 5;
  } catch {
    return 6;
  }
}

function scoreRocketLabCandidate(url: string, aliases: string[]): RocketLabJoinCandidate {
  const slug = extractRocketLabCandidateSlug(url);
  if (!slug) {
    return {
      url,
      slug: null,
      score: 0,
      matchedAlias: null,
      reasons: ['Candidate URL does not expose a launch-like Rocket Lab page slug.']
    };
  }

  const slugText = normalizeRocketLabJoinText(slug.replace(/-/g, ' '));
  const slugKey = slugifyRocketLabJoinText(slugText);
  const slugTokens = tokenizeRocketLabJoinText(slugText);

  let bestScore = 0;
  let matchedAlias: string | null = null;
  let reasons: string[] = [];

  for (const alias of aliases) {
    const aliasText = normalizeRocketLabJoinText(alias);
    const aliasKey = slugifyRocketLabJoinText(aliasText);
    const aliasTokens = tokenizeRocketLabJoinText(aliasText);
    let score = 0;
    const localReasons: string[] = [];

    if (aliasKey && slugKey === aliasKey) {
      score = 120;
      localReasons.push('Exact slug match.');
    } else if (aliasKey && slugKey.startsWith(`${aliasKey}-`)) {
      score = 88;
      localReasons.push('Candidate slug extends an alias with an additional qualifier.');
    } else if (aliasKey && aliasKey.startsWith(`${slugKey}-`)) {
      score = 76;
      localReasons.push('Alias extends the candidate slug with an additional qualifier.');
    } else {
      const overlap = countTokenOverlap(aliasTokens, slugTokens);
      const minTokenCount = Math.max(1, Math.min(aliasTokens.length, slugTokens.length));
      const overlapRatio = minTokenCount > 0 ? overlap / minTokenCount : 0;

      if (overlap >= 3 && overlapRatio >= 0.8) {
        score = 84;
        localReasons.push('High Rocket Lab token overlap.');
      } else if (overlap >= 2 && overlapRatio >= 0.66) {
        score = 72;
        localReasons.push('Moderate Rocket Lab token overlap.');
      } else if (overlap >= 1 && aliasKey.length >= 12 && slugKey.includes(aliasKey)) {
        score = 68;
        localReasons.push('Candidate slug contains a long alias phrase.');
      }
    }

    if (score > bestScore) {
      bestScore = score;
      matchedAlias = alias;
      reasons = localReasons;
    }
  }

  return {
    url,
    slug,
    score: bestScore,
    matchedAlias,
    reasons
  };
}

function normalizeRocketLabJoinText(value: string | null | undefined) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[|:;/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s()-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripRocketLabParenthetical(value: string) {
  return value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitRocketLabAliasParts(value: string) {
  const parts = new Set<string>();
  for (const raw of value.split('|')) {
    const part = raw.trim();
    if (part) parts.add(part);
  }
  for (const raw of value.split(':')) {
    const part = raw.trim();
    if (part) parts.add(part);
  }
  return [...parts.values()];
}

function slugifyRocketLabJoinText(value: string) {
  return value
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function tokenizeRocketLabJoinText(value: string) {
  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => !ROCKET_LAB_STOPWORDS.has(token));
  return tokens.length > 0 ? tokens : value.split(/\s+/).map((token) => token.trim().toLowerCase()).filter(Boolean);
}

function countTokenOverlap(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
