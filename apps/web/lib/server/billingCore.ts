import fs from 'node:fs';
import path from 'node:path';
import {
  APIException,
  AppStoreServerAPIClient,
  Environment as AppStoreEnvironment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload
} from '@apple/app-store-server-library';
import { JWT, OAuth2Client } from 'google-auth-library';
import type {
  AppleBillingSyncRequestV1,
  BillingCatalogProductV1,
  BillingCatalogV1,
  BillingPlatformV1,
  BillingSummaryV1,
  BillingSyncResponseV1,
  EntitlementsV1
} from '@tminuszero/contracts';
import { PRICE_PRO_MONTHLY } from '@/lib/api/stripe';
import { normalizeSubscriptionStatus } from '@/lib/billing/shared';
import {
  getAppleAppStoreAppId,
  getGooglePlayNotificationAudience,
  getGooglePlayNotificationServiceAccountEmail,
  isAppleBillingConfigured,
  isAppleBillingNotificationsConfigured,
  isGoogleBillingConfigured,
  isGoogleBillingNotificationsConfigured,
  isStripeConfigured,
  isStripePriceConfigured,
  isSupabaseAdminConfigured,
  getSiteUrl
} from '@/lib/server/env';
import { getViewerEntitlement, type ViewerEntitlement } from '@/lib/server/entitlements';
import {
  loadProviderCustomerUserId,
  loadProviderEntitlement,
  upsertProviderEntitlement,
  type PurchaseProvider
} from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import type { GoogleBillingSyncRequestV1 } from '@tminuszero/contracts';

type BillingProductConfig = {
  productKey: 'premium_monthly';
  displayName: string;
  priceLabel: string;
  stripePriceId: string | null;
  appleProductId: string | null;
  googleProductId: string | null;
  googleBasePlanId: string | null;
  googleOfferToken: string | null;
};

type AppleTransactionInfo = {
  environment: 'sandbox' | 'production';
  payload: JWSTransactionDecodedPayload;
};

export type GoogleSubscriptionPurchaseV2 = {
  subscriptionState?: string;
  acknowledgementState?: string;
  latestOrderId?: string;
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: {
      autoRenewEnabled?: boolean;
    } | null;
    offerDetails?: {
      basePlanId?: string;
      offerId?: string;
    } | null;
  }>;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
  } | null;
};

export type GoogleDeveloperNotificationPayload = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  } | null;
  testNotification?: Record<string, unknown> | null;
};

export type BillingProviderNotificationResult = {
  outcome: 'processed' | 'ignored';
  reason?: string | null;
};

export type VerifiedAppleBillingNotification = {
  environment: 'sandbox' | 'production';
  notification: ResponseBodyV2DecodedPayload;
  providerEventId: string;
};

export class BillingApiRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'BillingApiRouteError';
    this.status = status;
    this.code = code;
  }
}

const APP_STORE_MANAGEMENT_URL = 'https://apps.apple.com/account/subscriptions';
const GOOGLE_PLAY_MANAGEMENT_URL = 'https://play.google.com/store/account/subscriptions';
const GOOGLE_ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const APPLE_ROOT_CERT_FILES = ['AppleRootCA-G2.cer', 'AppleRootCA-G3.cer'] as const;

let cachedAppleRootCertificates: Buffer[] | null = null;
const appleSignedDataVerifiers = new Map<AppStoreEnvironment, SignedDataVerifier>();
const appleApiClients = new Map<AppStoreEnvironment, AppStoreServerAPIClient>();
let googlePublisherJwtClient: JWT | null = null;
let googleNotificationAuthClient: OAuth2Client | null = null;

function getBillingProductConfig(): BillingProductConfig {
  return {
    productKey: 'premium_monthly',
    displayName: 'Premium Monthly',
    priceLabel: process.env.NEXT_PUBLIC_PREMIUM_PRICE_LABEL?.trim() || '$3.99/mo',
    stripePriceId: isStripePriceConfigured() ? PRICE_PRO_MONTHLY : null,
    appleProductId: normalizeConfigValue(process.env.APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID),
    googleProductId: normalizeConfigValue(process.env.GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID),
    googleBasePlanId: normalizeConfigValue(process.env.GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID),
    googleOfferToken: normalizeConfigValue(process.env.GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN)
  };
}

function normalizeConfigValue(value: string | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function requireAuthenticatedSession(session: ResolvedViewerSession): asserts session is ResolvedViewerSession & { userId: string } {
  if (!session.userId) {
    throw new BillingApiRouteError(401, 'unauthorized');
  }
}

function providerFromEntitlement(entitlement: ViewerEntitlement, provider: PurchaseProvider | null): BillingSummaryV1['provider'] {
  if (provider) {
    return provider;
  }

  if (entitlement.source === 'stripe' || entitlement.source === 'stripe_reconcile') {
    return 'stripe';
  }
  if (entitlement.source === 'apple') {
    return 'apple_app_store';
  }
  if (entitlement.source === 'google') {
    return 'google_play';
  }
  return 'none';
}

function buildProviderMessage(provider: BillingSummaryV1['provider']) {
  if (provider === 'apple_app_store') {
    return 'Purchased in the App Store. Manage or restore this subscription through Apple.';
  }
  if (provider === 'google_play') {
    return 'Purchased in Google Play. Manage or restore this subscription through Google Play.';
  }
  return null;
}

function buildManagementMode(provider: BillingSummaryV1['provider'], status: string): BillingSummaryV1['managementMode'] {
  const normalized = normalizeSubscriptionStatus(status);
  if (provider === 'stripe' && normalized !== 'none' && normalized !== 'stub') {
    return 'stripe_portal';
  }
  if (provider === 'apple_app_store') {
    return 'app_store_external';
  }
  if (provider === 'google_play') {
    return 'google_play_external';
  }
  return 'none';
}

function buildManagementUrl(mode: BillingSummaryV1['managementMode']) {
  if (mode === 'stripe_portal') return `${getSiteUrl()}/account`;
  if (mode === 'app_store_external') return APP_STORE_MANAGEMENT_URL;
  if (mode === 'google_play_external') return GOOGLE_PLAY_MANAGEMENT_URL;
  return null;
}

function serializeViewerEntitlement(entitlement: ViewerEntitlement): EntitlementsV1 {
  return {
    tier: entitlement.tier,
    status: entitlement.status,
    source: entitlement.source,
    isPaid: entitlement.isPaid,
    isAdmin: entitlement.isAdmin,
    isAuthed: entitlement.isAuthed,
    mode: entitlement.mode,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    stripePriceId: entitlement.stripePriceId,
    reconciled: entitlement.reconciled,
    reconcileThrottled: entitlement.reconcileThrottled
  };
}

function buildBillingSummary({
  entitlement,
  provider,
  providerProductId
}: {
  entitlement: ViewerEntitlement;
  provider: PurchaseProvider | null;
  providerProductId?: string | null;
}): BillingSummaryV1 {
  const resolvedProvider = providerFromEntitlement(entitlement, provider);
  const status = normalizeSubscriptionStatus(entitlement.status) || 'none';
  const managementMode = buildManagementMode(resolvedProvider, status);
  const hasProduct = resolvedProvider !== 'none' || (status !== 'none' && status !== 'guest' && status !== 'stub');

  return {
    provider: resolvedProvider,
    productKey: hasProduct ? 'premium_monthly' : null,
    status,
    isPaid: entitlement.isPaid,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    managementMode,
    managementUrl: buildManagementUrl(managementMode),
    providerMessage: buildProviderMessage(resolvedProvider),
    providerProductId: providerProductId ?? (resolvedProvider === 'stripe' ? entitlement.stripePriceId : null)
  };
}

async function loadProviderRecord(userId: string) {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { entitlement } = await loadProviderEntitlement(admin, userId);
  return entitlement;
}

function buildCatalogProduct(platform: BillingPlatformV1, config: BillingProductConfig): BillingCatalogProductV1 {
  if (platform === 'web') {
    return {
      productKey: config.productKey,
      platform,
      provider: 'stripe',
      available: Boolean(isStripeConfigured() && config.stripePriceId),
      displayName: config.displayName,
      priceLabel: config.priceLabel,
      providerProductId: config.stripePriceId,
      stripePriceId: config.stripePriceId
    };
  }

  if (platform === 'ios') {
    return {
      productKey: config.productKey,
      platform,
      provider: 'apple_app_store',
      available: Boolean(isAppleBillingConfigured() && config.appleProductId),
      displayName: config.displayName,
      priceLabel: config.priceLabel,
      providerProductId: config.appleProductId
    };
  }

  return {
    productKey: config.productKey,
    platform,
    provider: 'google_play',
    available: Boolean(isGoogleBillingConfigured() && config.googleProductId),
    displayName: config.displayName,
    priceLabel: config.priceLabel,
    providerProductId: config.googleProductId,
    googleBasePlanId: config.googleBasePlanId,
    googleOfferToken: config.googleOfferToken
  };
}

function buildNotificationEventType(notificationType: string | number | null | undefined, subtype?: string | null) {
  const normalizedType = String(notificationType || '')
    .trim()
    .toLowerCase();
  const normalizedSubtype = String(subtype || '')
    .trim()
    .toLowerCase();

  if (!normalizedType) {
    return 'provider_notification';
  }

  return normalizedSubtype ? `${normalizedType}.${normalizedSubtype}` : normalizedType;
}

async function resolveMappedUserId(
  provider: PurchaseProvider,
  providerCustomerId: string | null
) {
  if (!providerCustomerId) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const { userId, loadError } = await loadProviderCustomerUserId(admin, {
    provider,
    providerCustomerId
  });

  if (loadError) {
    throw new BillingApiRouteError(500, loadError);
  }

  return userId;
}

async function persistAppleEntitlement({
  userId,
  transaction,
  fallbackTransactionId,
  source,
  eventType,
  providerEventId
}: {
  userId: string;
  transaction: AppleTransactionInfo;
  fallbackTransactionId: string;
  source: string;
  eventType: string;
  providerEventId: string;
}) {
  const config = getBillingProductConfig();
  const transactionProductId = readString(transaction.payload.productId);
  if (!config.appleProductId || !transactionProductId || transactionProductId !== config.appleProductId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const originalTransactionId = readString(transaction.payload.originalTransactionId) ?? fallbackTransactionId;
  const transactionId = readString(transaction.payload.transactionId) ?? fallbackTransactionId;
  const currentPeriodEnd = parseAppleTimestamp(transaction.payload.expiresDate);
  const revocationAt = parseAppleTimestamp(transaction.payload.revocationDate);
  const status = resolveAppleStatus({
    currentPeriodEnd,
    revocationAt
  });

  const admin = createSupabaseAdminClient();
  await upsertProviderEntitlement(admin, {
    userId,
    provider: 'apple_app_store',
    providerCustomerId: originalTransactionId,
    providerSubscriptionId: originalTransactionId,
    providerProductId: transactionProductId,
    status,
    isActive: status === 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd,
    source,
    metadata: {
      transactionId,
      originalTransactionId,
      environment: transaction.environment,
      type: readString(transaction.payload.type)
    },
    eventType,
    providerEventId,
    eventPayload: {
      environment: transaction.environment,
      current_period_end: currentPeriodEnd,
      revocation_at: revocationAt
    },
    strictMissingRelation: true
  });
}

async function persistGoogleEntitlement({
  userId,
  purchase,
  packageName,
  purchaseToken,
  fallbackBasePlanId,
  source,
  eventType,
  providerEventId
}: {
  userId: string;
  purchase: GoogleSubscriptionPurchaseV2;
  packageName: string;
  purchaseToken: string;
  fallbackBasePlanId?: string | null;
  source: string;
  eventType: string;
  providerEventId: string;
}) {
  const config = getBillingProductConfig();
  const lineItem = pickGoogleLineItem(purchase.lineItems);
  const lineItemProductId = lineItem?.productId ?? null;
  if (!config.googleProductId || !lineItemProductId || lineItemProductId !== config.googleProductId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const currentPeriodEnd = normalizeIsoTimestamp(lineItem?.expiryTime);
  const status = resolveGoogleStatus(purchase.subscriptionState, currentPeriodEnd);
  const cancelAtPeriodEnd = Boolean(lineItem?.autoRenewingPlan && lineItem.autoRenewingPlan.autoRenewEnabled === false);
  const obfuscatedAccountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;

  if (purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    try {
      await acknowledgeGoogleSubscription({
        packageName,
        productId: lineItemProductId,
        purchaseToken
      });
    } catch (error) {
      console.error('google billing acknowledge warning', error);
    }
  }

  const admin = createSupabaseAdminClient();
  await upsertProviderEntitlement(admin, {
    userId,
    provider: 'google_play',
    providerCustomerId: obfuscatedAccountId,
    providerSubscriptionId: purchase.latestOrderId ?? purchaseToken,
    providerProductId: lineItemProductId,
    status,
    isActive: isGoogleAccessActive(purchase.subscriptionState, currentPeriodEnd),
    cancelAtPeriodEnd,
    currentPeriodEnd,
    source,
    metadata: {
      purchaseToken,
      packageName,
      basePlanId: lineItem?.offerDetails?.basePlanId ?? fallbackBasePlanId ?? null,
      offerId: lineItem?.offerDetails?.offerId ?? null
    },
    eventType,
    providerEventId,
    eventPayload: {
      subscription_state: purchase.subscriptionState ?? null,
      acknowledgement_state: purchase.acknowledgementState ?? null,
      current_period_end: currentPeriodEnd
    },
    strictMissingRelation: true
  });
}

export async function loadBillingSummary(session: ResolvedViewerSession, request?: Request): Promise<BillingSummaryV1 | null> {
  requireAuthenticatedSession(session);
  const { entitlement } = await getViewerEntitlement({
    request,
    session,
    reconcileStripe: false
  });
  const providerRecord = session.userId ? await loadProviderRecord(session.userId) : null;

  return buildBillingSummary({
    entitlement,
    provider: providerRecord?.provider ?? null,
    providerProductId: providerRecord?.productId ?? null
  });
}

export function loadBillingCatalog(session: ResolvedViewerSession, platform: BillingPlatformV1): BillingCatalogV1 | null {
  requireAuthenticatedSession(session);
  const config = getBillingProductConfig();
  return {
    platform,
    generatedAt: new Date().toISOString(),
    products: [buildCatalogProduct(platform, config)]
  };
}

export async function syncAppleBilling(
  session: ResolvedViewerSession,
  payload: AppleBillingSyncRequestV1,
  request?: Request
): Promise<BillingSyncResponseV1 | null> {
  requireAuthenticatedSession(session);
  if (!isAppleBillingConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  if (payload.appAccountToken && payload.appAccountToken !== session.userId) {
    throw new BillingApiRouteError(403, 'billing_account_mismatch');
  }

  const config = getBillingProductConfig();
  if (!config.appleProductId || payload.productId !== config.appleProductId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const transaction = await fetchAppleTransaction(payload.transactionId, payload.environment);
  const transactionProductId = readString(transaction.payload.productId);
  if (!transactionProductId || transactionProductId !== config.appleProductId || transactionProductId !== payload.productId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const appAccountToken = readString(transaction.payload.appAccountToken);
  if (appAccountToken && appAccountToken !== session.userId) {
    throw new BillingApiRouteError(403, 'billing_account_mismatch');
  }

  await persistAppleEntitlement({
    userId: session.userId,
    transaction,
    fallbackTransactionId: payload.originalTransactionId ?? payload.transactionId,
    source: 'provider_sync',
    eventType: 'client_sync',
    providerEventId: readString(transaction.payload.transactionId) ?? payload.transactionId
  });

  return buildBillingSyncResponse(session, request);
}

export async function syncGoogleBilling(
  session: ResolvedViewerSession,
  payload: GoogleBillingSyncRequestV1,
  request?: Request
): Promise<BillingSyncResponseV1 | null> {
  requireAuthenticatedSession(session);
  if (!isGoogleBillingConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  const config = getBillingProductConfig();
  if (!config.googleProductId || payload.productId !== config.googleProductId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const packageName = normalizeConfigValue(payload.packageName) ?? normalizeConfigValue(process.env.GOOGLE_PLAY_PACKAGE_NAME);
  if (!packageName) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  const purchase = await fetchGoogleSubscriptionPurchase(packageName, payload.purchaseToken);
  const lineItem = pickGoogleLineItem(purchase.lineItems);
  const lineItemProductId = lineItem?.productId ?? null;
  if (!lineItemProductId || lineItemProductId !== config.googleProductId || lineItemProductId !== payload.productId) {
    throw new BillingApiRouteError(400, 'invalid_product');
  }

  const obfuscatedAccountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
  if (payload.obfuscatedAccountId && payload.obfuscatedAccountId !== session.userId) {
    throw new BillingApiRouteError(403, 'billing_account_mismatch');
  }
  if (payload.obfuscatedAccountId && obfuscatedAccountId && payload.obfuscatedAccountId !== obfuscatedAccountId) {
    throw new BillingApiRouteError(403, 'billing_account_mismatch');
  }
  if (obfuscatedAccountId && obfuscatedAccountId !== session.userId) {
    throw new BillingApiRouteError(403, 'billing_account_mismatch');
  }

  await persistGoogleEntitlement({
    userId: session.userId,
    purchase,
    packageName,
    purchaseToken: payload.purchaseToken,
    fallbackBasePlanId: payload.basePlanId,
    source: 'provider_sync',
    eventType: 'client_sync',
    providerEventId: payload.purchaseToken
  });

  return buildBillingSyncResponse(session, request);
}

export async function processAppleBillingNotification({
  environment,
  notification,
  providerEventId
}: {
  environment: 'sandbox' | 'production';
  notification: ResponseBodyV2DecodedPayload;
  providerEventId: string;
}): Promise<BillingProviderNotificationResult> {
  if (!isAppleBillingNotificationsConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  const notificationType = readString(notification.notificationType);
  if (notificationType === 'TEST') {
    return {
      outcome: 'ignored',
      reason: 'test_notification'
    };
  }

  const signedTransactionInfo = readString(notification.data?.signedTransactionInfo);
  if (!signedTransactionInfo) {
    return {
      outcome: 'ignored',
      reason: 'missing_transaction_info'
    };
  }

  const transaction = await decodeAppleSignedTransactionInfo(signedTransactionInfo, environment);
  const transactionId = readString(transaction.payload.transactionId);
  if (!transactionId) {
    return {
      outcome: 'ignored',
      reason: 'missing_transaction_id'
    };
  }

  const originalTransactionId = readString(transaction.payload.originalTransactionId) ?? transactionId;
  const userId = await resolveMappedUserId('apple_app_store', originalTransactionId);
  if (!userId) {
    return {
      outcome: 'ignored',
      reason: 'user_not_mapped'
    };
  }

  try {
    await persistAppleEntitlement({
      userId,
      transaction,
      fallbackTransactionId: originalTransactionId,
      source: 'provider_notification',
      eventType: buildNotificationEventType(notificationType, readString(notification.subtype)),
      providerEventId
    });
  } catch (error) {
    if (error instanceof BillingApiRouteError && error.code === 'invalid_product') {
      return {
        outcome: 'ignored',
        reason: 'unsupported_product'
      };
    }
    throw error;
  }

  return {
    outcome: 'processed'
  };
}

export async function processGoogleBillingNotification({
  notification,
  providerEventId
}: {
  notification: GoogleDeveloperNotificationPayload;
  providerEventId: string;
}): Promise<BillingProviderNotificationResult> {
  if (!isGoogleBillingConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  if (notification.testNotification) {
    return {
      outcome: 'ignored',
      reason: 'test_notification'
    };
  }

  const subscriptionNotification = notification.subscriptionNotification;
  const purchaseToken = readString(subscriptionNotification?.purchaseToken);
  const subscriptionId = readString(subscriptionNotification?.subscriptionId);
  const packageName = normalizeConfigValue(notification.packageName) ?? normalizeConfigValue(process.env.GOOGLE_PLAY_PACKAGE_NAME);

  if (!purchaseToken || !subscriptionId || !packageName) {
    return {
      outcome: 'ignored',
      reason: 'missing_subscription_payload'
    };
  }

  const purchase = await fetchGoogleSubscriptionPurchase(packageName, purchaseToken);
  const lineItem = pickGoogleLineItem(purchase.lineItems);
  const productId = lineItem?.productId ?? null;
  if (!productId || productId !== subscriptionId) {
    return {
      outcome: 'ignored',
      reason: 'invalid_product'
    };
  }

  const obfuscatedAccountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
  const userId = await resolveMappedUserId('google_play', obfuscatedAccountId);
  if (!userId) {
    return {
      outcome: 'ignored',
      reason: 'user_not_mapped'
    };
  }

  try {
    await persistGoogleEntitlement({
      userId,
      purchase,
      packageName,
      purchaseToken,
      fallbackBasePlanId: lineItem?.offerDetails?.basePlanId ?? null,
      source: 'provider_notification',
      eventType: buildNotificationEventType(subscriptionNotification?.notificationType),
      providerEventId
    });
  } catch (error) {
    if (error instanceof BillingApiRouteError && error.code === 'invalid_product') {
      return {
        outcome: 'ignored',
        reason: 'unsupported_product'
      };
    }
    throw error;
  }

  return {
    outcome: 'processed'
  };
}

async function buildBillingSyncResponse(session: ResolvedViewerSession, request?: Request): Promise<BillingSyncResponseV1> {
  const [summary, entitlementResult] = await Promise.all([
    loadBillingSummary(session, request),
    getViewerEntitlement({
      request,
      session,
      reconcileStripe: true
    })
  ]);

  return {
    summary: summary ?? buildBillingSummary({ entitlement: entitlementResult.entitlement, provider: null }),
    entitlements: serializeViewerEntitlement(entitlementResult.entitlement)
  };
}

function parseAppleTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric).toISOString();
    }
    return normalizeIsoTimestamp(value);
  }

  return null;
}

function resolveAppleStatus({
  currentPeriodEnd,
  revocationAt
}: {
  currentPeriodEnd: string | null;
  revocationAt: string | null;
}) {
  if (revocationAt) return 'revoked';
  if (!currentPeriodEnd) return 'active';
  return Date.parse(currentPeriodEnd) > Date.now() ? 'active' : 'expired';
}

function normalizeIsoTimestamp(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMultilineSecret(value: string | undefined) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .trim();
}

function getAppleEnvironmentName(environment: AppStoreEnvironment): 'sandbox' | 'production' {
  return environment === AppStoreEnvironment.SANDBOX ? 'sandbox' : 'production';
}

function getAppleEnvironmentOrder(preferredEnvironment?: 'sandbox' | 'production') {
  if (preferredEnvironment === 'sandbox') {
    return [AppStoreEnvironment.SANDBOX, AppStoreEnvironment.PRODUCTION];
  }
  if (preferredEnvironment === 'production') {
    return [AppStoreEnvironment.PRODUCTION, AppStoreEnvironment.SANDBOX];
  }
  return [AppStoreEnvironment.PRODUCTION, AppStoreEnvironment.SANDBOX];
}

function resolveApplePkiDirectory() {
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/lib/server/apple-pki'),
    path.resolve(process.cwd(), 'lib/server/apple-pki')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new BillingApiRouteError(500, 'billing_not_configured');
}

function loadAppleRootCertificates() {
  if (cachedAppleRootCertificates) {
    return cachedAppleRootCertificates;
  }

  const directory = resolveApplePkiDirectory();
  cachedAppleRootCertificates = APPLE_ROOT_CERT_FILES.map((fileName) => {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      throw new BillingApiRouteError(500, 'billing_not_configured');
    }
    return fs.readFileSync(filePath);
  });
  return cachedAppleRootCertificates;
}

function getAppleApiConfig() {
  const issuerId = normalizeConfigValue(process.env.APPLE_APP_STORE_ISSUER_ID);
  const keyId = normalizeConfigValue(process.env.APPLE_APP_STORE_KEY_ID);
  const privateKey = normalizeMultilineSecret(process.env.APPLE_APP_STORE_PRIVATE_KEY);
  const bundleId = normalizeConfigValue(process.env.APPLE_APP_STORE_BUNDLE_ID);

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  return {
    issuerId,
    keyId,
    privateKey,
    bundleId
  };
}

function getAppleSignedDataVerifier(environment: AppStoreEnvironment) {
  const cachedVerifier = appleSignedDataVerifiers.get(environment);
  if (cachedVerifier) {
    return cachedVerifier;
  }

  const { bundleId } = getAppleApiConfig();
  const appAppleId = environment === AppStoreEnvironment.PRODUCTION ? getAppleAppStoreAppId() ?? undefined : undefined;
  const verifier = new SignedDataVerifier(
    loadAppleRootCertificates(),
    process.env.NODE_ENV === 'production',
    environment,
    bundleId,
    appAppleId
  );
  appleSignedDataVerifiers.set(environment, verifier);
  return verifier;
}

function getAppleApiClient(environment: AppStoreEnvironment) {
  const cachedClient = appleApiClients.get(environment);
  if (cachedClient) {
    return cachedClient;
  }

  const { issuerId, keyId, privateKey, bundleId } = getAppleApiConfig();
  const client = new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment);
  appleApiClients.set(environment, client);
  return client;
}

function mapAppleVerificationError(error: unknown): BillingApiRouteError {
  if (error instanceof BillingApiRouteError) {
    return error;
  }

  if (error instanceof APIException && (error.httpStatusCode === 400 || error.httpStatusCode === 404)) {
    return new BillingApiRouteError(error.httpStatusCode === 404 ? 404 : 400, 'apple_transaction_not_found');
  }

  console.error('apple billing verification error', error);
  return new BillingApiRouteError(502, 'apple_verification_failed');
}

function mapAppleNotificationVerificationError(error: unknown): BillingApiRouteError {
  if (error instanceof BillingApiRouteError) {
    return error;
  }

  if (error instanceof APIException) {
    return mapAppleVerificationError(error);
  }

  return new BillingApiRouteError(400, 'invalid_provider_payload');
}

async function decodeAppleSignedTransactionInfo(
  signedTransactionInfo: string,
  preferredEnvironment?: 'sandbox' | 'production'
): Promise<AppleTransactionInfo> {
  let lastError: unknown = null;

  for (const environment of getAppleEnvironmentOrder(preferredEnvironment)) {
    try {
      const payload = await getAppleSignedDataVerifier(environment).verifyAndDecodeTransaction(signedTransactionInfo);
      return {
        environment: getAppleEnvironmentName(environment),
        payload
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw mapAppleVerificationError(lastError);
}

async function fetchAppleTransaction(transactionId: string, preferredEnvironment?: 'sandbox' | 'production'): Promise<AppleTransactionInfo> {
  let lastError: unknown = null;

  for (const environment of getAppleEnvironmentOrder(preferredEnvironment)) {
    try {
      const response = await getAppleApiClient(environment).getTransactionInfo(transactionId);
      const signedTransactionInfo = readString(response.signedTransactionInfo);
      if (!signedTransactionInfo) {
        throw new BillingApiRouteError(502, 'apple_verification_failed');
      }

      const payload = await getAppleSignedDataVerifier(environment).verifyAndDecodeTransaction(signedTransactionInfo);
      return {
        environment: getAppleEnvironmentName(environment),
        payload
      };
    } catch (error) {
      lastError = error;
      if (error instanceof APIException && (error.httpStatusCode === 400 || error.httpStatusCode === 404)) {
        continue;
      }
    }
  }

  throw mapAppleVerificationError(lastError);
}

function getGooglePublisherJwtClient() {
  if (googlePublisherJwtClient) {
    return googlePublisherJwtClient;
  }

  const clientEmail = normalizeConfigValue(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL);
  const privateKey = normalizeMultilineSecret(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!clientEmail || !privateKey) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  googlePublisherJwtClient = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [GOOGLE_ANDROID_PUBLISHER_SCOPE]
  });
  return googlePublisherJwtClient;
}

function getGoogleNotificationAuthClient() {
  if (googleNotificationAuthClient) {
    return googleNotificationAuthClient;
  }

  googleNotificationAuthClient = new OAuth2Client();
  return googleNotificationAuthClient;
}

async function getGoogleAccessToken() {
  try {
    const credentials = await getGooglePublisherJwtClient().authorize();
    const accessToken = readString(credentials.access_token);
    if (!accessToken) {
      throw new Error('missing_access_token');
    }
    return accessToken;
  } catch (error) {
    console.error('google billing oauth error', error);
    throw new BillingApiRouteError(502, 'google_verification_failed');
  }
}

export async function verifyAppleBillingNotification(signedPayload: string): Promise<VerifiedAppleBillingNotification> {
  if (!isAppleBillingNotificationsConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  let lastError: unknown = null;
  for (const environment of [AppStoreEnvironment.PRODUCTION, AppStoreEnvironment.SANDBOX]) {
    try {
      const notification = await getAppleSignedDataVerifier(environment).verifyAndDecodeNotification(signedPayload);
      const providerEventId = readString(notification.notificationUUID);
      if (!providerEventId) {
        throw new BillingApiRouteError(400, 'invalid_provider_payload');
      }

      return {
        environment: getAppleEnvironmentName(environment),
        notification,
        providerEventId
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw mapAppleNotificationVerificationError(lastError);
}

export async function verifyGoogleBillingNotificationRequest(request: Request) {
  if (!isGoogleBillingNotificationsConfigured()) {
    throw new BillingApiRouteError(501, 'billing_not_configured');
  }

  const authorization = readString(request.headers.get('authorization'));
  const audience = getGooglePlayNotificationAudience();
  const expectedEmail = getGooglePlayNotificationServiceAccountEmail();
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ') || !audience || !expectedEmail) {
    throw new BillingApiRouteError(401, 'invalid_push_auth');
  }

  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new BillingApiRouteError(401, 'invalid_push_auth');
  }

  try {
    const ticket = await getGoogleNotificationAuthClient().verifyIdToken({
      idToken,
      audience
    });
    const payload = ticket.getPayload();
    const email = readString(payload?.email);
    if (!payload?.email_verified || !email || email.toLowerCase() !== expectedEmail.toLowerCase()) {
      throw new BillingApiRouteError(403, 'invalid_push_auth');
    }

    return {
      audience,
      email
    };
  } catch (error) {
    if (error instanceof BillingApiRouteError) {
      throw error;
    }

    console.error('google billing push auth verification error', error);
    throw new BillingApiRouteError(401, 'invalid_push_auth');
  }
}

async function fetchGoogleSubscriptionPurchase(packageName: string, purchaseToken: string): Promise<GoogleSubscriptionPurchaseV2> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      cache: 'no-store'
    }
  );

  const json = (await response.json().catch(() => null)) as GoogleSubscriptionPurchaseV2 | null;
  if (!response.ok || !json) {
    console.error('google subscription verification error', response.status, json);
    throw new BillingApiRouteError(response.status === 404 ? 404 : 502, 'google_verification_failed');
  }

  return json;
}

function pickGoogleLineItem(lineItems: GoogleSubscriptionPurchaseV2['lineItems']) {
  return Array.isArray(lineItems) && lineItems.length ? lineItems[0] : null;
}

function isGoogleAccessActive(subscriptionState: string | undefined, currentPeriodEnd: string | null) {
  const expiry = currentPeriodEnd ? Date.parse(currentPeriodEnd) : Number.NaN;
  if (Number.isFinite(expiry) && expiry <= Date.now()) {
    return false;
  }

  return (
    subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' ||
    subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
    subscriptionState === 'SUBSCRIPTION_STATE_CANCELED'
  );
}

function resolveGoogleStatus(subscriptionState: string | undefined, currentPeriodEnd: string | null) {
  if (subscriptionState === 'SUBSCRIPTION_STATE_EXPIRED') return 'expired';
  if (subscriptionState === 'SUBSCRIPTION_STATE_PENDING') return 'pending';
  if (subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD') return 'on_hold';
  if (subscriptionState === 'SUBSCRIPTION_STATE_PAUSED') return 'paused';
  if (subscriptionState === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED') return 'canceled';

  if (subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') {
    return isGoogleAccessActive(subscriptionState, currentPeriodEnd) ? 'canceled' : 'expired';
  }

  return isGoogleAccessActive(subscriptionState, currentPeriodEnd) ? 'active' : 'expired';
}

async function acknowledgeGoogleSubscription({
  packageName,
  productId,
  purchaseToken
}: {
  packageName: string;
  productId: string;
  purchaseToken: string;
}) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        developerPayload: 'tmz-native-billing-sync'
      }),
      cache: 'no-store'
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google acknowledge failed (${response.status}): ${text}`);
  }
}
