import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

type DurableRateLimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  tokenKey?: string | null;
  clientId?: string | null;
  errorCode?: string;
};

function parseForwardedFor(value: string | null) {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function parseForwardedHeader(value: string | null) {
  if (!value) return null;
  for (const part of value.split(',')) {
    const match = part.match(/for=("?)([^;,\"]+)\1/i);
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
  const trimmed = value.trim().replace(/^\"|\"$/g, '');
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

function hashValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
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

function readClientIdentifier(headers: Headers) {
  const ip = readClientIp(headers);
  if (ip) return `ip:${ip}`;

  const userAgent = headers.get('user-agent')?.trim();
  if (userAgent) return `ua:${hashValue(userAgent)}`;

  const accept = headers.get('accept')?.trim();
  if (accept) return `accept:${hashValue(accept)}`;

  return null;
}

function floorWindow(nowMs: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

function buildProviderName(scope: string, clientId: string | null, tokenKey: string | null) {
  const parts = [scope.trim(), clientId?.trim() || 'anonymous'];
  if (tokenKey) {
    parts.push(`token:${hashValue(tokenKey.trim())}`);
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'tmz_api_rate_limit';
  return `route:${scope}:${hashValue(`${secret}:${parts.join('|')}`)}`;
}

export async function enforceDurableRateLimit(
  request: Request,
  {
    scope,
    limit,
    windowSeconds,
    tokenKey = null,
    clientId = null,
    errorCode = 'rate_limited'
  }: DurableRateLimitOptions
) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return null;
  }

  const resolvedClientId = clientId ?? readClientIdentifier(request.headers);
  const providerName = buildProviderName(scope, resolvedClientId, tokenKey);
  const nowMs = Date.now();
  const windowStartMs = floorWindow(nowMs, windowSeconds);
  const resetAtMs = windowStartMs + windowSeconds * 1000;
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAtMs - nowMs) / 1000));

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('try_increment_api_rate', {
    provider_name: providerName,
    window_start_in: new Date(windowStartMs).toISOString(),
    window_seconds_in: windowSeconds,
    limit_in: limit
  });

  if (error) {
    console.error(`durable rate limit error for ${scope}`, error);
    return null;
  }

  if (data !== false) {
    return null;
  }

  const response = NextResponse.json(
    { error: errorCode },
    {
      status: 429
    }
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Retry-After', String(retryAfterSeconds));
  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', '0');
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetAtMs / 1000)));
  return response;
}
