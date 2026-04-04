import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CANONICAL_HOST, COOKIE_DOMAIN, DOMAIN_APEX } from '@/lib/brand';
import { getAntiIngestionTokenSecret, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import {
  APP_CLIENT_HEADER_NAME,
  APP_GUEST_TOKEN_HEADER_NAME,
  PUBLIC_VIEW_COOKIE_NAME,
  buildPublicViewFingerprint,
  issuePublicViewToken,
  parseAppClientContext,
  verifyAppGuestToken,
  verifyPublicViewToken
} from '@/lib/security/firstPartyAccess';
import { buildLegacyCatalogRedirectHref } from '@/lib/utils/catalog';
import { toProviderSlug } from '@/lib/utils/launchLinks';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEGACY_HOSTS = new Set(['tminusnow.space', 'www.tminusnow.space']);

type MiddlewareRateLimitRule = {
  scope: string;
  limit: number;
  windowSeconds: number;
};

type InMemoryRateLimitWindow = {
  count: number;
  resetAt: number;
};

const LEGACY_RATE_LIMIT_RULES: Array<{ matches: (pathname: string) => boolean; rule: MiddlewareRateLimitRule }> = [
  {
    matches: (pathname) => pathname === '/api/public' || pathname.startsWith('/api/public/'),
    rule: {
      scope: 'legacy_public_api',
      limit: 120,
      windowSeconds: 60
    }
  },
  {
    matches: (pathname) => pathname === '/embed' || pathname.startsWith('/embed/'),
    rule: {
      scope: 'legacy_embed_surface',
      limit: 120,
      windowSeconds: 60
    }
  }
];

const RATE_LIMIT_STORE_KEY = '__tmz_legacy_middleware_rate_limit__';
const PROTECTED_PUBLIC_API_PREFIXES = ['/api/public', '/api/search/index'];
const PROTECTED_V1_PREFIXES = [
  '/api/v1/artemis',
  '/api/v1/blue-origin',
  '/api/v1/catalog',
  '/api/v1/content',
  '/api/v1/contracts',
  '/api/v1/info',
  '/api/v1/launches',
  '/api/v1/locations',
  '/api/v1/news',
  '/api/v1/pads',
  '/api/v1/providers',
  '/api/v1/rockets',
  '/api/v1/satellites',
  '/api/v1/search',
  '/api/v1/spacex',
  '/api/v1/starship'
];
const LEGACY_NATIVE_APP_USER_AGENT_PATTERNS = [/okhttp/i, /cfnetwork/i, /darwin/i, /expo/i, /tminuszero/i];
const inMemoryRateLimitStore: Map<string, InMemoryRateLimitWindow> = (() => {
  const globalScope = globalThis as unknown as Record<string, unknown>;
  const existing = globalScope[RATE_LIMIT_STORE_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, InMemoryRateLimitWindow>;
  }

  const store = new Map<string, InMemoryRateLimitWindow>();
  globalScope[RATE_LIMIT_STORE_KEY] = store;
  return store;
})();

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get('host') || '';
  const host = hostHeader.split(':')[0]?.trim().toLowerCase();
  const pathname = request.nextUrl.pathname;
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
  const isLegacyHost = LEGACY_HOSTS.has(host);
  if (isLegacyHost) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }
  const shouldRedirectToCanonical = host === DOMAIN_APEX && !isApiPath;

  if (shouldRedirectToCanonical) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto?.split(',')[0]?.trim();
  const isHttps = proto ? proto === 'https' : request.nextUrl.protocol === 'https:';

  if (!isHttps) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }

  const legacyProviderSlug = extractLegacyLaunchProviderSlug(pathname);
  if (legacyProviderSlug) {
    const url = request.nextUrl.clone();
    url.pathname = `/launch-providers/${legacyProviderSlug}`;
    return NextResponse.redirect(url, 308);
  }

  const legacyCatalogHref = resolveLegacyCatalogHref(request);
  if (legacyCatalogHref) {
    const target = new URL(legacyCatalogHref, request.nextUrl.origin);
    const url = request.nextUrl.clone();
    url.pathname = target.pathname;
    url.search = target.search;
    return NextResponse.redirect(url, 308);
  }

  if (pathname === '/' && (request.nextUrl.searchParams.has('code') || request.nextUrl.searchParams.has('token_hash'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url, 302);
  }

  const antiIngestionSecret = getAntiIngestionTokenSecret();
  if (antiIngestionSecret) {
    const protectedResponse = await maybeEnforceFirstPartyApiAccess(request, pathname, antiIngestionSecret);
    if (protectedResponse) {
      return applyApiHardeningHeaders(pathname, protectedResponse);
    }
  }

  const legacyRateLimitRule = matchLegacyRateLimitRule(pathname);
  if (legacyRateLimitRule) {
    const rateLimited = await enforceLegacyRateLimit(request, legacyRateLimitRule);
    if (rateLimited) {
      return applyApiHardeningHeaders(pathname, rateLimited);
    }
  }

  let response = NextResponse.next();

  if (shouldSyncSupabase(request)) {
    response = await syncSupabaseSession(request, response);
  }

  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.size > 0) {
    const rawPage = request.nextUrl.searchParams.get('page');
    const page = rawPage ? Number(rawPage) : NaN;
    const isOnlyPageParam = request.nextUrl.searchParams.size === 1 && rawPage != null;
    const isIndexablePage =
      isOnlyPageParam && Number.isFinite(page) && page > 1 && Number.isInteger(page);

    if (!isIndexablePage) {
      response.headers.set('X-Robots-Tag', 'noindex,follow');
    }
  }

  if (antiIngestionSecret && shouldIssuePublicViewCookie(request)) {
    response = await attachPublicViewCookie(request, response, antiIngestionSecret);
  }

  return applyApiHardeningHeaders(pathname, response);
}

function extractLegacyLaunchProviderSlug(pathname: string) {
  const match = pathname.match(/^\/launch-providers\/([^/]+)$/i);
  const rawSegment = match?.[1]?.trim();
  if (!rawSegment || !rawSegment.includes(':')) return null;

  const decoded = safeDecodeURIComponent(rawSegment);
  const [left] = decoded.split(':', 1);
  const normalizedLeft = toProviderSlug((left || '').trim());
  const normalizedFull = toProviderSlug(decoded);
  const target = normalizedLeft || normalizedFull;
  if (!target) return null;

  const current = toProviderSlug(rawSegment);
  return current && current === target ? null : target;
}

function resolveLegacyCatalogHref(request: NextRequest) {
  if (request.nextUrl.pathname !== '/catalog') return null;
  return buildLegacyCatalogRedirectHref({
    entity: request.nextUrl.searchParams.get('entity'),
    region: request.nextUrl.searchParams.get('region'),
    q: request.nextUrl.searchParams.get('q'),
    page: request.nextUrl.searchParams.get('page')
  });
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchLegacyRateLimitRule(pathname: string) {
  for (const { matches, rule } of LEGACY_RATE_LIMIT_RULES) {
    if (matches(pathname)) {
      return rule;
    }
  }
  return null;
}

function matchesProtectedPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isProtectedPublicApiPath(pathname: string) {
  return matchesProtectedPrefix(pathname, PROTECTED_PUBLIC_API_PREFIXES);
}

function isProtectedV1Path(pathname: string) {
  return matchesProtectedPrefix(pathname, PROTECTED_V1_PREFIXES);
}

function requestHasBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ');
}

function requestHasSupabaseSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

function requestHasViewerAuth(request: NextRequest) {
  return requestHasBearerToken(request) || requestHasSupabaseSessionCookie(request);
}

function looksLikeLegacyNativeAppClient(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  if (!userAgent) return false;
  if (request.headers.get(APP_CLIENT_HEADER_NAME) || request.headers.get(APP_GUEST_TOKEN_HEADER_NAME)) {
    return false;
  }
  if (request.headers.get('sec-fetch-site') || request.headers.get('sec-fetch-mode')) {
    return false;
  }
  return LEGACY_NATIVE_APP_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function headerMatchesRequestHost(value: string | null, request: NextRequest) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.host.toLowerCase() === request.nextUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

function hasFirstPartyBrowserContext(request: NextRequest) {
  const secFetchSite = (request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') {
    return true;
  }
  if (secFetchSite === 'cross-site') {
    return false;
  }

  return (
    headerMatchesRequestHost(request.headers.get('origin'), request) || headerMatchesRequestHost(request.headers.get('referer'), request)
  );
}

function buildFirstPartyRequiredResponse(reason: 'public_view_required' | 'app_guest_token_required') {
  return NextResponse.json(
    {
      error: 'first_party_required',
      reason
    },
    {
      status: 403,
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}

async function maybeEnforceFirstPartyApiAccess(request: NextRequest, pathname: string, secret: string) {
  if (request.method === 'OPTIONS') {
    return null;
  }

  const isPublicApiPath = isProtectedPublicApiPath(pathname);
  const isProtectedV1ApiPath = isProtectedV1Path(pathname) && (request.method === 'GET' || request.method === 'HEAD');
  if (!isPublicApiPath && !isProtectedV1ApiPath) {
    return null;
  }

  if (requestHasViewerAuth(request)) {
    return null;
  }

  const firstPartyBrowserContext = hasFirstPartyBrowserContext(request);
  const publicViewFingerprint = await buildPublicViewFingerprint(request.headers);
  const publicViewCookie = request.cookies.get(PUBLIC_VIEW_COOKIE_NAME)?.value;
  const publicViewProof =
    firstPartyBrowserContext && publicViewCookie
      ? await verifyPublicViewToken(publicViewCookie, secret, publicViewFingerprint)
      : null;

  if (publicViewProof) {
    return null;
  }

  if (isPublicApiPath) {
    return buildFirstPartyRequiredResponse('public_view_required');
  }

  const appClientContext = parseAppClientContext(request.headers.get(APP_CLIENT_HEADER_NAME));
  const appGuestProof = await verifyAppGuestToken(request.headers.get(APP_GUEST_TOKEN_HEADER_NAME), secret, appClientContext);
  if (appGuestProof) {
    return null;
  }

  if (looksLikeLegacyNativeAppClient(request)) {
    return null;
  }

  return buildFirstPartyRequiredResponse('app_guest_token_required');
}

function shouldIssuePublicViewCookie(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const pathname = request.nextUrl.pathname;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/_next/')) return false;
  if (pathname.startsWith('/account') || pathname.startsWith('/admin') || pathname.startsWith('/auth') || pathname.startsWith('/me')) return false;
  if (pathname.startsWith('/embed') || pathname.startsWith('/share')) return false;
  if (pathname.startsWith('/favicon') || pathname.startsWith('/apple-touch-icon') || pathname.startsWith('/icon-')) return false;
  return !/\.[^/]+$/.test(pathname);
}

async function attachPublicViewCookie(request: NextRequest, response: NextResponse, secret: string) {
  const fingerprint = await buildPublicViewFingerprint(request.headers);
  const value = await issuePublicViewToken(secret, fingerprint);
  const hostHeader = request.headers.get('host') || '';
  const host = hostHeader.split(':')[0]?.trim().toLowerCase();
  const isProdDomain = host === DOMAIN_APEX || host === CANONICAL_HOST;

  response.cookies.set({
    name: PUBLIC_VIEW_COOKIE_NAME,
    value,
    httpOnly: true,
    maxAge: 5 * 60,
    path: '/',
    sameSite: 'lax',
    secure: true,
    ...(isProdDomain ? { domain: COOKIE_DOMAIN } : {})
  });

  return response;
}

function applyApiHardeningHeaders(pathname: string, response: NextResponse) {
  if (!(pathname === '/api' || pathname.startsWith('/api/'))) {
    return response;
  }

  const existingRobots = response.headers.get('X-Robots-Tag');
  if (!existingRobots) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  } else {
    const parts = existingRobots
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!parts.includes('noindex')) parts.push('noindex');
    if (!parts.includes('nofollow')) parts.push('nofollow');
    response.headers.set('X-Robots-Tag', parts.join(', '));
  }

  const vary = response.headers.get('Vary');
  const nextVary = ['Sec-Fetch-Site', 'Origin', 'Referer', APP_CLIENT_HEADER_NAME, APP_GUEST_TOKEN_HEADER_NAME]
    .filter((value) => !(vary || '').split(',').map((entry) => entry.trim()).includes(value))
    .join(', ');
  if (nextVary) {
    response.headers.set('Vary', vary ? `${vary}, ${nextVary}` : nextVary);
  }
  return response;
}

async function hashValue(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .slice(0, 20)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseForwardedFor(value: string | null) {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function parseForwardedHeader(value: string | null) {
  if (!value) return null;
  for (const part of value.split(',')) {
    const match = part.match(/for=("?)([^;,"]+)\1/i);
    if (!match) continue;
    return match[2]?.trim() || null;
  }
  return null;
}

function parseSingleIp(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeIp(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^"|"$|^'|'$/g, '');
  if (!trimmed || trimmed === 'unknown' || trimmed.startsWith('_')) return null;

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 0) return trimmed.slice(1, end);
  }

  const hasDot = trimmed.includes('.');
  const lastColon = trimmed.lastIndexOf(':');
  if (hasDot && lastColon > -1) {
    const port = trimmed.slice(lastColon + 1);
    if (/^\d+$/.test(port)) {
      return trimmed.slice(0, lastColon);
    }
  }

  return trimmed;
}

function readClientIp(headers: Headers) {
  return normalizeIp(
    parseForwardedFor(headers.get('x-forwarded-for')) ||
      parseForwardedHeader(headers.get('forwarded')) ||
      parseSingleIp(headers.get('cf-connecting-ip')) ||
      parseSingleIp(headers.get('true-client-ip')) ||
      parseSingleIp(headers.get('x-real-ip')) ||
      parseSingleIp(headers.get('x-client-ip')) ||
      parseSingleIp(headers.get('x-cluster-client-ip'))
  );
}

function floorWindow(nowMs: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

function buildRateLimitedResponse({
  limit,
  retryAfterSeconds,
  resetAtMs
}: {
  limit: number;
  retryAfterSeconds: number;
  resetAtMs: number;
}) {
  const response = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Retry-After', String(retryAfterSeconds));
  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', '0');
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetAtMs / 1000)));
  return response;
}

function pruneInMemoryRateLimitStore(nowMs: number) {
  if (inMemoryRateLimitStore.size < 5_000) {
    return;
  }

  for (const [key, value] of inMemoryRateLimitStore.entries()) {
    if (value.resetAt <= nowMs) {
      inMemoryRateLimitStore.delete(key);
    }
  }

  if (inMemoryRateLimitStore.size < 10_000) {
    return;
  }

  let removed = 0;
  for (const key of inMemoryRateLimitStore.keys()) {
    inMemoryRateLimitStore.delete(key);
    removed += 1;
    if (removed >= 2_000) {
      break;
    }
  }
}

function enforceInMemoryLegacyRateLimit(request: NextRequest, rule: MiddlewareRateLimitRule) {
  const nowMs = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const clientId = readClientIp(request.headers) || normalizeIp(request.ip || null) || 'anonymous';
  const key = `${rule.scope}:${clientId}`;
  pruneInMemoryRateLimitStore(nowMs);

  let entry = inMemoryRateLimitStore.get(key);
  if (!entry || entry.resetAt <= nowMs) {
    entry = {
      count: 0,
      resetAt: nowMs + windowMs
    };
  }

  entry.count += 1;
  inMemoryRateLimitStore.set(key, entry);
  if (entry.count <= rule.limit) {
    return null;
  }

  return buildRateLimitedResponse({
    limit: rule.limit,
    retryAfterSeconds: Math.max(0, Math.ceil((entry.resetAt - nowMs) / 1000)),
    resetAtMs: entry.resetAt
  });
}

async function buildRateLimitProviderName(scope: string, request: NextRequest) {
  const clientId = readClientIp(request.headers);
  const secret = SUPABASE_SERVICE_ROLE_KEY?.trim() || 'tmz_api_rate_limit';
  const payload = `${secret}:${scope.trim()}:${clientId ? `ip:${clientId}` : 'anonymous'}`;
  return `middleware:${scope}:${await hashValue(payload)}`;
}

async function enforceLegacyRateLimit(request: NextRequest, rule: MiddlewareRateLimitRule) {
  const method = request.method.toUpperCase();
  if (!(method === 'GET' || method === 'HEAD')) {
    return null;
  }

  if (!isSupabaseAdminConfigured() || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return enforceInMemoryLegacyRateLimit(request, rule);
  }

  const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/try_increment_api_rate`;
  const nowMs = Date.now();
  const windowStartMs = floorWindow(nowMs, rule.windowSeconds);
  const resetAtMs = windowStartMs + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAtMs - nowMs) / 1000));
  const providerName = await buildRateLimitProviderName(rule.scope, request);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider_name: providerName,
        window_start_in: new Date(windowStartMs).toISOString(),
        window_seconds_in: rule.windowSeconds,
        limit_in: rule.limit
      }),
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error(`middleware legacy rate limit RPC failed for ${rule.scope}`, response.status);
      return enforceInMemoryLegacyRateLimit(request, rule);
    }

    const payload = await response.json().catch(() => null);
    if (payload !== false) {
      return null;
    }

    return buildRateLimitedResponse({
      limit: rule.limit,
      retryAfterSeconds,
      resetAtMs
    });
  } catch (error) {
    console.error(`middleware legacy rate limit request failed for ${rule.scope}`, error);
    return enforceInMemoryLegacyRateLimit(request, rule);
  }
}

function shouldSyncSupabase(request: NextRequest) {
  if (!isSupabaseConfigured() || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/share/')) return false;
  if (pathname.startsWith('/_next/')) return false;
  if (pathname.startsWith('/favicon') || pathname.startsWith('/apple-touch-icon') || pathname.startsWith('/icon-')) return false;
  return !/\.[^/]+$/.test(pathname);
}

async function syncSupabaseSession(request: NextRequest, response: NextResponse) {
  let nextResponse = response;
  const hostHeader = request.headers.get('host') || '';
  const host = hostHeader.split(':')[0]?.trim().toLowerCase();
  const isProdDomain = host === DOMAIN_APEX || host === CANONICAL_HOST;
  const cookieOptions = isProdDomain
    ? {
        domain: COOKIE_DOMAIN,
        sameSite: 'lax' as const,
        secure: true,
        path: '/'
      }
    : undefined;

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        nextResponse = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) => {
          nextResponse.cookies.set(name, value, options);
        });
      }
    },
    cookieOptions
  });

  await supabase.auth.getUser();
  return nextResponse;
}

export const config = {
  matcher: ['/((?!opengraph-image|launches/[^/]+/opengraph-image).*)']
};
