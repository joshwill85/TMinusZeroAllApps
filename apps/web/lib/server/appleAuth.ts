import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { normalizeEnvText } from '@/lib/env/normalize';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_ENDPOINT = 'https://appleid.apple.com/auth/revoke';
const DEFAULT_APPLE_WEB_CLIENT_ID = 'app.tminuszero.signin';
const DEFAULT_APPLE_MOBILE_CLIENT_ID = 'app.tminuszero.mobile';
const TOKEN_CIPHERTEXT_PREFIX = 'v1';

type AppleCaptureSource = 'ios_native_code' | 'web_provider_refresh' | 'web_provider_access';
type AppleTokenKind = 'refresh_token' | 'access_token';

export type StoredAppleSignInToken = {
  userId: string;
  clientId: string;
  appleUserId: string | null;
  tokenKind: AppleTokenKind;
  tokenValue: string | null;
  email: string | null;
  emailIsPrivateRelay: boolean;
  captureSource: AppleCaptureSource;
  lastCapturedAt: string;
  lastRevokedAt: string | null;
  lastRevocationStatus: string | null;
  lastRevocationError: string | null;
};

type AppleClientSecretConfig = {
  teamId: string;
  keyId: string;
  privateKeyPath: string;
};

type AppleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function readConfiguredValue(value: string | undefined) {
  const normalized = normalizeEnvText(value);
  return normalized || null;
}

function base64UrlEncode(value: string | Buffer) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function getAppleTokenEncryptionKey() {
  const secret =
    readConfiguredValue(process.env.APPLE_SIGN_IN_TOKEN_ENCRYPTION_SECRET) ||
    readConfiguredValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!secret) {
    return null;
  }

  return createHash('sha256').update(secret, 'utf8').digest();
}

function encryptStoredAppleToken(tokenValue: string) {
  const normalized = String(tokenValue || '').trim();
  if (!normalized) {
    return null;
  }

  const key = getAppleTokenEncryptionKey();
  if (!key) {
    return normalized;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${TOKEN_CIPHERTEXT_PREFIX}.${base64UrlEncode(iv)}.${base64UrlEncode(authTag)}.${base64UrlEncode(ciphertext)}`;
}

function decryptStoredAppleToken(tokenValue: string | null | undefined) {
  const normalized = String(tokenValue || '').trim();
  if (!normalized) {
    return null;
  }

  if (!normalized.startsWith(`${TOKEN_CIPHERTEXT_PREFIX}.`)) {
    return normalized;
  }

  const key = getAppleTokenEncryptionKey();
  if (!key) {
    throw new Error('Apple Sign In token decryption is not configured.');
  }

  const [, ivPart, authTagPart, ciphertextPart] = normalized.split('.');
  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error('Stored Apple token payload is malformed.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, base64UrlDecode(ivPart));
  decipher.setAuthTag(base64UrlDecode(authTagPart));
  const plaintext = Buffer.concat([decipher.update(base64UrlDecode(ciphertextPart)), decipher.final()]);
  return plaintext.toString('utf8').trim() || null;
}

function getAppleClientSecretConfig(): AppleClientSecretConfig | null {
  const teamId = readConfiguredValue(process.env.APPLE_SIGN_IN_TEAM_ID);
  const keyId = readConfiguredValue(process.env.APPLE_SIGN_IN_KEY_ID);
  const privateKeyPath = readConfiguredValue(process.env.APPLE_SIGN_IN_PRIVATE_KEY_PATH);
  if (!teamId || !keyId || !privateKeyPath) {
    return null;
  }

  return {
    teamId,
    keyId,
    privateKeyPath
  };
}

export function isAppleSignInServerConfigured() {
  return Boolean(getAppleClientSecretConfig());
}

export function getAppleWebClientId() {
  return readConfiguredValue(process.env.APPLE_SIGN_IN_WEB_CLIENT_ID) || DEFAULT_APPLE_WEB_CLIENT_ID;
}

export function getAppleMobileClientId() {
  return readConfiguredValue(process.env.APPLE_SIGN_IN_MOBILE_CLIENT_ID) || DEFAULT_APPLE_MOBILE_CLIENT_ID;
}

function createAppleClientSecret(clientId: string) {
  const config = getAppleClientSecretConfig();
  if (!config) {
    throw new Error('Apple Sign In server credentials are not configured.');
  }

  const resolvedPrivateKeyPath = path.resolve(config.privateKeyPath);
  const privateKeyPem = fs.readFileSync(resolvedPrivateKeyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;
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
      aud: 'https://appleid.apple.com',
      sub: clientId
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), createPrivateKey(privateKeyPem));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function describeAppleTokenError(payload: AppleTokenResponse | null, fallback: string) {
  const error = typeof payload?.error === 'string' ? payload.error : '';
  const description = typeof payload?.error_description === 'string' ? payload.error_description : '';
  return description || error || fallback;
}

export function isApplePrivateRelayEmail(email: string | null | undefined) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  return normalized.endsWith('privaterelay.appleid.com');
}

export async function exchangeAppleAuthorizationCode({
  authorizationCode,
  clientId
}: {
  authorizationCode: string;
  clientId: string;
}) {
  const clientSecret = createAppleClientSecret(clientId);
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', authorizationCode);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const response = await fetch(APPLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = (await response.json().catch(() => null)) as AppleTokenResponse | null;
  if (!response.ok) {
    throw new Error(describeAppleTokenError(payload, 'Apple token exchange failed.'));
  }

  const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token.trim() : '';
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
  if (!refreshToken && !accessToken) {
    throw new Error('Apple token exchange did not return a revocable token.');
  }

  return {
    refreshToken: refreshToken || null,
    accessToken: accessToken || null,
    idToken: typeof payload?.id_token === 'string' ? payload.id_token.trim() : null
  };
}

export async function revokeAppleToken({
  token,
  clientId
}: {
  token: string;
  clientId: string;
}) {
  const clientSecret = createAppleClientSecret(clientId);
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('token', token);

  const response = await fetch(APPLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = (await response.json().catch(() => null)) as AppleTokenResponse | null;
  if (!response.ok) {
    throw new Error(describeAppleTokenError(payload, 'Apple token revocation failed.'));
  }
}

export async function upsertAppleSignInToken(
  admin: AdminClient,
  {
    userId,
    clientId,
    tokenKind,
    tokenValue,
    captureSource,
    appleUserId,
    email,
    emailIsPrivateRelay
  }: {
    userId: string;
    clientId: string;
    tokenKind: AppleTokenKind;
    tokenValue: string;
    captureSource: AppleCaptureSource;
    appleUserId?: string | null;
    email?: string | null;
    emailIsPrivateRelay?: boolean;
  }
) {
  const storedAt = new Date().toISOString();
  const encryptedTokenValue = encryptStoredAppleToken(tokenValue);
  if (!encryptedTokenValue) {
    throw new Error('Apple Sign In token capture requires a non-empty token.');
  }

  const { error } = await admin.from('apple_sign_in_tokens').upsert(
    {
      user_id: userId,
      client_id: clientId,
      apple_user_id: appleUserId ?? null,
      token_kind: tokenKind,
      token_value: encryptedTokenValue,
      email: email ?? null,
      email_is_private_relay: emailIsPrivateRelay === true,
      capture_source: captureSource,
      last_captured_at: storedAt,
      updated_at: storedAt
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw error;
  }

  return storedAt;
}

export async function getStoredAppleSignInToken(admin: AdminClient, userId: string): Promise<StoredAppleSignInToken | null> {
  const { data, error } = await admin
    .from('apple_sign_in_tokens')
    .select(
      'user_id, client_id, apple_user_id, token_kind, token_value, email, email_is_private_relay, capture_source, last_captured_at, last_revoked_at, last_revocation_status, last_revocation_error'
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return {
    userId: String(data.user_id),
    clientId: String(data.client_id),
    appleUserId: typeof data.apple_user_id === 'string' ? data.apple_user_id : null,
    tokenKind: data.token_kind === 'access_token' ? 'access_token' : 'refresh_token',
    tokenValue: decryptStoredAppleToken(typeof data.token_value === 'string' ? data.token_value : null),
    email: typeof data.email === 'string' ? data.email : null,
    emailIsPrivateRelay: data.email_is_private_relay === true,
    captureSource:
      data.capture_source === 'web_provider_refresh' || data.capture_source === 'web_provider_access' ? data.capture_source : 'ios_native_code',
    lastCapturedAt: typeof data.last_captured_at === 'string' ? data.last_captured_at : new Date().toISOString(),
    lastRevokedAt: typeof data.last_revoked_at === 'string' ? data.last_revoked_at : null,
    lastRevocationStatus: typeof data.last_revocation_status === 'string' ? data.last_revocation_status : null,
    lastRevocationError: typeof data.last_revocation_error === 'string' ? data.last_revocation_error : null
  };
}

export async function recordAppleRevocationResult(
  admin: AdminClient,
  {
    userId,
    status,
    errorMessage,
    clearToken
  }: {
    userId: string;
    status: string;
    errorMessage?: string | null;
    clearToken?: boolean;
  }
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_revoked_at: now,
    last_revocation_status: status,
    last_revocation_error: errorMessage ?? null,
    updated_at: now
  };
  if (clearToken) {
    patch.token_value = null;
  }

  const { error } = await admin
    .from('apple_sign_in_tokens')
    .update(patch)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export async function deleteStoredAppleSignInToken(admin: AdminClient, userId: string) {
  const { error } = await admin.from('apple_sign_in_tokens').delete().eq('user_id', userId);
  if (error) {
    throw error;
  }
}

export async function userHasAppleIdentity(admin: AdminClient, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    throw error;
  }

  const user = data.user;
  const appMetadata = (user?.app_metadata || {}) as Record<string, unknown>;
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];

  if (String(appMetadata.provider || '').trim().toLowerCase() === 'apple') {
    return true;
  }

  if (providers.some((provider) => String(provider || '').trim().toLowerCase() === 'apple')) {
    return true;
  }

  return identities.some((identity) => String(identity?.provider || '').trim().toLowerCase() === 'apple');
}

export async function captureAppleSignInTokenForUser(
  admin: AdminClient,
  {
    userId,
    source,
    authorizationCode,
    providerToken,
    appleUserId,
    email,
    emailIsPrivateRelay
  }: {
    userId: string;
    source: AppleCaptureSource;
    authorizationCode?: string | null;
    providerToken?: string | null;
    appleUserId?: string | null;
    email?: string | null;
    emailIsPrivateRelay?: boolean;
  }
) {
  if (source === 'ios_native_code') {
    const normalizedCode = String(authorizationCode || '').trim();
    if (!normalizedCode) {
      throw new Error('Apple authorization code is required.');
    }

    if (!isAppleSignInServerConfigured()) {
      throw new Error('Apple Sign In server credentials are not configured.');
    }

    const clientId = getAppleMobileClientId();
    const exchanged = await exchangeAppleAuthorizationCode({
      authorizationCode: normalizedCode,
      clientId
    });
    const tokenKind: AppleTokenKind = exchanged.refreshToken ? 'refresh_token' : 'access_token';
    const tokenValue = exchanged.refreshToken || exchanged.accessToken;

    if (!tokenValue) {
      throw new Error('Apple token exchange did not return a revocable token.');
    }

    const storedAt = await upsertAppleSignInToken(admin, {
      userId,
      clientId,
      tokenKind,
      tokenValue,
      captureSource: source,
      appleUserId,
      email,
      emailIsPrivateRelay
    });

    return {
      tokenKind,
      storedAt
    };
  }

  const normalizedProviderToken = String(providerToken || '').trim();
  if (!normalizedProviderToken) {
    throw new Error('Apple provider token is required.');
  }

  const tokenKind: AppleTokenKind = source === 'web_provider_access' ? 'access_token' : 'refresh_token';
  const clientId = getAppleWebClientId();
  const storedAt = await upsertAppleSignInToken(admin, {
    userId,
    clientId,
    tokenKind,
    tokenValue: normalizedProviderToken,
    captureSource: source,
    appleUserId,
    email,
    emailIsPrivateRelay
  });

  return {
    tokenKind,
    storedAt
  };
}

export async function revokeStoredAppleSignInTokenForUser(admin: AdminClient, userId: string) {
  const storedToken = await getStoredAppleSignInToken(admin, userId);
  if (!storedToken?.tokenValue) {
    return {
      attempted: false as const,
      reason: 'no_stored_token' as const
    };
  }

  try {
    await revokeAppleToken({
      token: storedToken.tokenValue,
      clientId: storedToken.clientId
    });

    await recordAppleRevocationResult(admin, {
      userId,
      status: 'revoked',
      errorMessage: null,
      clearToken: true
    });

    return {
      attempted: true as const,
      success: true as const
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apple token revocation failed.';
    await recordAppleRevocationResult(admin, {
      userId,
      status: 'failed',
      errorMessage: message
    });

    return {
      attempted: true as const,
      success: false as const,
      error: message
    };
  }
}
