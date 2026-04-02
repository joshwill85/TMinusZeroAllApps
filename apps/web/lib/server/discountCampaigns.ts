import type { BillingCatalogOfferV1, BillingPlatformV1 } from '@tminuszero/contracts';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { type PurchaseProvider, loadProviderEntitlement } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSubscriptionActive } from '@/lib/server/subscription';

type QueryClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

export type DiscountCampaignKind = 'promo_code' | 'store_offer';
export type DiscountCampaignTargetingKind = 'all_users' | 'new_subscribers' | 'lapsed_subscribers' | 'specific_users';
export type DiscountCampaignStatus = 'draft' | 'active' | 'paused' | 'ended' | 'sync_error';
export type DiscountCampaignArtifactKind =
  | 'stripe_coupon'
  | 'stripe_promotion_code'
  | 'apple_offer_code'
  | 'apple_promotional_offer'
  | 'apple_win_back_offer'
  | 'google_offer'
  | 'google_promo_code';

type DiscountCampaignRow = {
  id: string;
  slug: string;
  name: string;
  product_key: string;
  campaign_kind: string;
  targeting_kind: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  display_copy: Record<string, unknown> | null;
  internal_notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DiscountCampaignArtifactRow = {
  id: string;
  campaign_id: string;
  provider: string;
  artifact_kind: string;
  status: string;
  external_id: string | null;
  external_code: string | null;
  payload: Record<string, unknown> | null;
  starts_at: string | null;
  ends_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DiscountCampaignTargetRow = {
  id: string;
  campaign_id: string;
  user_id: string | null;
  email: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DiscountCampaignEligibilitySignals = {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  hasEverSubscribed: boolean;
  hasActiveSubscription: boolean;
  hasLapsedSubscription: boolean;
};

export type DiscountCampaignDisplayCopy = {
  headline: string | null;
  body: string | null;
};

export type DiscountCampaignTarget = {
  id: string;
  campaignId: string;
  userId: string | null;
  email: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DiscountCampaignArtifact = {
  id: string;
  campaignId: string;
  provider: PurchaseProvider;
  artifactKind: DiscountCampaignArtifactKind;
  status: DiscountCampaignStatus;
  externalId: string | null;
  externalCode: string | null;
  payload: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DiscountCampaign = {
  id: string;
  slug: string;
  name: string;
  productKey: 'premium_monthly';
  campaignKind: DiscountCampaignKind;
  targetingKind: DiscountCampaignTargetingKind;
  status: DiscountCampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  displayCopy: DiscountCampaignDisplayCopy;
  internalNotes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  targets: DiscountCampaignTarget[];
  artifacts: DiscountCampaignArtifact[];
  targetCounts: {
    total: number;
    userTargets: number;
    emailTargets: number;
  };
};

const DISCOUNT_STATUSES = new Set<DiscountCampaignStatus>(['draft', 'active', 'paused', 'ended', 'sync_error']);
const CODE_BASED_ARTIFACTS = new Set<DiscountCampaignArtifactKind>([
  'stripe_promotion_code',
  'apple_offer_code',
  'google_promo_code'
]);

function isMissingRelationError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

function normalizeString(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeTimestamp(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeStatus(value: unknown): DiscountCampaignStatus {
  const normalized = normalizeString(value);
  if (normalized && DISCOUNT_STATUSES.has(normalized as DiscountCampaignStatus)) {
    return normalized as DiscountCampaignStatus;
  }
  return 'draft';
}

function normalizeDisplayCopy(value: Record<string, unknown> | null | undefined): DiscountCampaignDisplayCopy {
  return {
    headline: normalizeString(value?.headline),
    body: normalizeString(value?.body)
  };
}

function normalizeUrl(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

async function loadOptionalRows<T>(
  promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  label: string
) {
  const result = await promise;
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return [] as T[];
    }
    console.error(label, result.error);
    return [] as T[];
  }
  return result.data ?? [];
}

function mapArtifactProvider(value: string): PurchaseProvider {
  if (value === 'apple_app_store' || value === 'google_play') {
    return value;
  }
  return 'stripe';
}

function mapArtifactKind(value: string): DiscountCampaignArtifactKind {
  if (
    value === 'stripe_coupon' ||
    value === 'stripe_promotion_code' ||
    value === 'apple_offer_code' ||
    value === 'apple_promotional_offer' ||
    value === 'apple_win_back_offer' ||
    value === 'google_offer' ||
    value === 'google_promo_code'
  ) {
    return value;
  }
  return 'stripe_coupon';
}

function mapCampaignKind(value: string): DiscountCampaignKind {
  return value === 'store_offer' ? 'store_offer' : 'promo_code';
}

function mapTargetingKind(value: string): DiscountCampaignTargetingKind {
  if (value === 'new_subscribers' || value === 'lapsed_subscribers' || value === 'specific_users') {
    return value;
  }
  return 'all_users';
}

function mapTarget(row: DiscountCampaignTargetRow): DiscountCampaignTarget {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: normalizeString(row.user_id),
    email: normalizeEmail(row.email),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

function mapArtifact(row: DiscountCampaignArtifactRow): DiscountCampaignArtifact {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    provider: mapArtifactProvider(row.provider),
    artifactKind: mapArtifactKind(row.artifact_kind),
    status: normalizeStatus(row.status),
    externalId: normalizeString(row.external_id),
    externalCode: normalizeString(row.external_code),
    payload: row.payload ?? {},
    startsAt: normalizeTimestamp(row.starts_at),
    endsAt: normalizeTimestamp(row.ends_at),
    lastSyncedAt: normalizeTimestamp(row.last_synced_at),
    lastError: normalizeString(row.last_error),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

function mapCampaign(
  row: DiscountCampaignRow,
  artifacts: DiscountCampaignArtifact[],
  targets: DiscountCampaignTarget[]
): DiscountCampaign {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    productKey: 'premium_monthly',
    campaignKind: mapCampaignKind(row.campaign_kind),
    targetingKind: mapTargetingKind(row.targeting_kind),
    status: normalizeStatus(row.status),
    startsAt: normalizeTimestamp(row.starts_at),
    endsAt: normalizeTimestamp(row.ends_at),
    displayCopy: normalizeDisplayCopy(row.display_copy),
    internalNotes: normalizeString(row.internal_notes),
    createdBy: normalizeString(row.created_by),
    updatedBy: normalizeString(row.updated_by),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    artifacts,
    targets,
    targetCounts: {
      total: targets.length,
      userTargets: targets.filter((target) => Boolean(target.userId)).length,
      emailTargets: targets.filter((target) => Boolean(target.email)).length
    }
  };
}

function targetHint(targetingKind: DiscountCampaignTargetingKind) {
  switch (targetingKind) {
    case 'new_subscribers':
      return 'New subscribers';
    case 'lapsed_subscribers':
      return 'Lapsed subscribers';
    case 'specific_users':
      return 'Specific users';
    default:
      return 'All users';
  }
}

function providerForPlatform(platform: BillingPlatformV1): PurchaseProvider {
  if (platform === 'ios') return 'apple_app_store';
  if (platform === 'android') return 'google_play';
  return 'stripe';
}

function isWindowActive({
  status,
  startsAt,
  endsAt,
  now
}: {
  status: DiscountCampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  now: number;
}) {
  if (status !== 'active') {
    return false;
  }

  if (startsAt) {
    const startsAtTime = Date.parse(startsAt);
    if (Number.isFinite(startsAtTime) && startsAtTime > now) {
      return false;
    }
  }

  if (endsAt) {
    const endsAtTime = Date.parse(endsAt);
    if (Number.isFinite(endsAtTime) && endsAtTime < now) {
      return false;
    }
  }

  return true;
}

function buildCatalogOffer(campaign: DiscountCampaign, artifact: DiscountCampaignArtifact): BillingCatalogOfferV1 {
  return {
    offerKey: `${campaign.slug}:${artifact.provider}:${artifact.artifactKind}:${artifact.externalCode ?? artifact.externalId ?? artifact.id}`,
    provider: artifact.provider,
    artifactKind: artifact.artifactKind,
    label: normalizeString(artifact.payload.label) ?? campaign.displayCopy.headline ?? campaign.name,
    eligibilityHint: normalizeString(artifact.payload.eligibilityHint) ?? targetHint(campaign.targetingKind),
    startsAt: artifact.startsAt ?? campaign.startsAt,
    endsAt: artifact.endsAt ?? campaign.endsAt,
    isCodeBased: CODE_BASED_ARTIFACTS.has(artifact.artifactKind),
    offerIdentifier: normalizeString(artifact.payload.offerIdentifier) ?? (artifact.provider === 'apple_app_store' ? artifact.externalId : null),
    redemptionUrl: normalizeUrl(artifact.payload.redemptionUrl),
    basePlanId: normalizeString(artifact.payload.basePlanId),
    offerId: normalizeString(artifact.payload.offerId) ?? (artifact.provider === 'google_play' ? artifact.externalId : null),
    offerToken: normalizeString(artifact.payload.offerToken),
    promotionCode: normalizeString(artifact.payload.promotionCode) ?? (artifact.provider === 'stripe' ? artifact.externalCode : null)
  };
}

function campaignAppliesToViewer(campaign: DiscountCampaign, signals: DiscountCampaignEligibilitySignals) {
  switch (campaign.targetingKind) {
    case 'all_users':
      return true;
    case 'new_subscribers':
      return signals.isAuthenticated && !signals.hasEverSubscribed;
    case 'lapsed_subscribers':
      return signals.isAuthenticated && signals.hasLapsedSubscription;
    case 'specific_users':
      if (!signals.isAuthenticated) {
        return false;
      }
      return campaign.targets.some(
        (target) => target.userId === signals.userId || (target.email && signals.email && target.email === signals.email)
      );
    default:
      return false;
  }
}

async function loadEligibilitySignals(
  client: QueryClient,
  {
    userId,
    email
  }: {
    userId: string | null;
    email: string | null;
  }
): Promise<DiscountCampaignEligibilitySignals> {
  if (!userId) {
    return {
      isAuthenticated: false,
      userId: null,
      email: normalizeEmail(email),
      hasEverSubscribed: false,
      hasActiveSubscription: false,
      hasLapsedSubscription: false
    };
  }

  const [{ entitlement }, subscriptionRes] = await Promise.all([
    loadProviderEntitlement(client, userId),
    client.from('subscriptions').select('status').eq('user_id', userId).maybeSingle()
  ]);

  if (subscriptionRes.error && !isMissingRelationError(subscriptionRes.error)) {
    console.error('discount campaign subscription eligibility lookup error', subscriptionRes.error);
  }

  const subscription = subscriptionRes.data ?? null;
  const hasActiveSubscription = Boolean(entitlement?.isActive || isSubscriptionActive(subscription));
  const hasEverSubscribed = Boolean(entitlement || subscription);

  return {
    isAuthenticated: true,
    userId,
    email: normalizeEmail(email),
    hasEverSubscribed,
    hasActiveSubscription,
    hasLapsedSubscription: hasEverSubscribed && !hasActiveSubscription
  };
}

export async function loadDiscountCampaigns(
  admin?: QueryClient
): Promise<{ campaigns: DiscountCampaign[]; loadError: string | null }> {
  if (!admin && !isSupabaseAdminConfigured()) {
    return { campaigns: [], loadError: null };
  }

  const client = admin ?? createSupabaseAdminClient();
  const [campaignRows, artifactRows, targetRows] = await Promise.all([
    loadOptionalRows<DiscountCampaignRow>(
      client
        .from('discount_campaigns')
        .select('id,slug,name,product_key,campaign_kind,targeting_kind,status,starts_at,ends_at,display_copy,internal_notes,created_by,updated_by,created_at,updated_at')
        .order('created_at', { ascending: false }),
      'discount campaigns fetch error'
    ),
    loadOptionalRows<DiscountCampaignArtifactRow>(
      client
        .from('discount_campaign_provider_artifacts')
        .select('id,campaign_id,provider,artifact_kind,status,external_id,external_code,payload,starts_at,ends_at,last_synced_at,last_error,created_at,updated_at')
        .order('created_at', { ascending: false }),
      'discount campaign artifacts fetch error'
    ),
    loadOptionalRows<DiscountCampaignTargetRow>(
      client.from('discount_campaign_targets').select('id,campaign_id,user_id,email,created_at,updated_at').order('created_at', { ascending: false }),
      'discount campaign targets fetch error'
    )
  ]);

  const artifactMap = new Map<string, DiscountCampaignArtifact[]>();
  artifactRows.map(mapArtifact).forEach((artifact) => {
    const entries = artifactMap.get(artifact.campaignId) ?? [];
    entries.push(artifact);
    artifactMap.set(artifact.campaignId, entries);
  });

  const targetMap = new Map<string, DiscountCampaignTarget[]>();
  targetRows.map(mapTarget).forEach((target) => {
    const entries = targetMap.get(target.campaignId) ?? [];
    entries.push(target);
    targetMap.set(target.campaignId, entries);
  });

  return {
    campaigns: campaignRows.map((row) => mapCampaign(row, artifactMap.get(row.id) ?? [], targetMap.get(row.id) ?? [])),
    loadError: null
  };
}

export async function loadBillingCatalogOffers({
  platform,
  userId,
  email,
  admin
}: {
  platform: BillingPlatformV1;
  userId?: string | null;
  email?: string | null;
  admin?: QueryClient;
}): Promise<BillingCatalogOfferV1[]> {
  if (!admin && !isSupabaseAdminConfigured()) {
    return [];
  }

  const client = admin ?? createSupabaseAdminClient();
  const { campaigns } = await loadDiscountCampaigns(client);
  if (campaigns.length === 0) {
    return [];
  }

  const viewerSignals = await loadEligibilitySignals(client, {
    userId: normalizeString(userId),
    email: normalizeEmail(email)
  });
  const now = Date.now();
  const provider = providerForPlatform(platform);

  return campaigns
    .filter((campaign) => campaign.productKey === 'premium_monthly')
    .filter((campaign) => isWindowActive({ status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt, now }))
    .filter((campaign) => campaignAppliesToViewer(campaign, viewerSignals))
    .flatMap((campaign) =>
      campaign.artifacts
        .filter((artifact) => artifact.provider === provider)
        .filter((artifact) => isWindowActive({ status: artifact.status, startsAt: artifact.startsAt, endsAt: artifact.endsAt, now }))
        .map((artifact) => buildCatalogOffer(campaign, artifact))
    );
}

export function summarizeDiscountCampaigns(campaigns: DiscountCampaign[]) {
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active');
  const artifacts = campaigns.flatMap((campaign) => campaign.artifacts);

  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: activeCampaigns.length,
    specificUserCampaigns: campaigns.filter((campaign) => campaign.targetingKind === 'specific_users').length,
    activeArtifacts: artifacts.filter((artifact) => artifact.status === 'active').length,
    stripeArtifacts: artifacts.filter((artifact) => artifact.provider === 'stripe').length,
    appleArtifacts: artifacts.filter((artifact) => artifact.provider === 'apple_app_store').length,
    googleArtifacts: artifacts.filter((artifact) => artifact.provider === 'google_play').length
  };
}
