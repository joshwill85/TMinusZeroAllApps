import crypto from 'node:crypto';
import type { Session, User } from '@supabase/supabase-js';
import {
  mobileAuthChallengeCompleteSchemaV1,
  mobileAuthChallengeResultSchemaV1,
  mobileAuthPasswordRecoverSchemaV1,
  mobileAuthPasswordResendSchemaV1,
  mobileAuthPasswordSignInResponseSchemaV1,
  mobileAuthPasswordSignInSchemaV1,
  mobileAuthPasswordSignUpResponseSchemaV1,
  mobileAuthPasswordSignUpSchemaV1,
  mobileAuthRiskDecisionSchemaV1,
  mobileAuthRiskStartSchemaV1,
  successResponseSchemaV1,
  type MobileAuthFlowV1,
  type MobileAuthRiskStartV1,
  type MobileAuthSessionV1,
  type MobileAuthUserV1
} from '@tminuszero/contracts';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';

const MOBILE_AUTH_SESSION_TTL_MS = 5 * 60 * 1000;

type MobileAuthSettings = {
  enforcementMode: 'shadow' | 'enforce';
  forceVisibleTurnstile: boolean;
  disableAttestationIos: boolean;
  disableAttestationAndroid: boolean;
  allowNonprodBypass: boolean;
};

type RateLimitConfig = {
  ipLimit: number;
  windowSeconds: number;
  installationEmailLimit: number;
};

type StoredRiskSession = {
  id: string;
  flow: MobileAuthFlowV1;
  disposition: 'silent_turnstile' | 'visible_turnstile' | 'deny';
  usedAt: string | null;
};

type ChallengeCodePayload = {
  riskSessionId: string;
  captchaToken: string;
  exp: number;
};

type AttestationEvaluation = {
  provider: MobileAuthRiskStartV1['attestation']['provider'];
  status: 'dev_bypass' | 'provided' | 'missing';
  reasonCode: string | null;
};

export class MobileAuthRouteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message?: string, retryAfterSeconds: number | null = null) {
    super(message || code);
    this.name = 'MobileAuthRouteError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function parseBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function parseStringSetting(value: unknown, fallback: string) {
  const normalized = normalizeText(value);
  return normalized ?? fallback;
}

function isNonProductionBuild(buildProfile: string | null | undefined) {
  const normalized = String(buildProfile || '').trim().toLowerCase();
  return normalized !== 'preview' && normalized !== 'production';
}

function hasCaptchaProviderConfigured() {
  return Boolean(
    normalizeText(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) || normalizeText(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY)
  );
}

function base64UrlEncode(value: Buffer) {
  return value.toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url');
}

function getChallengeSecret() {
  const raw = normalizeText(process.env.MOBILE_AUTH_CHALLENGE_SECRET) || normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!raw) {
    throw new MobileAuthRouteError(500, 'challenge_secret_missing', 'Missing mobile auth challenge secret.');
  }
  return crypto.createHash('sha256').update(`tmz-mobile-auth:${raw}`).digest();
}

function sealChallengeCode(payload: ChallengeCodePayload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getChallengeSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${base64UrlEncode(iv)}.${base64UrlEncode(authTag)}.${base64UrlEncode(ciphertext)}`;
}

function openChallengeCode(code: string): ChallengeCodePayload {
  const parts = code.split('.');
  if (parts.length !== 3) {
    throw new MobileAuthRouteError(400, 'invalid_challenge_code', 'Mobile auth challenge code is malformed.');
  }

  try {
    const [ivPart, authTagPart, ciphertextPart] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getChallengeSecret(), base64UrlDecode(ivPart));
    decipher.setAuthTag(base64UrlDecode(authTagPart));
    const plaintext = Buffer.concat([decipher.update(base64UrlDecode(ciphertextPart)), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<ChallengeCodePayload>;
    if (
      typeof parsed.riskSessionId !== 'string' ||
      !parsed.riskSessionId ||
      typeof parsed.captchaToken !== 'string' ||
      !parsed.captchaToken ||
      typeof parsed.exp !== 'number'
    ) {
      throw new Error('invalid payload');
    }
    return {
      riskSessionId: parsed.riskSessionId,
      captchaToken: parsed.captchaToken,
      exp: parsed.exp
    };
  } catch {
    throw new MobileAuthRouteError(400, 'invalid_challenge_code', 'Mobile auth challenge code is invalid or expired.');
  }
}

function toNowIso() {
  return new Date().toISOString();
}

function getRateLimitConfig(flow: MobileAuthFlowV1): RateLimitConfig {
  if (flow === 'sign_in') {
    return { ipLimit: 15, windowSeconds: 300, installationEmailLimit: 6 };
  }
  if (flow === 'sign_up') {
    return { ipLimit: 10, windowSeconds: 1800, installationEmailLimit: 3 };
  }
  return { ipLimit: 6, windowSeconds: 3600, installationEmailLimit: 2 };
}

async function assertWithinRateLimits(request: Request, flow: MobileAuthFlowV1, emailHash: string, installationHash: string) {
  const config = getRateLimitConfig(flow);
  const ipLimited = await enforceDurableRateLimit(request, {
    scope: `mobile-auth:${flow}:ip`,
    limit: config.ipLimit,
    windowSeconds: config.windowSeconds
  });
  if (ipLimited) {
    throw new MobileAuthRouteError(
      429,
      'rate_limited',
      'Too many mobile auth attempts. Please try again later.',
      Number(ipLimited.headers.get('Retry-After') || '0') || null
    );
  }

  const installationLimited = await enforceDurableRateLimit(request, {
    scope: `mobile-auth:${flow}:installation-email`,
    limit: config.installationEmailLimit,
    windowSeconds: config.windowSeconds,
    clientId: `install:${installationHash}`,
    tokenKey: emailHash
  });
  if (installationLimited) {
    throw new MobileAuthRouteError(
      429,
      'rate_limited',
      'Too many mobile auth attempts on this device. Please try again later.',
      Number(installationLimited.headers.get('Retry-After') || '0') || null
    );
  }
}

async function loadMobileAuthSettings(): Promise<MobileAuthSettings> {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return {
      enforcementMode: 'shadow',
      forceVisibleTurnstile: false,
      disableAttestationIos: false,
      disableAttestationAndroid: false,
      allowNonprodBypass: true
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('system_settings')
    .select('key, value')
    .in('key', [
      'mobile_auth_enforcement_mode',
      'mobile_auth_force_visible_turnstile',
      'mobile_auth_disable_attestation_ios',
      'mobile_auth_disable_attestation_android',
      'mobile_auth_allow_nonprod_bypass'
    ]);

  if (error) {
    throw error;
  }

  const map = new Map<string, unknown>();
  for (const row of data || []) {
    map.set(String((row as { key?: unknown }).key || ''), (row as { value?: unknown }).value);
  }

  const enforcementMode = parseStringSetting(map.get('mobile_auth_enforcement_mode'), 'shadow') === 'enforce' ? 'enforce' : 'shadow';
  return {
    enforcementMode,
    forceVisibleTurnstile: parseBooleanSetting(map.get('mobile_auth_force_visible_turnstile'), false),
    disableAttestationIos: parseBooleanSetting(map.get('mobile_auth_disable_attestation_ios'), false),
    disableAttestationAndroid: parseBooleanSetting(map.get('mobile_auth_disable_attestation_android'), false),
    allowNonprodBypass: parseBooleanSetting(map.get('mobile_auth_allow_nonprod_bypass'), true)
  };
}

function evaluateAttestation(payload: MobileAuthRiskStartV1, settings: MobileAuthSettings): AttestationEvaluation {
  const provider = payload.attestation.provider;
  const nonProdBuild = isNonProductionBuild(payload.buildProfile);
  const attestationDisabled = payload.platform === 'ios' ? settings.disableAttestationIos : settings.disableAttestationAndroid;

  if (provider === 'dev_bypass' && nonProdBuild && settings.allowNonprodBypass) {
    return {
      provider,
      status: 'dev_bypass',
      reasonCode: null
    };
  }

  if (attestationDisabled) {
    return {
      provider,
      status: provider === 'none' ? 'missing' : 'provided',
      reasonCode: null
    };
  }

  if (!normalizeText(payload.attestation.token)) {
    return {
      provider,
      status: 'missing',
      reasonCode: provider === 'none' ? 'attestation_missing' : 'attestation_token_missing'
    };
  }

  return {
    provider,
    status: 'provided',
    reasonCode: null
  };
}

function resolveDisposition(payload: MobileAuthRiskStartV1, settings: MobileAuthSettings, attestation: AttestationEvaluation) {
  if (settings.forceVisibleTurnstile) {
    return {
      disposition: 'visible_turnstile' as const,
      reasonCode: 'force_visible_turnstile'
    };
  }

  if (attestation.status === 'dev_bypass') {
    return {
      disposition: 'silent_turnstile' as const,
      reasonCode: null
    };
  }

  if (settings.enforcementMode === 'enforce' && attestation.status === 'missing' && !isNonProductionBuild(payload.buildProfile)) {
    return {
      disposition: 'visible_turnstile' as const,
      reasonCode: attestation.reasonCode || 'attestation_required'
    };
  }

  return {
    disposition: 'silent_turnstile' as const,
    reasonCode: attestation.reasonCode
  };
}

function mapSupabaseSession(session: Session): MobileAuthSessionV1 {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? null,
    expiresIn: Number.isFinite(session.expires_in) ? Number(session.expires_in) : null,
    expiresAt:
      typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
    userId: typeof session.user?.id === 'string' ? session.user.id : null,
    email: typeof session.user?.email === 'string' ? session.user.email : null
  };
}

function mapSupabaseUser(user: User | null): MobileAuthUserV1 {
  return {
    userId: typeof user?.id === 'string' ? user.id : null,
    email: typeof user?.email === 'string' ? user.email : null
  };
}

function normalizeSupabaseErrorCode(error: { code?: string | null; message?: string | null }) {
  const explicit = normalizeText(error.code)?.toLowerCase();
  if (explicit) return explicit.replace(/\s+/g, '_');

  const message = normalizeText(error.message)?.toLowerCase() || '';
  if (message.includes('email not confirmed')) return 'email_not_confirmed';
  if (message.includes('invalid login credentials')) return 'invalid_credentials';
  if (message.includes('already registered') || message.includes('already exists')) return 'already_registered';
  if (message.includes('captcha')) return 'captcha_failed';
  if (message.includes('weak password')) return 'weak_password';
  return 'auth_failed';
}

function buildChallengeUrl(riskSessionId: string, disposition: 'silent_turnstile' | 'visible_turnstile') {
  const url = new URL('/mobile-auth/challenge', getSiteUrl());
  url.searchParams.set('risk_session', riskSessionId);
  url.searchParams.set('mode', disposition === 'visible_turnstile' ? 'visible' : 'silent');
  return url.toString();
}

async function recordRiskEvent(sessionId: string, eventType: string, detail: Record<string, unknown>) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return;
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('mobile_auth_risk_events').insert({
    session_id: sessionId,
    event_type: eventType,
    detail,
    created_at: toNowIso()
  });
  if (error) {
    console.error('mobile auth risk event failed', error);
  }
}

async function loadStoredRiskSession(riskSessionId: string): Promise<StoredRiskSession> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('mobile_auth_risk_sessions')
    .select('id, flow, disposition, used_at')
    .eq('id', riskSessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new MobileAuthRouteError(404, 'risk_session_not_found', 'Mobile auth risk session not found.');
  }

  const flow = normalizeText((data as { flow?: unknown }).flow);
  const disposition = normalizeText((data as { disposition?: unknown }).disposition);
  if (
    (flow !== 'sign_in' && flow !== 'sign_up' && flow !== 'resend' && flow !== 'recover') ||
    (disposition !== 'silent_turnstile' && disposition !== 'visible_turnstile' && disposition !== 'deny')
  ) {
    throw new MobileAuthRouteError(500, 'risk_session_invalid', 'Stored mobile auth risk session is invalid.');
  }

  return {
    id: String((data as { id?: unknown }).id || ''),
    flow,
    disposition,
    usedAt: normalizeText((data as { used_at?: unknown }).used_at)
  };
}

async function consumeChallengeCode(riskSessionId: string, flow: MobileAuthFlowV1, challengeCode: string) {
  const session = await loadStoredRiskSession(riskSessionId);
  if (session.flow !== flow) {
    throw new MobileAuthRouteError(409, 'risk_session_flow_mismatch', 'Mobile auth risk session flow mismatch.');
  }
  if (session.disposition === 'deny') {
    throw new MobileAuthRouteError(403, 'challenge_denied', 'Mobile auth challenge was denied.');
  }
  if (session.usedAt) {
    throw new MobileAuthRouteError(409, 'challenge_already_used', 'Mobile auth challenge has already been consumed.');
  }

  const parsed = openChallengeCode(challengeCode);
  if (parsed.riskSessionId !== riskSessionId) {
    throw new MobileAuthRouteError(400, 'challenge_session_mismatch', 'Mobile auth challenge does not match the requested session.');
  }
  if (parsed.exp < Date.now()) {
    throw new MobileAuthRouteError(400, 'challenge_expired', 'Mobile auth challenge expired. Start again.');
  }

  const admin = createSupabaseAdminClient();
  const now = toNowIso();
  const { data, error } = await admin
    .from('mobile_auth_risk_sessions')
    .update({
      used_at: now,
      updated_at: now
    })
    .eq('id', riskSessionId)
    .is('used_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileAuthRouteError(409, 'challenge_already_used', 'Mobile auth challenge has already been consumed.');
  }

  await recordRiskEvent(riskSessionId, 'challenge_consumed', {
    flow
  });

  return parsed.captchaToken;
}

async function finalizeRiskSession(
  riskSessionId: string,
  result: 'success' | 'failed',
  resultCode: string | null,
  userId: string | null = null
) {
  const admin = createSupabaseAdminClient();
  const now = toNowIso();
  const updates: {
    result: 'success' | 'failed';
    result_code: string | null;
    updated_at: string;
    user_id?: string;
  } = {
    result,
    result_code: resultCode,
    updated_at: now
  };
  if (userId) {
    updates.user_id = userId;
  }
  const { error } = await admin
    .from('mobile_auth_risk_sessions')
    .update(updates)
    .eq('id', riskSessionId);

  if (error) {
    console.error('mobile auth risk session finalize failed', error);
  }

  await recordRiskEvent(riskSessionId, result === 'success' ? 'auth_success' : 'auth_failed', {
    resultCode
  });
}

function assertMobileAuthConfigured() {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new MobileAuthRouteError(501, 'supabase_not_configured', 'Supabase auth is not configured.');
  }
  if (!hasCaptchaProviderConfigured()) {
    throw new MobileAuthRouteError(503, 'captcha_not_configured', 'A CAPTCHA provider site key is required for mobile auth.');
  }
}

export async function startMobileAuthRisk(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthRiskStartSchemaV1.parse(await request.json().catch(() => undefined));
  const normalizedEmail = normalizeEmail(parsedBody.email);
  const emailHash = hashValue(normalizedEmail);
  const installationHash = hashValue(parsedBody.installationId.trim());

  await assertWithinRateLimits(request, parsedBody.flow, emailHash, installationHash);

  const settings = await loadMobileAuthSettings();
  const attestation = evaluateAttestation(parsedBody, settings);
  const decision = resolveDisposition(parsedBody, settings, attestation);
  const now = toNowIso();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('mobile_auth_risk_sessions')
    .insert({
      flow: parsedBody.flow,
      platform: parsedBody.platform,
      email_hash: emailHash,
      installation_hash: installationHash,
      attestation_provider: attestation.provider,
      attestation_status: attestation.status,
      app_version: normalizeText(parsedBody.appVersion),
      build_profile: normalizeText(parsedBody.buildProfile),
      disposition: decision.disposition,
      reason_code: decision.reasonCode,
      created_at: now,
      updated_at: now
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  const riskSessionId = String((data as { id?: unknown }).id || '');
  await recordRiskEvent(riskSessionId, 'risk_started', {
    flow: parsedBody.flow,
    platform: parsedBody.platform,
    disposition: decision.disposition,
    attestationStatus: attestation.status,
    reasonCode: decision.reasonCode
  });

  return mobileAuthRiskDecisionSchemaV1.parse({
    riskSessionId,
    disposition: decision.disposition,
    challengeUrl: buildChallengeUrl(riskSessionId, decision.disposition),
    retryAfterSeconds: null,
    reasonCode: decision.reasonCode
  });
}

export async function completeMobileAuthChallenge(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthChallengeCompleteSchemaV1.parse(await request.json().catch(() => undefined));
  const session = await loadStoredRiskSession(parsedBody.riskSessionId);
  if (session.disposition === 'deny') {
    throw new MobileAuthRouteError(403, 'challenge_denied', 'Mobile auth challenge was denied.');
  }
  if (session.usedAt) {
    throw new MobileAuthRouteError(409, 'challenge_already_used', 'Mobile auth challenge has already been consumed.');
  }

  const challengeCode = sealChallengeCode({
    riskSessionId: parsedBody.riskSessionId,
    captchaToken: parsedBody.captchaToken,
    exp: Date.now() + MOBILE_AUTH_SESSION_TTL_MS
  });
  const now = toNowIso();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('mobile_auth_risk_sessions')
    .update({
      challenge_completed_at: now,
      challenge_expires_at: new Date(Date.now() + MOBILE_AUTH_SESSION_TTL_MS).toISOString(),
      updated_at: now
    })
    .eq('id', parsedBody.riskSessionId)
    .is('used_at', null);

  if (error) {
    throw error;
  }

  await recordRiskEvent(parsedBody.riskSessionId, 'challenge_completed', {
    disposition: session.disposition
  });

  return mobileAuthChallengeResultSchemaV1.parse({
    riskSessionId: parsedBody.riskSessionId,
    challengeCode
  });
}

export async function signInMobilePassword(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthPasswordSignInSchemaV1.parse(await request.json().catch(() => undefined));
  const captchaToken = await consumeChallengeCode(parsedBody.riskSessionId, 'sign_in', parsedBody.challengeCode);
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(parsedBody.email),
    password: parsedBody.password,
    options: {
      captchaToken
    }
  });

  if (error || !data.session) {
    const code = normalizeSupabaseErrorCode(error || {});
    await finalizeRiskSession(parsedBody.riskSessionId, 'failed', code);
    throw new MobileAuthRouteError(error?.status || 400, code, error?.message || 'Unable to sign in.');
  }

  await finalizeRiskSession(parsedBody.riskSessionId, 'success', 'ok', data.session.user.id);
  return mobileAuthPasswordSignInResponseSchemaV1.parse({
    session: mapSupabaseSession(data.session)
  });
}

export async function signUpMobilePassword(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthPasswordSignUpSchemaV1.parse(await request.json().catch(() => undefined));
  const captchaToken = await consumeChallengeCode(parsedBody.riskSessionId, 'sign_up', parsedBody.challengeCode);
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(parsedBody.email),
    password: parsedBody.password,
    options: {
      emailRedirectTo: parsedBody.emailRedirectTo,
      captchaToken
    }
  });

  if (error) {
    const code = normalizeSupabaseErrorCode(error);
    await finalizeRiskSession(parsedBody.riskSessionId, 'failed', code);
    throw new MobileAuthRouteError(error.status || 400, code, error.message || 'Unable to create the account.');
  }

  await finalizeRiskSession(
    parsedBody.riskSessionId,
    'success',
    data.session ? 'ok' : 'verification_required',
    data.user?.id ?? null
  );
  return mobileAuthPasswordSignUpResponseSchemaV1.parse({
    session: data.session ? mapSupabaseSession(data.session) : null,
    user: mapSupabaseUser(data.user ?? null),
    requiresVerification: !data.session
  });
}

export async function resendMobilePasswordVerification(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthPasswordResendSchemaV1.parse(await request.json().catch(() => undefined));
  const captchaToken = await consumeChallengeCode(parsedBody.riskSessionId, 'resend', parsedBody.challengeCode);
  const supabase = createSupabasePublicClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizeEmail(parsedBody.email),
    options: {
      emailRedirectTo: parsedBody.emailRedirectTo,
      captchaToken
    }
  });

  if (error) {
    const code = normalizeSupabaseErrorCode(error);
    await finalizeRiskSession(parsedBody.riskSessionId, 'failed', code);
    throw new MobileAuthRouteError(error.status || 400, code, error.message || 'Unable to resend verification email.');
  }

  await finalizeRiskSession(parsedBody.riskSessionId, 'success', 'ok');
  return successResponseSchemaV1.parse({ ok: true });
}

export async function recoverMobilePassword(request: Request) {
  assertMobileAuthConfigured();
  const parsedBody = mobileAuthPasswordRecoverSchemaV1.parse(await request.json().catch(() => undefined));
  const captchaToken = await consumeChallengeCode(parsedBody.riskSessionId, 'recover', parsedBody.challengeCode);
  const supabase = createSupabasePublicClient();
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(parsedBody.email), {
    redirectTo: parsedBody.redirectTo,
    captchaToken
  });

  if (error) {
    const code = normalizeSupabaseErrorCode(error);
    await finalizeRiskSession(parsedBody.riskSessionId, 'failed', code);
    throw new MobileAuthRouteError(error.status || 400, code, error.message || 'Unable to send reset email.');
  }

  await finalizeRiskSession(parsedBody.riskSessionId, 'success', 'ok');
  return successResponseSchemaV1.parse({ ok: true });
}
