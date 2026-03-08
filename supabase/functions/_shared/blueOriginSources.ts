import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSettings, readStringSetting } from './settings.ts';

export const BLUE_ORIGIN_SOURCE_URLS = {
  missions: 'https://www.blueorigin.com/missions',
  news: 'https://www.blueorigin.com/news',
  gallery: 'https://www.blueorigin.com/gallery',
  engines: 'https://www.blueorigin.com/engines',
  newShepard: 'https://www.blueorigin.com/new-shepard',
  newGlenn: 'https://www.blueorigin.com/new-glenn',
  blueMoon: 'https://www.blueorigin.com/blue-moon',
  blueRing: 'https://www.blueorigin.com/blue-ring',
  be3pm: 'https://www.blueorigin.com/engines/be-3',
  be3u: 'https://www.blueorigin.com/engines/be-3',
  be4: 'https://www.blueorigin.com/engines/be-4',
  be7: 'https://www.blueorigin.com/engines/be-7',
  nasaBlueMoonHls: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-as-second-artemis-lunar-lander-provider/',
  nasaBlueMoonViper: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-to-deliver-viper-rover-to-moons-south-pole/',
  ussfNssl: 'https://www.spaceforce.mil/News/Article/3806236/us-space-force-awards-national-security-space-launch-contracts/',
  amazonKuiper:
    'https://press.aboutamazon.com/2022/4/amazon-secures-up-to-83-launches-from-arianespace-blue-origin-and-united-launch-alliance-for-project-kuiper'
} as const;

const SOURCE_URL_SETTING_MAP = {
  missions: 'blue_origin_source_missions_url',
  news: 'blue_origin_source_news_url',
  gallery: 'blue_origin_source_gallery_url',
  engines: 'blue_origin_source_engines_url',
  newShepard: 'blue_origin_source_new_shepard_url',
  newGlenn: 'blue_origin_source_new_glenn_url',
  blueMoon: 'blue_origin_source_blue_moon_url',
  blueRing: 'blue_origin_source_blue_ring_url',
  be3pm: 'blue_origin_source_be3pm_url',
  be3u: 'blue_origin_source_be3u_url',
  be4: 'blue_origin_source_be4_url',
  be7: 'blue_origin_source_be7_url',
  nasaBlueMoonHls: 'blue_origin_source_nasa_blue_moon_hls_url',
  nasaBlueMoonViper: 'blue_origin_source_nasa_blue_moon_viper_url',
  ussfNssl: 'blue_origin_source_ussf_nssl_url',
  amazonKuiper: 'blue_origin_source_amazon_kuiper_url'
} as const;

const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const DEFAULT_FETCH_RETRIES = 4;
const DEFAULT_FETCH_BACKOFF_MS = 900;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

type BlueOriginSourceUrlKey = keyof typeof BLUE_ORIGIN_SOURCE_URLS;

type FetchTextOptions = {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type FetchTextWithMetaResult = {
  ok: boolean;
  status: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  text: string;
  attemptCount: number;
  challenge: boolean;
  throttled: boolean;
  retryAfterMs: number | null;
  error: string | null;
  finalUrl: string | null;
};

export async function resolveBlueOriginSourceUrls(supabase: SupabaseClient): Promise<Record<BlueOriginSourceUrlKey, string>> {
  const settingKeys = Object.values(SOURCE_URL_SETTING_MAP);
  const settings = await getSettings(supabase, settingKeys);
  const resolved: Record<BlueOriginSourceUrlKey, string> = { ...BLUE_ORIGIN_SOURCE_URLS };

  for (const [key, settingKey] of Object.entries(SOURCE_URL_SETTING_MAP) as Array<[BlueOriginSourceUrlKey, string]>) {
    const value = readStringSetting(settings[settingKey], '').trim();
    if (!value) continue;
    if (value.startsWith('https://') || value.startsWith('http://')) resolved[key] = value;
  }

  return resolved;
}

export async function fetchTextWithMeta(url: string, options: FetchTextOptions = {}): Promise<FetchTextWithMetaResult> {
  const retries = clampInt(options.retries ?? DEFAULT_FETCH_RETRIES, 1, 6);
  const backoffMs = clampInt(options.backoffMs ?? DEFAULT_FETCH_BACKOFF_MS, 200, 20_000);
  const timeoutMs = clampInt(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS, 1_000, 60_000);
  const extraHeaders = options.headers || {};

  let lastResult: FetchTextWithMetaResult = {
    ok: false,
    status: 0,
    contentType: null,
    etag: null,
    lastModified: null,
    text: '',
    attemptCount: 0,
    challenge: false,
    throttled: false,
    retryAfterMs: null,
    error: 'unreachable',
    finalUrl: null
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
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const throttled = challenge || response.status === 429 || response.status === 403;
      const ok = response.ok && !challenge;

      lastResult = {
        ok,
        status: response.status,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        text,
        attemptCount: attempt,
        challenge,
        throttled,
        retryAfterMs,
        error: ok ? null : `http_${response.status}${challenge ? '_challenge' : ''}`,
        finalUrl: response.url || url
      };

      if (ok) return lastResult;

      const shouldRetry = attempt < retries && (isRetryableStatus(response.status) || challenge);
      if (!shouldRetry) return lastResult;

      await sleep(retryAfterMs ?? buildBackoffMs(backoffMs, attempt));
    } catch (err) {
      clearTimeout(timeout);
      const message = stringifyError(err);
      lastResult = {
        ok: false,
        status: 0,
        contentType: null,
        etag: null,
        lastModified: null,
        text: '',
        attemptCount: attempt,
        challenge: false,
        throttled: false,
        retryAfterMs: null,
        error: message,
        finalUrl: null
      };

      if (attempt >= retries) return lastResult;
      await sleep(buildBackoffMs(backoffMs, attempt));
    }
  }

  return lastResult;
}

export async function fetchJsonWithMeta(url: string, options: FetchTextOptions = {}) {
  const result = await fetchTextWithMeta(url, {
    ...options,
    headers: {
      Accept: 'application/json,*/*',
      ...(options.headers || {})
    }
  });

  let json: unknown = null;
  if (result.text) {
    try {
      json = JSON.parse(result.text);
    } catch {
      json = null;
    }
  }

  return {
    ...result,
    json
  };
}

export function extractPathLinks(html: string, sourceUrl: string, prefixes: string[]) {
  const base = safeUrl(sourceUrl);
  if (!base) return [] as string[];

  const found = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const rawHref = match[1];
    if (!rawHref) continue;

    const absolute = toAbsoluteUrl(rawHref, base);
    if (!absolute) continue;

    const parsed = safeUrl(absolute);
    if (!parsed) continue;
    if (parsed.host !== base.host) continue;

    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    if (!prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) continue;
    if (pathname === '/missions' || pathname === '/news' || pathname === '/gallery') continue;
    found.add(`${parsed.origin}${pathname}`);
  }

  return [...found.values()].sort();
}

export function extractMissionLinks(html: string, sourceUrl: string) {
  return extractPathLinks(html, sourceUrl, ['/missions']);
}

export function extractNewsLinks(html: string, sourceUrl: string) {
  return extractPathLinks(html, sourceUrl, ['/news']);
}

export function extractBlueOriginFlightCodeFromUrl(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const slug = parsed.pathname.split('/').filter(Boolean).at(-1) || '';
  const normalized = slug.toLowerCase();
  const ns = normalized.match(/\bns-?(\d{1,3})\b/);
  if (ns?.[1]) return `ns-${Number(ns[1])}`;
  const ng = normalized.match(/\bng-?(\d{1,3})\b/);
  if (ng?.[1]) return `ng-${Number(ng[1])}`;
  return null;
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function buildBackoffMs(backoffMs: number, attempt: number) {
  const jitter = Math.round(Math.random() * 350);
  const factor = Math.max(0, attempt - 1);
  return backoffMs * 2 ** factor + jitter;
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.min(300_000, Math.max(500, Math.round(numeric * 1_000)));
  }

  const epochMs = Date.parse(trimmed);
  if (!Number.isFinite(epochMs)) return null;
  return Math.min(300_000, Math.max(500, epochMs - Date.now()));
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

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
