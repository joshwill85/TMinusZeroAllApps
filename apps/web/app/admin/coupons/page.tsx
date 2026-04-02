'use client';

import { useEffect, useState } from 'react';
import SectionCard from '../_components/SectionCard';

type CouponRow = {
  id: string;
  name?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration: string;
  duration_in_months?: number | null;
  valid: boolean;
  max_redemptions?: number | null;
  times_redeemed?: number | null;
};

type PromotionCodeRow = {
  id: string;
  code: string | null;
  active: boolean;
  max_redemptions?: number | null;
  times_redeemed?: number | null;
  customer?: string | null;
  metadata?: Record<string, string> | null;
  restrictions?: Record<string, unknown> | null;
  coupon?: { id: string; name?: string | null } | null;
};

type DiscountCampaignArtifactRow = {
  id: string;
  provider: 'stripe' | 'apple_app_store' | 'google_play';
  artifactKind:
    | 'stripe_coupon'
    | 'stripe_promotion_code'
    | 'apple_offer_code'
    | 'apple_promotional_offer'
    | 'apple_win_back_offer'
    | 'google_offer'
    | 'google_promo_code';
  status: 'draft' | 'active' | 'paused' | 'ended' | 'sync_error';
  externalId: string | null;
  externalCode: string | null;
  payload: Record<string, string | null>;
  startsAt: string | null;
  endsAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type DiscountCampaignTargetRow = {
  id: string;
  userId: string | null;
  email: string | null;
};

type DiscountCampaignRow = {
  id: string;
  slug: string;
  name: string;
  productKey: 'premium_monthly';
  campaignKind: 'promo_code' | 'store_offer';
  targetingKind: 'all_users' | 'new_subscribers' | 'lapsed_subscribers' | 'specific_users';
  status: 'draft' | 'active' | 'paused' | 'ended' | 'sync_error';
  startsAt: string | null;
  endsAt: string | null;
  displayCopy: {
    headline: string | null;
    body: string | null;
  };
  internalNotes: string | null;
  targets: DiscountCampaignTargetRow[];
  artifacts: DiscountCampaignArtifactRow[];
  targetCounts: {
    total: number;
    userTargets: number;
    emailTargets: number;
  };
};

type DiscountCampaignSummary = {
  totalCampaigns: number;
  activeCampaigns: number;
  specificUserCampaigns: number;
  activeArtifacts: number;
  stripeArtifacts: number;
  appleArtifacts: number;
  googleArtifacts: number;
};

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [promotionCodes, setPromotionCodes] = useState<PromotionCodeRow[]>([]);
  const [couponsStatus, setCouponsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [couponsError, setCouponsError] = useState<string | null>(null);
  const [creatingCoupon, setCreatingCoupon] = useState(false);
  const [promoActionError, setPromoActionError] = useState<string | null>(null);
  const [updatingPromoId, setUpdatingPromoId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<DiscountCampaignRow[]>([]);
  const [campaignSummary, setCampaignSummary] = useState<DiscountCampaignSummary | null>(null);
  const [campaignsStatus, setCampaignsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [attachingArtifact, setAttachingArtifact] = useState(false);
  const [updatingCampaignId, setUpdatingCampaignId] = useState<string | null>(null);
  const [campaignStatusDrafts, setCampaignStatusDrafts] = useState<Record<string, DiscountCampaignRow['status']>>({});
  const [couponForm, setCouponForm] = useState({
    code: '',
    discountType: 'percent',
    percentOff: '20',
    amountOff: '',
    currency: 'usd',
    duration: 'once',
    durationMonths: '3',
    maxRedemptions: '',
    restrictedUserEmail: ''
  });
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    slug: '',
    campaignKind: 'promo_code',
    targetingKind: 'all_users',
    status: 'draft',
    startsAt: '',
    endsAt: '',
    headline: '',
    body: '',
    internalNotes: '',
    targetEmails: ''
  });
  const [artifactForm, setArtifactForm] = useState({
    campaignId: '',
    provider: 'stripe',
    artifactKind: 'stripe_promotion_code',
    status: 'draft',
    externalId: '',
    externalCode: '',
    label: '',
    eligibilityHint: '',
    startsAt: '',
    endsAt: '',
    offerIdentifier: '',
    redemptionUrl: '',
    basePlanId: '',
    offerId: '',
    offerToken: '',
    promotionCode: ''
  });

  useEffect(() => {
    let cancelled = false;
    setCouponsStatus('loading');
    fetch('/api/admin/coupons', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load coupons');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setCoupons(Array.isArray(json.coupons) ? (json.coupons as CouponRow[]) : []);
        setPromotionCodes(Array.isArray(json.promotionCodes) ? (json.promotionCodes as PromotionCodeRow[]) : []);
        setCouponsStatus('ready');
      })
      .catch((err) => {
        console.error('admin coupons fetch error', err);
        if (!cancelled) {
          setCouponsStatus('error');
          setCouponsError(err.message || 'Failed to load coupons');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCampaignsStatus('loading');
    setCampaignsError(null);
    fetch('/api/admin/discount-campaigns', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load discount campaigns');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const nextCampaigns = Array.isArray(json.campaigns) ? (json.campaigns as DiscountCampaignRow[]) : [];
        setCampaigns(nextCampaigns);
        setCampaignSummary((json.summary as DiscountCampaignSummary) || null);
        setCampaignStatusDrafts(Object.fromEntries(nextCampaigns.map((campaign) => [campaign.id, campaign.status])));
        setArtifactForm((prev) => ({
          ...prev,
          campaignId: prev.campaignId || nextCampaigns[0]?.id || ''
        }));
        setCampaignsStatus('ready');
      })
      .catch((err) => {
        console.error('admin discount campaigns fetch error', err);
        if (!cancelled) {
          setCampaignsStatus('error');
          setCampaignsError(err.message || 'Failed to load discount campaigns');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshCampaigns() {
    setCampaignsStatus('loading');
    setCampaignsError(null);
    try {
      const res = await fetch('/api/admin/discount-campaigns', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load discount campaigns');
      }
      const nextCampaigns = Array.isArray(json.campaigns) ? (json.campaigns as DiscountCampaignRow[]) : [];
      setCampaigns(nextCampaigns);
      setCampaignSummary((json.summary as DiscountCampaignSummary) || null);
      setCampaignStatusDrafts(Object.fromEntries(nextCampaigns.map((campaign) => [campaign.id, campaign.status])));
      setArtifactForm((prev) => ({
        ...prev,
        campaignId: prev.campaignId || nextCampaigns[0]?.id || ''
      }));
      setCampaignsStatus('ready');
    } catch (err: any) {
      setCampaignsStatus('error');
      setCampaignsError(err.message || 'Failed to load discount campaigns');
    }
  }

  async function createCoupon() {
    setCreatingCoupon(true);
    setCouponsError(null);
    setPromoActionError(null);
    try {
      const discountType = couponForm.discountType === 'amount' ? 'amount' : 'percent';
      const payload = {
        code: couponForm.code.trim(),
        percentOff: discountType === 'percent' && couponForm.percentOff ? Number(couponForm.percentOff) : undefined,
        amountOff: discountType === 'amount' && couponForm.amountOff ? Number(couponForm.amountOff) : undefined,
        currency: discountType === 'amount' && couponForm.currency ? couponForm.currency.trim().toLowerCase() : undefined,
        duration: couponForm.duration,
        durationInMonths: couponForm.duration === 'repeating' ? Number(couponForm.durationMonths) : undefined,
        maxRedemptions: couponForm.maxRedemptions ? Number(couponForm.maxRedemptions) : undefined,
        restrictedUserEmail: couponForm.restrictedUserEmail ? couponForm.restrictedUserEmail.trim() : undefined
      };
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to create coupon');
      }
      const json = await res.json();
      setCoupons((prev) => [json.coupon, ...prev]);
      setPromotionCodes((prev) => [json.promotionCode, ...prev]);
      setCouponForm((prev) => ({ ...prev, code: '' }));
    } catch (err: any) {
      setCouponsError(err.message || 'Failed to create coupon');
    } finally {
      setCreatingCoupon(false);
    }
  }

  async function setPromotionCodeActive(promo: PromotionCodeRow, nextActive: boolean) {
    setUpdatingPromoId(promo.id);
    setPromoActionError(null);
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotionCodeId: promo.id, active: nextActive })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update promo code');
      }
      const updated = json.promotionCode as PromotionCodeRow | undefined;
      setPromotionCodes((prev) =>
        prev.map((p) =>
          p.id === promo.id
            ? {
                ...p,
                active: updated?.active ?? nextActive,
                max_redemptions: updated?.max_redemptions ?? p.max_redemptions,
                times_redeemed: updated?.times_redeemed ?? p.times_redeemed,
                customer: updated?.customer ?? p.customer,
                metadata: updated?.metadata ?? p.metadata,
                restrictions: updated?.restrictions ?? p.restrictions
              }
            : p
        )
      );
    } catch (err: any) {
      setPromoActionError(err.message || 'Failed to update promo code');
    } finally {
      setUpdatingPromoId(null);
    }
  }

  async function createCampaign() {
    setCreatingCampaign(true);
    setCampaignsError(null);
    try {
      const payload = {
        name: campaignForm.name.trim(),
        slug: campaignForm.slug.trim() || undefined,
        productKey: 'premium_monthly',
        campaignKind: campaignForm.campaignKind,
        targetingKind: campaignForm.targetingKind,
        status: campaignForm.status,
        startsAt: campaignForm.startsAt ? new Date(campaignForm.startsAt).toISOString() : null,
        endsAt: campaignForm.endsAt ? new Date(campaignForm.endsAt).toISOString() : null,
        headline: campaignForm.headline.trim() || undefined,
        body: campaignForm.body.trim() || undefined,
        internalNotes: campaignForm.internalNotes.trim() || undefined,
        targetEmails:
          campaignForm.targetingKind === 'specific_users'
            ? Array.from(
                new Set(
                  campaignForm.targetEmails
                    .split(/[\n,\s]+/)
                    .map((value) => value.trim().toLowerCase())
                    .filter(Boolean)
                )
              )
            : undefined
      };
      const res = await fetch('/api/admin/discount-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create campaign');
      }
      const createdCampaign = (json.campaign as DiscountCampaignRow | null) ?? null;
      setCampaignForm({
        name: '',
        slug: '',
        campaignKind: 'promo_code',
        targetingKind: 'all_users',
        status: 'draft',
        startsAt: '',
        endsAt: '',
        headline: '',
        body: '',
        internalNotes: '',
        targetEmails: ''
      });
      if (createdCampaign?.id) {
        setArtifactForm((prev) => ({ ...prev, campaignId: createdCampaign.id }));
      }
      await refreshCampaigns();
    } catch (err: any) {
      setCampaignsError(err.message || 'Failed to create campaign');
    } finally {
      setCreatingCampaign(false);
    }
  }

  async function updateCampaignStatus(campaign: DiscountCampaignRow) {
    const nextStatus = campaignStatusDrafts[campaign.id] ?? campaign.status;
    setUpdatingCampaignId(campaign.id);
    setCampaignsError(null);
    try {
      const res = await fetch('/api/admin/discount-campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_status',
          campaignId: campaign.id,
          status: nextStatus
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update campaign');
      }
      const updatedCampaign = (json.campaign as DiscountCampaignRow | null) ?? null;
      setCampaigns((prev) => prev.map((entry) => (entry.id === campaign.id && updatedCampaign ? updatedCampaign : entry)));
      await refreshCampaigns();
    } catch (err: any) {
      setCampaignsError(err.message || 'Failed to update campaign');
    } finally {
      setUpdatingCampaignId(null);
    }
  }

  async function attachArtifact() {
    setAttachingArtifact(true);
    setCampaignsError(null);
    try {
      const res = await fetch('/api/admin/discount-campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'attach_artifact',
          campaignId: artifactForm.campaignId,
          provider: artifactForm.provider,
          artifactKind: artifactForm.artifactKind,
          status: artifactForm.status,
          externalId: artifactForm.externalId.trim() || undefined,
          externalCode: artifactForm.externalCode.trim() || undefined,
          label: artifactForm.label.trim() || undefined,
          eligibilityHint: artifactForm.eligibilityHint.trim() || undefined,
          startsAt: artifactForm.startsAt ? new Date(artifactForm.startsAt).toISOString() : null,
          endsAt: artifactForm.endsAt ? new Date(artifactForm.endsAt).toISOString() : null,
          offerIdentifier: artifactForm.offerIdentifier.trim() || undefined,
          redemptionUrl: artifactForm.redemptionUrl.trim() || undefined,
          basePlanId: artifactForm.basePlanId.trim() || undefined,
          offerId: artifactForm.offerId.trim() || undefined,
          offerToken: artifactForm.offerToken.trim() || undefined,
          promotionCode: artifactForm.promotionCode.trim() || undefined
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to attach provider artifact');
      }
      setArtifactForm((prev) => ({
        ...prev,
        externalId: '',
        externalCode: '',
        label: '',
        eligibilityHint: '',
        startsAt: '',
        endsAt: '',
        offerIdentifier: '',
        redemptionUrl: '',
        basePlanId: '',
        offerId: '',
        offerToken: '',
        promotionCode: ''
      }));
      await refreshCampaigns();
    } catch (err: any) {
      setCampaignsError(err.message || 'Failed to attach provider artifact');
    } finally {
      setAttachingArtifact(false);
    }
  }

  const artifactKindOptions = artifactForm.provider === 'stripe'
    ? (['stripe_promotion_code', 'stripe_coupon'] as const)
    : artifactForm.provider === 'apple_app_store'
      ? (['apple_offer_code', 'apple_promotional_offer', 'apple_win_back_offer'] as const)
      : (['google_offer', 'google_promo_code'] as const);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Discounts</h1>
        <p className="text-sm text-text2">
          Manage the cross-platform discount campaign layer, then keep Stripe coupons and promo codes available for web checkout.
        </p>
      </div>

      {couponsError && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {couponsError}
        </div>
      )}
      {campaignsError && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {campaignsError}
        </div>
      )}

      <SectionCard
        title="Discount campaigns"
        description="Canonical campaigns that can project Stripe, App Store, and Google Play artifacts into platform billing catalogs."
      >
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Campaigns" value={campaignSummary?.totalCampaigns ?? 0} />
          <MetricCard label="Active campaigns" value={campaignSummary?.activeCampaigns ?? 0} />
          <MetricCard label="Active artifacts" value={campaignSummary?.activeArtifacts ?? 0} />
          <MetricCard label="Specific-user" value={campaignSummary?.specificUserCampaigns ?? 0} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-stroke bg-surface-0 p-4">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">New campaign</div>
            <div className="mt-3 grid gap-2">
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="April win-back"
                value={campaignForm.name}
                onChange={(e) => setCampaignForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="april-win-back (optional)"
                value={campaignForm.slug}
                onChange={(e) => setCampaignForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase() }))}
              />
              <div className="grid gap-2 md:grid-cols-3">
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={campaignForm.campaignKind}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, campaignKind: e.target.value }))}
                >
                  <option value="promo_code">Promo code</option>
                  <option value="store_offer">Store offer</option>
                </select>
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={campaignForm.targetingKind}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, targetingKind: e.target.value }))}
                >
                  <option value="all_users">All users</option>
                  <option value="new_subscribers">New subscribers</option>
                  <option value="lapsed_subscribers">Lapsed subscribers</option>
                  <option value="specific_users">Specific users</option>
                </select>
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={campaignForm.status}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                  <option value="sync_error">Sync error</option>
                </select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="datetime-local"
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={campaignForm.startsAt}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, startsAt: e.target.value }))}
                />
                <input
                  type="datetime-local"
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={campaignForm.endsAt}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, endsAt: e.target.value }))}
                />
              </div>
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Headline shown in catalog metadata"
                value={campaignForm.headline}
                onChange={(e) => setCampaignForm((prev) => ({ ...prev, headline: e.target.value }))}
              />
              <textarea
                className="min-h-[80px] w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Optional customer-facing body copy"
                value={campaignForm.body}
                onChange={(e) => setCampaignForm((prev) => ({ ...prev, body: e.target.value }))}
              />
              <textarea
                className="min-h-[80px] w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Internal notes"
                value={campaignForm.internalNotes}
                onChange={(e) => setCampaignForm((prev) => ({ ...prev, internalNotes: e.target.value }))}
              />
              {campaignForm.targetingKind === 'specific_users' && (
                <textarea
                  className="min-h-[88px] w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Target emails, separated by commas or new lines"
                  value={campaignForm.targetEmails}
                  onChange={(e) => setCampaignForm((prev) => ({ ...prev, targetEmails: e.target.value }))}
                />
              )}
              <button className="btn w-full rounded-lg text-sm" disabled={creatingCampaign} onClick={createCampaign}>
                {creatingCampaign ? 'Creating...' : 'Create campaign'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-stroke bg-surface-0 p-4">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Attach provider artifact</div>
            <div className="mt-3 grid gap-2">
              <select
                className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                value={artifactForm.campaignId}
                onChange={(e) => setArtifactForm((prev) => ({ ...prev, campaignId: e.target.value }))}
              >
                <option value="">Select campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name} ({campaign.slug})
                  </option>
                ))}
              </select>
              <div className="grid gap-2 md:grid-cols-3">
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={artifactForm.provider}
                  onChange={(e) =>
                    setArtifactForm((prev) => ({
                      ...prev,
                      provider: e.target.value as typeof prev.provider,
                      artifactKind:
                        e.target.value === 'stripe'
                          ? 'stripe_promotion_code'
                          : e.target.value === 'apple_app_store'
                            ? 'apple_offer_code'
                            : 'google_offer'
                    }))
                  }
                >
                  <option value="stripe">Stripe</option>
                  <option value="apple_app_store">App Store</option>
                  <option value="google_play">Google Play</option>
                </select>
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={artifactForm.artifactKind}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, artifactKind: e.target.value }))}
                >
                  {artifactKindOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={artifactForm.status}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                  <option value="sync_error">Sync error</option>
                </select>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="External ID"
                  value={artifactForm.externalId}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, externalId: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="External code / human code"
                  value={artifactForm.externalCode}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, externalCode: e.target.value }))}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Display label"
                  value={artifactForm.label}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, label: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Eligibility hint"
                  value={artifactForm.eligibilityHint}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, eligibilityHint: e.target.value }))}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="datetime-local"
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={artifactForm.startsAt}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, startsAt: e.target.value }))}
                />
                <input
                  type="datetime-local"
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={artifactForm.endsAt}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, endsAt: e.target.value }))}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Apple offer identifier"
                  value={artifactForm.offerIdentifier}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, offerIdentifier: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Apple redemption URL"
                  value={artifactForm.redemptionUrl}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, redemptionUrl: e.target.value }))}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Google base plan ID"
                  value={artifactForm.basePlanId}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, basePlanId: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Google offer ID"
                  value={artifactForm.offerId}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, offerId: e.target.value }))}
                />
                <input
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder="Google offer token"
                  value={artifactForm.offerToken}
                  onChange={(e) => setArtifactForm((prev) => ({ ...prev, offerToken: e.target.value }))}
                />
              </div>
              <input
                className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Stripe promotion code"
                value={artifactForm.promotionCode}
                onChange={(e) => setArtifactForm((prev) => ({ ...prev, promotionCode: e.target.value }))}
              />
              <button
                className="btn w-full rounded-lg text-sm"
                disabled={attachingArtifact || !artifactForm.campaignId}
                onClick={attachArtifact}
              >
                {attachingArtifact ? 'Saving...' : 'Attach artifact'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {campaignsStatus === 'loading' && <div className="text-sm text-text3">Loading campaigns...</div>}
          {campaignsStatus === 'error' && <div className="text-sm text-warning">{campaignsError}</div>}
          {campaignsStatus === 'ready' && campaigns.length === 0 && <div className="text-sm text-text3">No campaigns yet.</div>}
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="rounded-xl border border-stroke bg-surface-0 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div>
                    <div className="text-lg font-medium text-text1">{campaign.name}</div>
                    <div className="text-xs text-text3">
                      {campaign.slug} · {campaign.campaignKind.replace(/_/g, ' ')} · {campaign.targetingKind.replace(/_/g, ' ')}
                    </div>
                  </div>
                  {campaign.displayCopy.headline ? <div className="text-sm text-text1">{campaign.displayCopy.headline}</div> : null}
                  {campaign.displayCopy.body ? <div className="text-sm text-text2">{campaign.displayCopy.body}</div> : null}
                  <div className="flex flex-wrap gap-2 text-[11px] text-text3">
                    <span>Status: {campaign.status.replace(/_/g, ' ')}</span>
                    <span>Targets: {campaign.targetCounts.total}</span>
                    <span>Artifacts: {campaign.artifacts.length}</span>
                    {campaign.startsAt ? <span>Starts {formatTimestamp(campaign.startsAt)}</span> : null}
                    {campaign.endsAt ? <span>Ends {formatTimestamp(campaign.endsAt)}</span> : null}
                  </div>
                  {campaign.internalNotes ? <div className="text-xs text-text3">Internal: {campaign.internalNotes}</div> : null}
                  {campaign.targets.length > 0 ? (
                    <div className="text-xs text-text3">
                      Targets: {campaign.targets.map((target) => target.email || target.userId || '—').join(', ')}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                    value={campaignStatusDrafts[campaign.id] ?? campaign.status}
                    onChange={(e) =>
                      setCampaignStatusDrafts((prev) => ({
                        ...prev,
                        [campaign.id]: e.target.value as DiscountCampaignRow['status']
                      }))
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="ended">Ended</option>
                    <option value="sync_error">Sync error</option>
                  </select>
                  <button
                    className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-[11px] uppercase tracking-[0.08em]"
                    disabled={updatingCampaignId === campaign.id}
                    onClick={() => void updateCampaignStatus(campaign)}
                  >
                    {updatingCampaignId === campaign.id ? 'Saving...' : 'Update'}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {campaign.artifacts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-stroke px-3 py-3 text-xs text-text3">
                    No provider artifacts attached yet.
                  </div>
                ) : (
                  campaign.artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-lg border border-stroke bg-surface-1 px-3 py-3 text-xs text-text2">
                      <div className="text-text1">
                        {formatCampaignProvider(artifact.provider)} · {artifact.artifactKind.replace(/_/g, ' ')}
                      </div>
                      <div className="text-text3">Status: {artifact.status.replace(/_/g, ' ')}</div>
                      <div className="break-all text-text3">ID: {artifact.externalId || '—'}</div>
                      <div className="break-all text-text3">Code: {artifact.externalCode || artifact.payload.promotionCode || '—'}</div>
                      {artifact.payload.label ? <div className="text-text3">Label: {artifact.payload.label}</div> : null}
                      {artifact.payload.eligibilityHint ? <div className="text-text3">Hint: {artifact.payload.eligibilityHint}</div> : null}
                      {artifact.startsAt || artifact.endsAt ? (
                        <div className="text-text3">
                          Window: {artifact.startsAt ? formatTimestamp(artifact.startsAt) : '—'} to {artifact.endsAt ? formatTimestamp(artifact.endsAt) : '—'}
                        </div>
                      ) : null}
                      {artifact.lastError ? <div className="mt-1 text-warning">Last error: {artifact.lastError}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Stripe coupons & promotion codes" description="Create Stripe coupons and promo codes for web checkout continuity.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-stroke bg-surface-0 p-3">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">New coupon</div>
            <div className="mt-2 space-y-2">
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="CODE20"
                value={couponForm.code}
                onChange={(e) => setCouponForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
              />
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Restrict to user email (optional)"
                value={couponForm.restrictedUserEmail}
                onChange={(e) => setCouponForm((prev) => ({ ...prev, restrictedUserEmail: e.target.value }))}
              />
              <div className="text-[11px] text-text3">Optional: user must already have an account.</div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={couponForm.discountType}
                  onChange={(e) => setCouponForm((prev) => ({ ...prev, discountType: e.target.value }))}
                >
                  <option value="percent">Percent off</option>
                  <option value="amount">Amount off</option>
                </select>
                <input
                  className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  placeholder={couponForm.discountType === 'amount' ? 'Amount off (cents)' : 'Percent off'}
                  value={couponForm.discountType === 'amount' ? couponForm.amountOff : couponForm.percentOff}
                  onChange={(e) =>
                    setCouponForm((prev) =>
                      prev.discountType === 'amount' ? { ...prev, amountOff: e.target.value } : { ...prev, percentOff: e.target.value }
                    )
                  }
                />
                {couponForm.discountType === 'amount' && (
                  <input
                    className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                    placeholder="Currency (usd)"
                    value={couponForm.currency}
                    onChange={(e) => setCouponForm((prev) => ({ ...prev, currency: e.target.value.toLowerCase() }))}
                  />
                )}
              </div>
              {couponForm.discountType === 'amount' && (
                <div className="text-[11px] text-text3">Amount off is in cents for the selected currency.</div>
              )}
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                  value={couponForm.duration}
                  onChange={(e) => setCouponForm((prev) => ({ ...prev, duration: e.target.value }))}
                >
                  <option value="once">Once</option>
                  <option value="repeating">Repeating (X months)</option>
                  <option value="forever">Lifetime</option>
                </select>
                {couponForm.duration === 'repeating' && (
                  <input
                    className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                    placeholder="Duration in months"
                    value={couponForm.durationMonths}
                    onChange={(e) => setCouponForm((prev) => ({ ...prev, durationMonths: e.target.value }))}
                  />
                )}
              </div>
              <input
                className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
                placeholder="Max redemptions (optional, set to 1 for single-use)"
                value={couponForm.maxRedemptions}
                onChange={(e) => setCouponForm((prev) => ({ ...prev, maxRedemptions: e.target.value }))}
              />
              <button className="btn w-full rounded-lg text-sm" disabled={creatingCoupon} onClick={createCoupon}>
                {creatingCoupon ? 'Creating...' : 'Create coupon'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-stroke bg-surface-0 p-3">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Active promo codes</div>
            {couponsStatus === 'loading' && <div className="mt-2 text-sm text-text3">Loading...</div>}
            {couponsStatus === 'error' && <div className="mt-2 text-sm text-warning">{couponsError}</div>}
            {couponsStatus === 'ready' && (
              <div className="mt-2 space-y-2">
                {promotionCodes.length === 0 && <div className="text-sm text-text3">No promo codes yet.</div>}
                {promotionCodes.map((promo) => (
                  <div
                    key={promo.id}
                    className="flex items-center justify-between rounded-lg border border-stroke px-3 py-2 text-xs text-text2"
                  >
                    <div>
                      <div className="text-text1">{promo.code}</div>
                      <div className="text-text3">Coupon: {promo.coupon?.name || promo.coupon?.id || '—'}</div>
                      {formatPromoRestriction(promo) && (
                        <div className="text-text3">Restricted: {formatPromoRestriction(promo)}</div>
                      )}
                      <div className="text-text3">
                        Redeemed: {promo.times_redeemed ?? 0} / {promo.max_redemptions ?? '∞'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={promo.active ? 'text-success' : 'text-text3'}>{promo.active ? 'Active' : 'Inactive'}</span>
                      <button
                        className="btn-secondary rounded-lg border border-stroke px-2 py-1 text-[11px] uppercase tracking-[0.08em]"
                        disabled={updatingPromoId === promo.id}
                        onClick={() => {
                          if (promo.active) {
                            const confirm = window.confirm(`Deactivate promo code ${promo.code || promo.id}?`);
                            if (!confirm) return;
                          }
                          void setPromotionCodeActive(promo, !promo.active);
                        }}
                      >
                        {updatingPromoId === promo.id ? 'Saving...' : promo.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
                {promoActionError && <div className="text-xs text-warning">{promoActionError}</div>}
              </div>
            )}
          </div>
        </div>

        {couponsStatus === 'ready' && coupons.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Coupons</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {coupons.map((coupon) => (
                <div key={coupon.id} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text2">
                  <div className="text-text1">{coupon.name || coupon.id}</div>
                  <div className="text-text3">
                    {coupon.percent_off
                      ? `${coupon.percent_off}% off`
                      : coupon.amount_off
                        ? `${coupon.amount_off} ${coupon.currency?.toUpperCase()}`
                        : 'Discount'}{' '}
                    • {formatCouponDuration(coupon)}
                  </div>
                  <div className="text-text3">
                    Redeemed: {coupon.times_redeemed ?? 0} / {coupon.max_redemptions ?? '∞'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="mt-1 text-xl font-semibold text-text1">{value}</div>
    </div>
  );
}

function formatCouponDuration(coupon: CouponRow) {
  if (coupon.duration === 'repeating') {
    return coupon.duration_in_months ? `repeating (${coupon.duration_in_months} months)` : 'repeating';
  }
  if (coupon.duration === 'forever') return 'lifetime';
  return 'once';
}

function formatPromoRestriction(promo: PromotionCodeRow) {
  const email = promo.metadata?.restricted_user_email?.trim();
  if (email) return email;
  const userId = promo.metadata?.restricted_user_id?.trim();
  if (userId) return userId;
  if (promo.customer) return promo.customer;
  return null;
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatCampaignProvider(provider: DiscountCampaignArtifactRow['provider']) {
  if (provider === 'apple_app_store') return 'App Store';
  if (provider === 'google_play') return 'Google Play';
  return 'Stripe';
}
