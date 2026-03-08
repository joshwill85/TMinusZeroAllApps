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

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [promotionCodes, setPromotionCodes] = useState<PromotionCodeRow[]>([]);
  const [couponsStatus, setCouponsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [couponsError, setCouponsError] = useState<string | null>(null);
  const [creatingCoupon, setCreatingCoupon] = useState(false);
  const [promoActionError, setPromoActionError] = useState<string | null>(null);
  const [updatingPromoId, setUpdatingPromoId] = useState<string | null>(null);
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Coupons</h1>
        <p className="text-sm text-text2">Create Stripe coupons and promo codes for discounts.</p>
      </div>

      {couponsError && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {couponsError}
        </div>
      )}

      <SectionCard title="Coupons & promotion codes" description="Create Stripe coupons and promo codes for discounts.">
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

