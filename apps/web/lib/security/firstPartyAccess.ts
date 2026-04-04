const TOKEN_VERSION = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type SignedEnvelope<T> = {
  v: number;
  kind: string;
  payload: T;
};

export const PUBLIC_VIEW_COOKIE_NAME = 'tmz_public_view';
export const APP_CLIENT_HEADER_NAME = 'x-tmz-app-client';
export const APP_GUEST_TOKEN_HEADER_NAME = 'x-tmz-app-guest-token';

export type AppClientPlatform = 'ios' | 'android';

export type PublicViewPayload = {
  scope: 'site';
  fingerprint: string;
  iat: number;
  exp: number;
};

export type AppGuestTokenPayload = {
  installationId: string;
  platform: AppClientPlatform;
  appVersion: string | null;
  buildProfile: string | null;
  iat: number;
  exp: number;
};

export type AppClientContext = {
  installationId: string;
  platform: AppClientPlatform;
  appVersion: string | null;
  buildProfile: string | null;
};

const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBase64(base64: string) {
  return base64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64.length / 4) * 4, '=');
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  throw new Error('Base64 encoding is unavailable in this runtime.');
}

function base64ToBytes(base64: string) {
  const normalized = normalizeBase64(base64);

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }

  if (typeof atob === 'function') {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  throw new Error('Base64 decoding is unavailable in this runtime.');
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  return base64ToBytes(value);
}

function decodeBase64UrlText(value: string) {
  return textDecoder.decode(decodeBase64Url(value));
}

async function getHmacKey(secret: string) {
  const existing = hmacKeyCache.get(secret);
  if (existing) {
    return existing;
  }

  const created = crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  hmacKeyCache.set(secret, created);
  return created;
}

async function signValue(secret: string, payload: string) {
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return new Uint8Array(signature);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

async function sealEnvelope<T>(secret: string, kind: string, payload: T) {
  const encodedPayload = encodeBase64Url(JSON.stringify({ v: TOKEN_VERSION, kind, payload } satisfies SignedEnvelope<T>));
  const signature = encodeBase64Url(await signValue(secret, encodedPayload));
  return `${encodedPayload}.${signature}`;
}

async function openEnvelope<T>(token: string, secret: string, kind: string) {
  const raw = normalizeText(token);
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 2) return null;

  const [payloadPart, signaturePart] = parts;
  const expectedSignature = await signValue(secret, payloadPart);
  const actualSignature = decodeBase64Url(signaturePart);
  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const decoded = JSON.parse(decodeBase64UrlText(payloadPart)) as Partial<SignedEnvelope<T>>;
    if (decoded.v !== TOKEN_VERSION || decoded.kind !== kind || !decoded.payload) {
      return null;
    }
    return decoded.payload as T;
  } catch {
    return null;
  }
}

async function hashStableText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest).slice(0, 18));
}

export async function buildPublicViewFingerprint(headers: Headers) {
  const userAgent = normalizeText(headers.get('user-agent'))?.toLowerCase() || 'unknown';
  const language = normalizeText(headers.get('accept-language'))?.toLowerCase() || 'unknown';
  return hashStableText(`${userAgent}|${language}`);
}

export async function issuePublicViewToken(secret: string, fingerprint: string, ttlSeconds = 5 * 60) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return sealEnvelope<PublicViewPayload>(secret, 'public_view', {
    scope: 'site',
    fingerprint,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  });
}

export async function verifyPublicViewToken(token: string | null | undefined, secret: string, fingerprint: string) {
  const payload = await openEnvelope<PublicViewPayload>(String(token || ''), secret, 'public_view');
  if (!payload) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.scope !== 'site' || payload.exp <= nowSeconds) {
    return null;
  }
  if (payload.fingerprint !== fingerprint) {
    return null;
  }
  return payload;
}

function normalizeAppPlatform(value: unknown): AppClientPlatform | null {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === 'ios' || normalized === 'android' ? normalized : null;
}

function normalizeOptionalHeaderValue(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized ?? null;
}

export function parseAppClientContext(value: string | null | undefined): AppClientContext | null {
  const raw = normalizeText(value);
  if (!raw) return null;

  const searchParams = new URLSearchParams(raw);
  const installationId = normalizeText(searchParams.get('installation_id'));
  const platform = normalizeAppPlatform(searchParams.get('platform'));
  if (!installationId || !platform) {
    return null;
  }

  return {
    installationId,
    platform,
    appVersion: normalizeOptionalHeaderValue(searchParams.get('app_version')),
    buildProfile: normalizeOptionalHeaderValue(searchParams.get('build_profile'))
  };
}

export function serializeAppClientContext(context: AppClientContext) {
  const searchParams = new URLSearchParams();
  searchParams.set('installation_id', context.installationId);
  searchParams.set('platform', context.platform);
  if (context.appVersion) {
    searchParams.set('app_version', context.appVersion);
  }
  if (context.buildProfile) {
    searchParams.set('build_profile', context.buildProfile);
  }
  return searchParams.toString();
}

export async function issueAppGuestToken(secret: string, context: AppClientContext, ttlSeconds = 5 * 60) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return sealEnvelope<AppGuestTokenPayload>(secret, 'app_guest', {
    installationId: context.installationId,
    platform: context.platform,
    appVersion: context.appVersion,
    buildProfile: context.buildProfile,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  });
}

export async function verifyAppGuestToken(
  token: string | null | undefined,
  secret: string,
  context: AppClientContext | null
) {
  if (!context) return null;

  const payload = await openEnvelope<AppGuestTokenPayload>(String(token || ''), secret, 'app_guest');
  if (!payload) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return null;
  }

  if (payload.installationId !== context.installationId || payload.platform !== context.platform) {
    return null;
  }

  if ((payload.appVersion || null) !== (context.appVersion || null)) {
    return null;
  }

  if ((payload.buildProfile || null) !== (context.buildProfile || null)) {
    return null;
  }

  return payload;
}
