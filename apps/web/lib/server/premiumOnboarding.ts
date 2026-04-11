import { assertPasswordPolicy, getPremiumLegalVersions } from '@tminuszero/domain';
import {
  premiumLegalStatusSchemaV1,
  premiumOnboardingEmailAccountCreateResponseSchemaV1,
  premiumOnboardingIntentResponseSchemaV1,
  premiumOnboardingProviderPreflightResponseSchemaV1,
  premiumOnboardingLegalAcceptanceResponseSchemaV1,
  type PremiumOnboardingPlatformV1,
  type PremiumOnboardingProviderV1,
  type PremiumLegalFlowV1
} from '@tminuszero/contracts';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabaseAuthClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

const PREMIUM_ONBOARDING_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const PREMIUM_ONBOARDING_ALLOW_CREATE_TTL_MS = 10 * 60 * 1000;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PremiumOnboardingIntentRow = {
  id: string;
  platform: PremiumOnboardingPlatformV1;
  return_to: string;
  viewer_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export class PremiumOnboardingRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.name = 'PremiumOnboardingRouteError';
    this.status = status;
    this.code = code;
  }
}

function assertPremiumOnboardingConfigured() {
  if (!isSupabaseConfigured()) {
    throw new PremiumOnboardingRouteError(501, 'supabase_not_configured');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new PremiumOnboardingRouteError(501, 'supabase_service_role_missing');
  }
}

function getAdminClient() {
  assertPremiumOnboardingConfigured();
  return createSupabaseAdminClient();
}

function nowIso() {
  return new Date().toISOString();
}

function addDurationIso(durationMs: number) {
  return new Date(Date.now() + durationMs).toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function defaultReturnTo(platform: PremiumOnboardingPlatformV1) {
  return platform === 'web' ? '/account' : '/profile';
}

function sanitizePremiumOnboardingReturnTo(platform: PremiumOnboardingPlatformV1, returnTo: string | null | undefined) {
  return sanitizeReturnToPath(returnTo, defaultReturnTo(platform));
}

function mapLegalStatus({
  termsAcceptedAt,
  privacyAcceptedAt,
  authenticated
}: {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  authenticated: boolean;
}) {
  const { termsVersion, privacyVersion } = getPremiumLegalVersions();
  return premiumLegalStatusSchemaV1.parse({
    termsVersion,
    privacyVersion,
    termsAcceptedAt,
    privacyAcceptedAt,
    requiresAcceptance: authenticated && (!termsAcceptedAt || !privacyAcceptedAt)
  });
}

async function loadLatestPremiumLegalStatus(admin: AdminClient, userId: string | null) {
  if (!userId) {
    return mapLegalStatus({
      termsAcceptedAt: null,
      privacyAcceptedAt: null,
      authenticated: false
    });
  }

  const { termsVersion, privacyVersion } = getPremiumLegalVersions();
  const { data, error } = await admin
    .from('legal_acceptances')
    .select('document_key, document_version, accepted_at')
    .eq('user_id', userId)
    .in('document_key', ['terms_of_service', 'privacy_notice'])
    .in('document_version', [termsVersion, privacyVersion]);

  if (error) {
    console.error('premium legal acceptance read error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_load_legal_status');
  }

  let termsAcceptedAt: string | null = null;
  let privacyAcceptedAt: string | null = null;

  for (const row of data || []) {
    const documentKey = String((row as { document_key?: unknown }).document_key || '').trim().toLowerCase();
    const documentVersion = String((row as { document_version?: unknown }).document_version || '').trim();
    const acceptedAt = typeof (row as { accepted_at?: unknown }).accepted_at === 'string' ? String((row as { accepted_at: string }).accepted_at) : null;
    if (documentKey === 'terms_of_service' && documentVersion === termsVersion) {
      termsAcceptedAt = acceptedAt;
    }
    if (documentKey === 'privacy_notice' && documentVersion === privacyVersion) {
      privacyAcceptedAt = acceptedAt;
    }
  }

  return mapLegalStatus({
    termsAcceptedAt,
    privacyAcceptedAt,
    authenticated: true
  });
}

async function loadPremiumOnboardingIntent(admin: AdminClient, intentId: string) {
  const { data, error } = await admin
    .from('premium_onboarding_intents')
    .select('id, platform, return_to, viewer_id, created_at, updated_at, expires_at')
    .eq('id', intentId)
    .maybeSingle();

  if (error) {
    console.error('premium onboarding intent lookup error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_load_onboarding_intent');
  }

  return (data as PremiumOnboardingIntentRow | null) ?? null;
}

async function ensurePremiumOnboardingIntent(admin: AdminClient, input: {
  intentId?: string | null;
  platform: PremiumOnboardingPlatformV1;
  returnTo: string | null | undefined;
  viewerId: string | null;
}) {
  const normalizedIntentId = String(input.intentId || '').trim();
  const normalizedReturnTo = sanitizePremiumOnboardingReturnTo(input.platform, input.returnTo);
  const currentTimestamp = nowIso();
  const nextExpiry = addDurationIso(PREMIUM_ONBOARDING_INTENT_TTL_MS);

  if (normalizedIntentId) {
    const existing = await loadPremiumOnboardingIntent(admin, normalizedIntentId);
    if (existing) {
      const isExpired = Date.parse(existing.expires_at) <= Date.now();
      if (!isExpired) {
        const patch = {
          platform: input.platform,
          return_to: normalizedReturnTo,
          viewer_id: input.viewerId ?? existing.viewer_id,
          updated_at: currentTimestamp,
          expires_at: nextExpiry
        };
        const { data, error } = await admin
          .from('premium_onboarding_intents')
          .update(patch)
          .eq('id', normalizedIntentId)
          .select('id, platform, return_to, viewer_id, created_at, updated_at, expires_at')
          .single();

        if (error) {
          console.error('premium onboarding intent update error', error);
          throw new PremiumOnboardingRouteError(500, 'failed_to_save_onboarding_intent');
        }

        return data as PremiumOnboardingIntentRow;
      }
    }
  }

  const { data, error } = await admin
    .from('premium_onboarding_intents')
    .insert({
      platform: input.platform,
      return_to: normalizedReturnTo,
      viewer_id: input.viewerId,
      created_at: currentTimestamp,
      updated_at: currentTimestamp,
      expires_at: nextExpiry
    })
    .select('id, platform, return_to, viewer_id, created_at, updated_at, expires_at')
    .single();

  if (error) {
    console.error('premium onboarding intent insert error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_save_onboarding_intent');
  }

  return data as PremiumOnboardingIntentRow;
}

function mapIntentResponse(row: PremiumOnboardingIntentRow) {
  return {
    intentId: row.id,
    platform: row.platform,
    returnTo: row.return_to,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

async function findExistingProfileByEmail(admin: AdminClient, email: string) {
  const { data, error } = await admin.from('profiles').select('user_id').eq('email', email).maybeSingle();
  if (error) {
    console.error('premium onboarding profile lookup error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_check_account_state');
  }
  return data?.user_id ? String(data.user_id) : null;
}

async function authorizePremiumOnboardingProviderCreate(admin: AdminClient, input: {
  intentId: string;
  provider: PremiumOnboardingProviderV1;
  email: string;
}) {
  const intent = await loadPremiumOnboardingIntent(admin, input.intentId);
  if (!intent) {
    throw new PremiumOnboardingRouteError(404, 'onboarding_intent_not_found');
  }
  if (Date.parse(intent.expires_at) <= Date.now()) {
    throw new PremiumOnboardingRouteError(409, 'onboarding_intent_expired');
  }

  const currentTimestamp = nowIso();
  const allowCreateExpiresAt = addDurationIso(PREMIUM_ONBOARDING_ALLOW_CREATE_TTL_MS);
  const normalizedEmail = normalizeEmail(input.email);
  const { error } = await admin.from('premium_onboarding_allow_creates').upsert(
    {
      onboarding_intent_id: intent.id,
      provider: input.provider,
      email: normalizedEmail,
      email_normalized: normalizedEmail,
      expires_at: allowCreateExpiresAt,
      used_at: null,
      updated_at: currentTimestamp
    },
    {
      onConflict: 'provider,email_normalized',
      ignoreDuplicates: false
    }
  );

  if (error) {
    console.error('premium onboarding allow-create upsert error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_authorize_provider_create');
  }

  return allowCreateExpiresAt;
}

async function upsertProfileRow(userId: string, email: string) {
  const admin = getAdminClient();
  const { error } = await admin.from('profiles').upsert(
    {
      user_id: userId,
      email,
      updated_at: nowIso()
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('premium onboarding profile upsert error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_upsert_profile');
  }
}

export async function createOrResumePremiumOnboardingIntent(
  session: ResolvedViewerSession,
  {
    intentId,
    platform,
    returnTo
  }: {
    intentId?: string | null;
    platform: PremiumOnboardingPlatformV1;
    returnTo?: string | null;
  }
) {
  const admin = getAdminClient();
  const intent = await ensurePremiumOnboardingIntent(admin, {
    intentId,
    platform,
    returnTo,
    viewerId: session.userId
  });
  const legal = await loadLatestPremiumLegalStatus(admin, session.userId);

  return premiumOnboardingIntentResponseSchemaV1.parse({
    intent: mapIntentResponse(intent),
    viewerId: session.userId,
    legal
  });
}

export async function preflightPremiumOnboardingProvider({
  intentId,
  provider,
  email
}: {
  intentId?: string | null;
  provider: PremiumOnboardingProviderV1;
  email: string;
}) {
  const admin = getAdminClient();
  const normalizedEmail = normalizeEmail(email);
  const existingUserId = await findExistingProfileByEmail(admin, normalizedEmail);
  const mode = existingUserId ? 'sign_in' : 'create';

  if (mode === 'sign_in') {
    return premiumOnboardingProviderPreflightResponseSchemaV1.parse({
      provider,
      email: normalizedEmail,
      mode,
      createAllowed: false,
      onboardingRequired: false,
      allowCreateExpiresAt: null
    });
  }

  const normalizedIntentId = String(intentId || '').trim();
  if (!normalizedIntentId) {
    return premiumOnboardingProviderPreflightResponseSchemaV1.parse({
      provider,
      email: normalizedEmail,
      mode,
      createAllowed: false,
      onboardingRequired: true,
      allowCreateExpiresAt: null
    });
  }

  const allowCreateExpiresAt = await authorizePremiumOnboardingProviderCreate(admin, {
    intentId: normalizedIntentId,
    provider,
    email: normalizedEmail
  });

  return premiumOnboardingProviderPreflightResponseSchemaV1.parse({
    provider,
    email: normalizedEmail,
    mode,
    createAllowed: true,
    onboardingRequired: false,
    allowCreateExpiresAt
  });
}

export async function createPremiumOnboardingEmailAccount({
  intentId,
  email,
  password
}: {
  intentId: string;
  email: string;
  password: string;
}) {
  const admin = getAdminClient();
  const intent = await loadPremiumOnboardingIntent(admin, intentId);
  if (!intent) {
    throw new PremiumOnboardingRouteError(404, 'onboarding_intent_not_found');
  }
  if (Date.parse(intent.expires_at) <= Date.now()) {
    throw new PremiumOnboardingRouteError(409, 'onboarding_intent_expired');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new PremiumOnboardingRouteError(400, 'invalid_email');
  }

  assertPasswordPolicy(password);

  const { data: createdUserData, error: createUserError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true
  });

  if (createUserError || !createdUserData.user?.id) {
    const message = String(createUserError?.message || '').toLowerCase();
    if (message.includes('already') || message.includes('exists') || message.includes('registered')) {
      throw new PremiumOnboardingRouteError(409, 'account_exists');
    }
    console.error('premium onboarding account create error', createUserError);
    throw new PremiumOnboardingRouteError(500, 'failed_to_create_account');
  }

  await upsertProfileRow(createdUserData.user.id, normalizedEmail);
  await admin
    .from('premium_onboarding_intents')
    .update({
      viewer_id: createdUserData.user.id,
      updated_at: nowIso()
    })
    .eq('id', intent.id);

  const publicClient = createSupabaseAuthClient();
  const { data: authData, error: authError } = await publicClient.auth.signInWithPassword({
    email: normalizedEmail,
    password
  });

  if (authError || !authData.session) {
    console.error('premium onboarding sign-in after account create error', authError);
    throw new PremiumOnboardingRouteError(500, 'failed_to_sign_in');
  }

  return premiumOnboardingEmailAccountCreateResponseSchemaV1.parse({
    session: {
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: typeof authData.session.expires_in === 'number' ? authData.session.expires_in : null,
      expiresAt: authData.session.expires_at ? new Date(authData.session.expires_at * 1000).toISOString() : null,
      userId: authData.session.user.id,
      email: authData.session.user.email ?? null
    },
    returnTo: intent.return_to
  });
}

export async function recordPremiumOnboardingLegalAcceptance(
  session: ResolvedViewerSession,
  {
    intentId,
    platform,
    flow,
    termsVersion,
    privacyVersion,
    returnTo
  }: {
    intentId?: string | null;
    platform: PremiumOnboardingPlatformV1;
    flow: PremiumLegalFlowV1;
    termsVersion: string;
    privacyVersion: string;
    returnTo?: string | null;
  }
) {
  if (!session.userId) {
    throw new PremiumOnboardingRouteError(401, 'auth_required');
  }

  const latestVersions = getPremiumLegalVersions();
  if (termsVersion !== latestVersions.termsVersion || privacyVersion !== latestVersions.privacyVersion) {
    throw new PremiumOnboardingRouteError(409, 'legal_version_mismatch');
  }

  const admin = getAdminClient();
  const acceptedAt = nowIso();
  const currentTimestamp = nowIso();
  const safeReturnTo = sanitizePremiumOnboardingReturnTo(platform, returnTo);

  const acceptanceRows = [
    {
      user_id: session.userId,
      document_key: 'terms_of_service',
      document_version: latestVersions.termsVersion,
      platform,
      flow,
      accepted_at: acceptedAt,
      metadata: { source: 'premium_onboarding' },
      created_at: currentTimestamp,
      updated_at: currentTimestamp
    },
    {
      user_id: session.userId,
      document_key: 'privacy_notice',
      document_version: latestVersions.privacyVersion,
      platform,
      flow,
      accepted_at: acceptedAt,
      metadata: { source: 'premium_onboarding' },
      created_at: currentTimestamp,
      updated_at: currentTimestamp
    }
  ];

  const { error } = await admin.from('legal_acceptances').upsert(acceptanceRows, {
    onConflict: 'user_id,document_key,document_version'
  });

  if (error) {
    console.error('premium legal acceptance upsert error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_record_legal_acceptance');
  }

  const normalizedIntentId = String(intentId || '').trim();
  if (normalizedIntentId) {
    await admin
      .from('premium_onboarding_intents')
      .update({
        viewer_id: session.userId,
        updated_at: currentTimestamp
      })
      .eq('id', normalizedIntentId);
  }

  const legal = await loadLatestPremiumLegalStatus(admin, session.userId);

  return premiumOnboardingLegalAcceptanceResponseSchemaV1.parse({
    ok: true,
    legal,
    returnTo: safeReturnTo
  });
}

export async function resolvePremiumOnboardingLegalStatus(session: ResolvedViewerSession) {
  const admin = getAdminClient();
  return loadLatestPremiumLegalStatus(admin, session.userId);
}
