import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CANONICAL_HOST, COOKIE_DOMAIN, DOMAIN_APEX } from '@/lib/brand';
import { isSupabaseConfigured } from '@/lib/server/env';
import { buildLegacyCatalogRedirectHref } from '@/lib/utils/catalog';
import { toProviderSlug } from '@/lib/utils/launchLinks';

type RateLimitWindow = { count: number; resetAt: number };

const RATE_LIMIT_STORE_KEY = '__tmn_rate_limit__';
const rateLimitStore: Map<string, RateLimitWindow> = (() => {
  const globalScope = globalThis as unknown as Record<string, unknown>;
  const existing = globalScope[RATE_LIMIT_STORE_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, RateLimitWindow>;
  }
  const store = new Map<string, RateLimitWindow>();
  globalScope[RATE_LIMIT_STORE_KEY] = store;
  return store;
})();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LEGACY_HOSTS = new Set(['tminusnow.space', 'www.tminusnow.space']);

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

  const rateLimited = applyRateLimit(request);
  if (rateLimited) return rateLimited;

  if (pathname === '/' && (request.nextUrl.searchParams.has('code') || request.nextUrl.searchParams.has('token_hash'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url, 302);
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
  return response;
}

function applyRateLimit(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (!(method === 'GET' || method === 'HEAD')) return null;

  const pathname = request.nextUrl.pathname;
  const rule = matchRateLimitRule(pathname);
  if (!rule) return null;

  const clientId = getClientIdentifier(request);
  if (!clientId) return null;
  const tokenKey = getRateLimitTokenKey(rule.id, request);
  const key = tokenKey ? `${rule.id}:${clientId}:${tokenKey}` : `${rule.id}:${clientId}`;
  const now = Date.now();
  pruneRateLimitStore(now);

  const decision = consumeRateLimit({ key, limit: rule.limit, windowMs: rule.windowMs, now });
  const resetSeconds = Math.ceil(decision.resetAt / 1000);

  if (!decision.allowed) {
    const response = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Retry-After', String(decision.retryAfterSeconds));
    response.headers.set('X-RateLimit-Limit', String(rule.limit));
    response.headers.set('X-RateLimit-Remaining', String(decision.remaining));
    response.headers.set('X-RateLimit-Reset', String(resetSeconds));
    return response;
  }

  return null;
}

function matchRateLimitRule(pathname: string): { id: string; limit: number; windowMs: number } | null {
  if (pathname.startsWith('/api/public/')) {
    return { id: 'api_public', limit: 120, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/search/')) {
    return { id: 'api_search', limit: 60, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/launches/') && pathname.endsWith('/ics')) {
    return { id: 'api_ics', limit: 30, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/calendar/')) {
    return { id: 'api_calendar', limit: 30, windowMs: 60_000 };
  }

  if (pathname.startsWith('/rss/')) {
    return { id: 'rss', limit: 30, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/embed/')) {
    return { id: 'embed', limit: 120, windowMs: 60_000 };
  }

  if (pathname.startsWith('/embed/')) {
    return { id: 'embed', limit: 120, windowMs: 60_000 };
  }

  return null;
}

function getRateLimitTokenKey(ruleId: string, request: NextRequest): string | null {
  const uuid = (value: string | null | undefined) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) return null;
    return trimmed.toLowerCase();
  };

  if (ruleId === 'api_ics') {
    const token = uuid(request.nextUrl.searchParams.get('token'));
    return token ? `token:${hashString(token)}` : null;
  }

  if (ruleId === 'api_calendar') {
    const parts = request.nextUrl.pathname.split('/').filter(Boolean);
    const tokenPart = parts[2] || '';
    const token = uuid(tokenPart.replace(/\.ics$/i, ''));
    return token ? `token:${hashString(token)}` : null;
  }

  if (ruleId === 'rss') {
    const parts = request.nextUrl.pathname.split('/').filter(Boolean);
    const tokenPart = parts[1] || '';
    const token = uuid(tokenPart.replace(/\.(xml|atom)$/i, ''));
    return token ? `token:${hashString(token)}` : null;
  }

  if (ruleId === 'embed') {
    const token = uuid(request.nextUrl.searchParams.get('token'));
    return token ? `token:${hashString(token)}` : null;
  }

  return null;
}

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = parseForwardedFor(request.headers.get('x-forwarded-for'));
  const forwarded = parseForwardedHeader(request.headers.get('forwarded'));
  const cfConnectingIp = parseSingleIp(request.headers.get('cf-connecting-ip'));
  const trueClientIp = parseSingleIp(request.headers.get('true-client-ip'));
  const realIp = parseSingleIp(request.headers.get('x-real-ip'));
  const xClientIp = parseSingleIp(request.headers.get('x-client-ip'));
  const clusterIp = parseSingleIp(request.headers.get('x-cluster-client-ip'));
  const ip = forwardedFor || forwarded || cfConnectingIp || trueClientIp || realIp || xClientIp || clusterIp || request.ip;
  return normalizeIp(ip);
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

function consumeRateLimit({
  key,
  limit,
  windowMs,
  now
}: {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}): { allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number } {
  let entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  rateLimitStore.set(key, entry);

  const allowed = entry.count <= limit;
  const remaining = Math.max(0, limit - entry.count);
  const retryAfterSeconds = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
  return { allowed, remaining, resetAt: entry.resetAt, retryAfterSeconds };
}

function pruneRateLimitStore(now: number) {
  if (rateLimitStore.size < 5_000) return;
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) rateLimitStore.delete(key);
  }
  if (rateLimitStore.size < 10_000) return;
  let removed = 0;
  for (const key of rateLimitStore.keys()) {
    rateLimitStore.delete(key);
    removed += 1;
    if (removed >= 2_000) break;
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

function getClientIdentifier(request: NextRequest): string | null {
  const ip = getClientIp(request);
  if (ip) return `ip:${ip}`;

  const userAgent = request.headers.get('user-agent')?.trim();
  if (userAgent) return `ua:${hashString(userAgent)}`;

  const accept = request.headers.get('accept')?.trim();
  if (accept) return `accept:${hashString(accept)}`;

  return null;
}

function parseForwardedFor(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function parseForwardedHeader(value: string | null): string | null {
  if (!value) return null;
  for (const part of value.split(',')) {
    const match = part.match(/for=("?)([^;,\"]+)\1/i);
    if (!match) continue;
    return match[2]?.trim() || null;
  }
  return null;
}

function parseSingleIp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeIp(value?: string | null): string | null {
  if (!value) return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  trimmed = trimmed.replace(/^\"|\"$/g, '');
  if (!trimmed || trimmed === 'unknown' || trimmed.startsWith('_')) return null;

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 0) return trimmed.slice(1, end);
  }

  const hasDot = trimmed.includes('.');
  const lastColon = trimmed.lastIndexOf(':');
  if (hasDot && lastColon > -1) {
    const port = trimmed.slice(lastColon + 1);
    if (/^\d+$/.test(port)) return trimmed.slice(0, lastColon);
  }

  return trimmed;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
