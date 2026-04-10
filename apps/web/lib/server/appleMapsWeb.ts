import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { normalizeEnvText, normalizeEnvUrl } from '@/lib/env/normalize';
import {
  getAppleDeveloperTeamId,
  getAppleMapsWebAllowedOrigins,
  getAppleMapsWebKeyId,
  getAppleMapsWebMapsId,
  getAppleMapsWebPrivateKey,
  getAppleMapsWebPrivateKeyPath,
  getSiteUrl,
  isAppleMapsWebConfigured
} from '@/lib/server/env';

type AppleMapsWebConfig = {
  teamId: string;
  keyId: string;
  mapsId: string;
  privateKeyPem: string;
};

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const TOKEN_CACHE = new Map<string, TokenCacheEntry>();
const TOKEN_TTL_SECONDS = 5 * 60;
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000;

function base64UrlEncode(value: string | Buffer) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePemValue(value: string | null | undefined) {
  const normalized = normalizeEnvText(value);
  if (!normalized) return null;
  return normalized.replace(/\\n/g, '\n');
}

function normalizeDomainValue(value: string | null | undefined) {
  const normalized = normalizeEnvText(value);
  if (!normalized) return null;

  const withProtocol = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return normalized
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .trim()
      .toLowerCase() || null;
  }
}

function readAppleMapsWebPrivateKeyPem() {
  const inlinePrivateKey = normalizePemValue(getAppleMapsWebPrivateKey());
  if (inlinePrivateKey) {
    return inlinePrivateKey;
  }

  const privateKeyPath = normalizeEnvText(getAppleMapsWebPrivateKeyPath());
  if (!privateKeyPath) {
    return null;
  }

  const resolvedPath = path.resolve(privateKeyPath);
  return normalizePemValue(fs.readFileSync(resolvedPath, 'utf8'));
}

function getAppleMapsWebConfig(): AppleMapsWebConfig | null {
  if (!isAppleMapsWebConfigured()) {
    return null;
  }

  const teamId = normalizeEnvText(process.env.APPLE_MAPS_WEB_TEAM_ID) || getAppleDeveloperTeamId();
  const keyId = getAppleMapsWebKeyId();
  const mapsId = getAppleMapsWebMapsId();
  const privateKeyPem = readAppleMapsWebPrivateKeyPem();

  if (!teamId || !keyId || !mapsId || !privateKeyPem) {
    return null;
  }

  return {
    teamId,
    keyId,
    mapsId,
    privateKeyPem
  };
}

function getAllowedOrigins() {
  const configuredOrigins = getAppleMapsWebAllowedOrigins();
  if (configuredOrigins.length > 0) {
    return new Set(configuredOrigins.map((entry) => normalizeDomainValue(entry)).filter((entry): entry is string => Boolean(entry)));
  }

  const fallbackOrigins = new Set<string>();
  const siteUrl = normalizeEnvUrl(getSiteUrl());
  if (siteUrl) {
    const siteDomain = normalizeDomainValue(siteUrl);
    if (siteDomain) {
      fallbackOrigins.add(siteDomain);
    }
  }

  const vercelUrl = normalizeEnvText(process.env.VERCEL_URL);
  if (vercelUrl) {
    const vercelDomain = normalizeDomainValue(vercelUrl);
    if (vercelDomain) {
      fallbackOrigins.add(vercelDomain);
    }
  }

  fallbackOrigins.add('localhost');
  fallbackOrigins.add('127.0.0.1');
  return fallbackOrigins;
}

export function resolveRequestDomain(requestHeaders: Headers) {
  const originHeader = normalizeDomainValue(requestHeaders.get('origin'));
  if (originHeader) {
    return originHeader;
  }

  const forwardedHost = normalizeEnvText(requestHeaders.get('x-forwarded-host'));
  const host = forwardedHost || normalizeEnvText(requestHeaders.get('host'));
  if (!host) {
    return null;
  }

  return normalizeDomainValue(host);
}

function isAllowedOrigin(origin: string) {
  return getAllowedOrigins().has(origin);
}

function createAppleMapsWebToken(config: AppleMapsWebConfig, origin: string) {
  const cacheKey = `${config.keyId}:${config.mapsId}:${origin}`;
  const cached = TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cached.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const header = base64UrlEncode(
    JSON.stringify({
      alg: 'ES256',
      kid: config.keyId,
      typ: 'JWT'
    })
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: config.teamId,
      iat: now,
      exp: expiresAt,
      origin,
      sub: config.mapsId
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), createPrivateKey(config.privateKeyPem));
  const token = `${signingInput}.${base64UrlEncode(signature)}`;

  TOKEN_CACHE.set(cacheKey, {
    token,
    expiresAt: expiresAt * 1000
  });

  return token;
}

export function getAppleMapsWebAuthorizationTokenForRequest(requestHeaders: Headers) {
  const config = getAppleMapsWebConfig();
  if (!config) {
    return null;
  }

  const origin = resolveRequestDomain(requestHeaders);
  if (!origin || !isAllowedOrigin(origin)) {
    return null;
  }

  try {
    return createAppleMapsWebToken(config, origin);
  } catch (error) {
    console.error('apple maps web token generation failed', error);
    return null;
  }
}
