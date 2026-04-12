import { getPremiumLegalVersions } from '@tminuszero/domain';
import {
  premiumLegalStatusSchemaV1,
  premiumOnboardingIntentResponseSchemaV1,
  premiumOnboardingProviderPreflightResponseSchemaV1,
  premiumOnboardingLegalAcceptanceResponseSchemaV1,
  type PremiumOnboardingPlatformV1,
  type PremiumOnboardingProviderV1,
  type PremiumLegalFlowV1
} from '@tminuszero/contracts';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { readPremiumClaimProviderCreateReservation } from '@/lib/server/premiumClaimProviderCreate';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

const PREMIUM_ONBOARDING_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const PREMIUM_PROVIDER_ALLOW_CREATE_TTL_MS = 15 * 60 * 1000;

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

type PremiumClaimProviderCreateRow = {
  id: string;
  status: 'pending' | 'verified' | 'claimed';
  user_id: string | null;
  email: string | null;
  metadata: Record<string, unknown> | null;
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

async function loadClaimForProviderCreate(admin: AdminClient, claimToken: string) {
  const { data, error } = await admin
    .from('premium_claims')
    .select('id, status, user_id, email, metadata')
    .eq('claim_token', claimToken)
    .maybeSingle();

  if (error) {
    console.error('premium onboarding claim lookup error', error);
    throw new PremiumOnboardingRouteError(500, 'failed_to_check_account_state');
  }

  return (data as PremiumClaimProviderCreateRow | null) ?? null;
}

async function authorizeClaimBackedProviderCreate(
  admin: AdminClient,
  {
    intentId,
    claimToken,
    provider,
    normalizedEmail
  }: {
    intentId?: string | null;
    claimToken?: string | null;
    provider: PremiumOnboardingProviderV1;
    normalizedEmail: string;
  }
) {
  const normalizedClaimToken = String(claimToken || '').trim();
  if (!normalizedClaimToken) {
    return null;
  }

  const claim = await loadClaimForProviderCreate(admin, normalizedClaimToken);
  if (!claim) {
    throw new PremiumOnboardingRouteError(404, 'claim_not_found', 'This Premium purchase could not be found.');
  }
  if (claim.status === 'pending') {
    throw new PremiumOnboardingRouteError(409, 'claim_pending', 'This Premium purchase is still being verified.');
  }
  if (claim.user_id || claim.status === 'claimed') {
    throw new PremiumOnboardingRouteError(
      409,
      'claim_already_claimed',
      'This Premium purchase is already linked to an account. Sign in to manage it.'
    );
  }

  const claimEmail = normalizeEmail(claim.email || '');
  if (claimEmail && claimEmail !== normalizedEmail) {
    throw new PremiumOnboardingRouteError(
      409,
      'claim_email_mismatch',
      'Use the same email address attached to this Premium purchase.'
    );
  }

  const reservation = readPremiumClaimProviderCreateReservation(claim.metadata);
  if (reservation && (reservation.provider !== provider || reservation.email !== normalizedEmail)) {
    throw new PremiumOnboardingRouteError(
      409,
      'claim_sign_in_required',
      'This Premium purchase already started account creation. Sign in with that account to finish claiming Premium.'
    );
  }

  const expiresAt = addDurationIso(PREMIUM_PROVIDER_ALLOW_CREATE_TTL_MS);
  const currentTimestamp = nowIso();
  const normalizedIntentId = String(intentId || '').trim() || null;

  const { error: deleteError } = await admin.from('premium_onboarding_allow_creates').delete().eq('claim_id', claim.id);
  if (deleteError) {
    console.error('premium onboarding allow-create cleanup error', deleteError);
    throw new PremiumOnboardingRouteError(500, 'failed_to_prepare_provider_create');
  }

  const { error: upsertError } = await admin.from('premium_onboarding_allow_creates').upsert(
    {
      onboarding_intent_id: normalizedIntentId,
      claim_id: claim.id,
      provider,
      email: normalizedEmail,
      email_normalized: normalizedEmail,
      used_at: null,
      expires_at: expiresAt,
      updated_at: currentTimestamp
    },
    {
      onConflict: 'provider,email_normalized'
    }
  );

  if (upsertError) {
    console.error('premium onboarding allow-create upsert error', upsertError);
    throw new PremiumOnboardingRouteError(500, 'failed_to_prepare_provider_create');
  }

  return expiresAt;
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
  claimToken,
  provider,
  email
}: {
  intentId?: string | null;
  claimToken?: string | null;
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

  const allowCreateExpiresAt = await authorizeClaimBackedProviderCreate(admin, {
    intentId,
    claimToken,
    provider,
    normalizedEmail
  });

  return premiumOnboardingProviderPreflightResponseSchemaV1.parse({
    provider,
    email: normalizedEmail,
    mode,
    createAllowed: Boolean(allowCreateExpiresAt),
    onboardingRequired: !allowCreateExpiresAt,
    allowCreateExpiresAt: allowCreateExpiresAt ?? null
  });
}

export async function createPremiumOnboardingEmailAccount({
  intentId: _intentId,
  email: _email,
  password: _password
}: {
  intentId: string;
  email: string;
  password: string;
}) {
  throw new PremiumOnboardingRouteError(
    410,
    'premium_account_creation_disabled',
    'Create an account only after Premium purchase verification.'
  );
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
