import { stripe, PRICE_PRO_MONTHLY } from '@/lib/api/stripe';
import { sanitizeReturnToPath } from '@/lib/billing/shared';
import { isStripeConfigured, isStripePriceConfigured, isSupabaseAdminConfigured, getSiteUrl } from '@/lib/server/env';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import {
  BillingApiRouteError,
  verifyAppleBillingClaim,
  verifyGoogleBillingClaim,
  type VerifiedBillingClaim
} from '@/lib/server/billingCore';
import {
  loadProviderCustomerUserId,
  mirrorStripeCustomerMapping,
  mirrorStripeEntitlement,
  upsertProviderEntitlement,
  type PurchaseProvider
} from '@/lib/server/providerEntitlements';
import { resolveStripePromotionCodeId } from '@/lib/server/billingStripe';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import { assertPasswordPolicy } from '@tminuszero/domain';
import {
  entitlementSchemaV1,
  premiumClaimAttachResponseSchemaV1,
  premiumClaimEnvelopeSchemaV1,
  premiumClaimPasswordSignUpResponseSchemaV1,
  premiumClaimSchemaV1
} from '@tminuszero/contracts';

type ClaimStatus = 'pending' | 'verified' | 'claimed';

type ClaimRow = {
  id: string;
  claim_token: string;
  user_id: string | null;
  provider: PurchaseProvider;
  product_key: 'premium_monthly';
  status: ClaimStatus;
  email: string | null;
  return_to: string;
  checkout_session_id: string | null;
  provider_event_id: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_product_id: string | null;
  provider_status: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  claimed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export class PremiumClaimRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'PremiumClaimRouteError';
    this.status = status;
    this.code = code;
  }
}

function getAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new PremiumClaimRouteError(501, 'supabase_service_role_missing');
  }
  return createSupabaseAdminClient();
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function asMetadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapClaimPayload(row: ClaimRow) {
  return premiumClaimSchemaV1.parse({
    claimToken: row.claim_token,
    provider: row.provider,
    productKey: row.product_key,
    status: row.status,
    email: normalizeEmail(row.email),
    returnTo: sanitizeReturnToPath(row.return_to, '/account'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

async function loadClaimByToken(claimToken: string) {
  const admin = getAdminClient();
  const { data, error } = await admin.from('premium_claims').select('*').eq('claim_token', claimToken).maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new PremiumClaimRouteError(404, 'claim_not_found');
  }
  return data as ClaimRow;
}

async function loadClaimByProviderEvent({
  provider,
  providerEventId
}: {
  provider: PurchaseProvider;
  providerEventId: string;
}) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('premium_claims')
    .select('*')
    .eq('provider', provider)
    .eq('provider_event_id', providerEventId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ClaimRow | null) ?? null;
}

async function updateClaim(rowId: string, payload: Record<string, unknown>) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('premium_claims')
    .update({
      ...payload,
      updated_at: new Date().toISOString()
    })
    .eq('id', rowId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as ClaimRow;
}

async function insertClaim(payload: Record<string, unknown>) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('premium_claims')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as ClaimRow;
}

async function upsertVerifiedClaim({
  verified,
  returnTo
}: {
  verified: VerifiedBillingClaim;
  returnTo?: string | null;
}) {
  const existing = await loadClaimByProviderEvent({
    provider: verified.provider,
    providerEventId: verified.providerEventId
  });

  const nextReturnTo = sanitizeReturnToPath(returnTo, existing?.return_to ?? '/account');
  const basePayload = {
    provider: verified.provider,
    product_key: 'premium_monthly',
    status: existing?.user_id ? ('claimed' as const) : ('verified' as const),
    email: normalizeEmail(verified.email),
    return_to: nextReturnTo,
    provider_event_id: verified.providerEventId,
    provider_customer_id: verified.providerCustomerId,
    provider_subscription_id: verified.providerSubscriptionId,
    provider_product_id: verified.providerProductId,
    provider_status: verified.status,
    cancel_at_period_end: verified.cancelAtPeriodEnd,
    current_period_end: verified.currentPeriodEnd,
    metadata: verified.metadata
  };

  if (existing) {
    return updateClaim(existing.id, basePayload);
  }

  return insertClaim(basePayload);
}

async function upsertProfileRow(userId: string, email: string) {
  const admin = getAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from('profiles').upsert(
    {
      user_id: userId,
      email,
      updated_at: now
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw error;
  }
}

async function assertProviderCustomerUnclaimed(provider: PurchaseProvider, providerCustomerId: string | null, userId: string) {
  if (!providerCustomerId) {
    return;
  }

  const admin = getAdminClient();
  const { userId: mappedUserId, loadError } = await loadProviderCustomerUserId(admin, {
    provider,
    providerCustomerId
  });

  if (loadError) {
    throw new PremiumClaimRouteError(500, loadError);
  }
  if (mappedUserId && mappedUserId !== userId) {
    throw new PremiumClaimRouteError(409, 'claim_already_claimed');
  }
}

async function materializeStripeClaim(row: ClaimRow, userId: string) {
  if (!row.provider_customer_id || !row.provider_subscription_id) {
    throw new PremiumClaimRouteError(409, 'claim_incomplete');
  }

  await assertProviderCustomerUnclaimed('stripe', row.provider_customer_id, userId);

  const admin = getAdminClient();
  const now = new Date().toISOString();
  const subscription = await stripe.subscriptions.retrieve(row.provider_subscription_id, { expand: ['items.data.price'] });
  const stripePriceId = subscription.items?.data?.[0]?.price?.id || PRICE_PRO_MONTHLY;
  const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;

  const { error: stripeCustomerError } = await admin
    .from('stripe_customers')
    .upsert({ user_id: userId, stripe_customer_id: row.provider_customer_id }, { onConflict: 'user_id' });
  if (stripeCustomerError) {
    throw stripeCustomerError;
  }

  await mirrorStripeCustomerMapping(admin, {
    userId,
    stripeCustomerId: row.provider_customer_id,
    metadata: {
      source: 'premium_claim'
    }
  });

  const { error: subscriptionError } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: stripePriceId,
      status: subscription.status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: now
    },
    { onConflict: 'user_id' }
  );
  if (subscriptionError) {
    throw subscriptionError;
  }

  await mirrorStripeEntitlement(admin, {
    userId,
    stripeCustomerId: row.provider_customer_id,
    subscription,
    eventType: 'claim_attach',
    providerEventId: row.provider_event_id ?? row.claim_token
  });
}

async function materializeStoreClaim(row: ClaimRow, userId: string) {
  await assertProviderCustomerUnclaimed(row.provider, row.provider_customer_id, userId);
  const admin = getAdminClient();
  await upsertProviderEntitlement(admin, {
    userId,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    providerProductId: row.provider_product_id ?? undefined,
    status: row.provider_status ?? 'active',
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
    source: 'provider_sync',
    metadata: asMetadata(row.metadata),
    eventType: 'claim_attach',
    providerEventId: row.provider_event_id ?? row.claim_token,
    strictMissingRelation: true
  });
}

async function claimToUserId(claimToken: string, userId: string) {
  const row = await loadClaimByToken(claimToken);

  if (row.user_id && row.user_id !== userId) {
    throw new PremiumClaimRouteError(409, 'claim_already_claimed');
  }
  if (row.status === 'pending') {
    throw new PremiumClaimRouteError(409, 'claim_pending');
  }

  if (row.provider === 'stripe') {
    await materializeStripeClaim(row, userId);
  } else {
    await materializeStoreClaim(row, userId);
  }

  return updateClaim(row.id, {
    user_id: userId,
    status: 'claimed',
    claimed_at: row.claimed_at ?? new Date().toISOString()
  });
}

function mapSupabaseSession(session: {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  expires_at?: number | null;
  user?: { id?: string | null; email?: string | null } | null;
}) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? null,
    expiresIn: typeof session.expires_in === 'number' ? session.expires_in : null,
    expiresAt:
      typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
    userId: session.user?.id ?? null,
    email: session.user?.email ?? null
  };
}

export async function createGuestPremiumCheckoutSession({
  returnTo,
  promotionCode
}: {
  returnTo?: string | null;
  promotionCode?: string | null;
} = {}) {
  if (!isStripeConfigured() || !isStripePriceConfigured() || PRICE_PRO_MONTHLY === 'price_placeholder') {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  const sanitizedReturnTo = sanitizeReturnToPath(returnTo, '/account');
  const stripePromotionCodeId = await resolveStripePromotionCodeId(promotionCode);
  const claim = await insertClaim({
    provider: 'stripe',
    product_key: 'premium_monthly',
    status: 'pending',
    return_to: sanitizedReturnTo
  });

  const claimToken = claim.claim_token;
  const claimQuery = new URLSearchParams({
    return_to: sanitizedReturnTo,
    claim_token: claimToken,
    checkout: 'success'
  }).toString();
  const cancelQuery = new URLSearchParams({
    return_to: sanitizedReturnTo,
    checkout: 'cancel'
  }).toString();
  const siteUrl = getSiteUrl();

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRICE_PRO_MONTHLY, quantity: 1 }],
      discounts: stripePromotionCodeId ? [{ promotion_code: stripePromotionCodeId }] : undefined,
      allow_promotion_codes: true,
      success_url: `${siteUrl}/upgrade?${claimQuery}`,
      cancel_url: `${siteUrl}/upgrade?${cancelQuery}`,
      metadata: {
        claim_token: claimToken,
        return_to: sanitizedReturnTo
      }
    });
  } catch (error) {
    console.error('guest billing checkout session create error', error);
    throw new BillingApiRouteError(502, 'checkout_failed');
  }

  if (!checkoutSession.url || !checkoutSession.id) {
    throw new BillingApiRouteError(500, 'stripe_session_missing_url');
  }

  await updateClaim(claim.id, {
    checkout_session_id: checkoutSession.id
  });

  return {
    url: checkoutSession.url
  };
}

export async function markStripePremiumClaimVerified(session: {
  id?: string | null;
  customer?: string | null;
  subscription?: string | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const claimToken = typeof session.metadata?.claim_token === 'string' ? session.metadata.claim_token : null;
  if (!claimToken) {
    return null;
  }

  const claim = await loadClaimByToken(claimToken);
  return updateClaim(claim.id, {
    status: claim.user_id ? 'claimed' : 'verified',
    checkout_session_id: typeof session.id === 'string' ? session.id : claim.checkout_session_id,
    provider_event_id: typeof session.id === 'string' ? session.id : claim.provider_event_id,
    provider_customer_id: typeof session.customer === 'string' ? session.customer : claim.provider_customer_id,
    provider_subscription_id: typeof session.subscription === 'string' ? session.subscription : claim.provider_subscription_id,
    provider_product_id: PRICE_PRO_MONTHLY,
    email: normalizeEmail(session.customer_details?.email ?? session.customer_email ?? claim.email),
    metadata: {
      ...asMetadata(claim.metadata),
      checkoutComplete: true
    }
  });
}

export async function createApplePremiumClaim(
  payload: Parameters<typeof verifyAppleBillingClaim>[0],
  options?: { returnTo?: string | null }
) {
  const claim = await upsertVerifiedClaim({
    verified: await verifyAppleBillingClaim(payload),
    returnTo: options?.returnTo
  });
  return premiumClaimEnvelopeSchemaV1.parse({
    claim: mapClaimPayload(claim)
  });
}

export async function createGooglePremiumClaim(
  payload: Parameters<typeof verifyGoogleBillingClaim>[0],
  options?: { returnTo?: string | null }
) {
  const claim = await upsertVerifiedClaim({
    verified: await verifyGoogleBillingClaim(payload),
    returnTo: options?.returnTo
  });
  return premiumClaimEnvelopeSchemaV1.parse({
    claim: mapClaimPayload(claim)
  });
}

export async function loadPremiumClaimEnvelope(claimToken: string) {
  const claim = await loadClaimByToken(claimToken);
  return premiumClaimEnvelopeSchemaV1.parse({
    claim: mapClaimPayload(claim)
  });
}

export async function attachPremiumClaim(session: ResolvedViewerSession, claimToken: string) {
  if (!session.userId) {
    throw new PremiumClaimRouteError(401, 'unauthorized');
  }

  const claim = await claimToUserId(claimToken, session.userId);
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: true });

  return premiumClaimAttachResponseSchemaV1.parse({
    ok: true,
    claim: mapClaimPayload(claim),
    returnTo: sanitizeReturnToPath(claim.return_to, '/account'),
    entitlements: entitlementSchemaV1.parse(entitlement)
  });
}

export async function createPremiumAccountFromClaim({
  claimToken,
  email,
  password
}: {
  claimToken: string;
  email: string;
  password: string;
}) {
  const claim = await loadClaimByToken(claimToken);
  if (claim.status === 'pending') {
    throw new PremiumClaimRouteError(409, 'claim_pending');
  }
  if (claim.user_id) {
    throw new PremiumClaimRouteError(409, 'claim_already_claimed');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new PremiumClaimRouteError(400, 'invalid_email');
  }
  if (claim.email && normalizeEmail(claim.email) !== normalizedEmail) {
    throw new PremiumClaimRouteError(409, 'claim_email_mismatch');
  }

  assertPasswordPolicy(password);

  const admin = getAdminClient();
  const { data: createdUserData, error: createUserError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true
  });

  if (createUserError || !createdUserData.user?.id) {
    const message = String(createUserError?.message || '').toLowerCase();
    if (message.includes('already') || message.includes('exists') || message.includes('registered')) {
      throw new PremiumClaimRouteError(409, 'account_exists');
    }
    throw createUserError ?? new PremiumClaimRouteError(500, 'failed_to_create_account');
  }

  await upsertProfileRow(createdUserData.user.id, normalizedEmail);
  const updatedClaim = await claimToUserId(claimToken, createdUserData.user.id);

  const publicClient = createSupabasePublicClient();
  const { data: authData, error: authError } = await publicClient.auth.signInWithPassword({
    email: normalizedEmail,
    password
  });

  if (authError || !authData.session) {
    throw authError ?? new PremiumClaimRouteError(500, 'failed_to_sign_in');
  }

  return premiumClaimPasswordSignUpResponseSchemaV1.parse({
    session: mapSupabaseSession(authData.session),
    claim: mapClaimPayload(updatedClaim),
    returnTo: sanitizeReturnToPath(updatedClaim.return_to, '/account')
  });
}
