'use client';

import { useEffect, useState } from 'react';
import InfoCard from '../_components/InfoCard';
import SectionCard from '../_components/SectionCard';

type BillingConfig = {
  stripeSecret: boolean;
  stripePublishable: boolean;
  stripeWebhook: boolean;
  stripePrice: boolean;
};

type BillingSummary = {
  totalUsers: number;
  stripeCustomers: number;
  subscriptions: number;
  active: number;
  trialing: number;
  pastDue: number;
  unpaid: number;
  canceled: number;
  incomplete: number;
  incompleteExpired: number;
  paused: number;
  other: number;
  canceling: number;
};

type BillingWebhook = {
  lastReceivedAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  pendingCount: number;
  failedLast24h: number;
};

type BillingCustomer = {
  userId: string;
  email: string | null;
  role: 'user' | 'admin';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  planLabel: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  updatedAt: string | null;
};

export default function AdminBillingPage() {
  const [billingStatus, setBillingStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingConfig, setBillingConfig] = useState<BillingConfig | null>(null);
  const [billingWebhook, setBillingWebhook] = useState<BillingWebhook | null>(null);
  const [billingCustomers, setBillingCustomers] = useState<BillingCustomer[]>([]);

  useEffect(() => {
    let cancelled = false;
    setBillingStatus('loading');
    setBillingError(null);
    fetch('/api/admin/billing', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load billing');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setBillingSummary(json.summary || null);
        setBillingConfig(json.config || null);
        setBillingWebhook(json.webhook || null);
        setBillingCustomers(Array.isArray(json.customers) ? (json.customers as BillingCustomer[]) : []);
        setBillingStatus('ready');
      })
      .catch((err) => {
        console.error('admin billing fetch error', err);
        if (!cancelled) {
          setBillingStatus('error');
          setBillingError(err.message || 'Failed to load billing');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Billing</h1>
        <p className="text-sm text-text2">Stripe configuration, webhook health, and subscription status.</p>
      </div>

      {billingStatus === 'error' && billingError && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {billingError}
        </div>
      )}

      <SectionCard title="Billing & Stripe" description="Stripe configuration, webhook health, and subscription status.">
        {billingStatus === 'loading' && <div className="text-sm text-text3">Loading billing...</div>}
        {billingStatus === 'error' && <div className="text-sm text-warning">{billingError}</div>}

        {billingStatus === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Stripe secret" value={billingConfig?.stripeSecret ? 'Configured' : 'Missing'} />
              <InfoCard label="Publishable key" value={billingConfig?.stripePublishable ? 'Configured' : 'Missing'} />
              <InfoCard label="Webhook secret" value={billingConfig?.stripeWebhook ? 'Configured' : 'Missing'} />
              <InfoCard label="Price ID" value={billingConfig?.stripePrice ? 'Configured' : 'Missing'} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Users" value={billingSummary?.totalUsers ?? 0} />
              <InfoCard label="Stripe customers" value={billingSummary?.stripeCustomers ?? 0} />
              <InfoCard label="Subscriptions" value={billingSummary?.subscriptions ?? 0} />
              <InfoCard label="Canceling" value={billingSummary?.canceling ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Active" value={billingSummary?.active ?? 0} />
              <InfoCard label="Trialing" value={billingSummary?.trialing ?? 0} />
              <InfoCard label="Past due" value={billingSummary?.pastDue ?? 0} />
              <InfoCard label="Unpaid" value={billingSummary?.unpaid ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Canceled" value={billingSummary?.canceled ?? 0} />
              <InfoCard label="Incomplete" value={billingSummary?.incomplete ?? 0} />
              <InfoCard label="Paused" value={billingSummary?.paused ?? 0} />
              <InfoCard label="Other" value={billingSummary?.other ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard
                label="Last webhook"
                value={billingWebhook?.lastReceivedAt ? new Date(billingWebhook.lastReceivedAt).toLocaleString() : '—'}
              />
              <InfoCard
                label="Last success"
                value={billingWebhook?.lastSuccessAt ? new Date(billingWebhook.lastSuccessAt).toLocaleString() : '—'}
              />
              <InfoCard label="Failures (24h)" value={billingWebhook?.failedLast24h ?? 0} />
              <InfoCard label="Webhook pending" value={billingWebhook?.pendingCount ?? 0} />
            </div>

            {billingWebhook?.lastError && (
              <div className="rounded-lg border border-warning bg-[rgba(251,191,36,0.08)] px-3 py-2 text-xs text-warning">
                Last webhook error: {billingWebhook.lastError}
              </div>
            )}

            <div className="rounded-xl border border-stroke bg-surface-0">
              <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">Customers & subscriptions</div>
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-left text-xs text-text2">
                  <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Period end</th>
                      <th className="px-3 py-2">Plan</th>
                      <th className="px-3 py-2">Stripe IDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingCustomers.length === 0 && (
                      <tr>
                        <td className="px-3 py-3 text-text3" colSpan={5}>
                          No billing records yet.
                        </td>
                      </tr>
                    )}
                    {billingCustomers.map((customer) => (
                      <tr key={customer.userId} className="border-t border-stroke">
                        <td className="px-3 py-2">
                          <div className="text-text1">{customer.email || customer.userId}</div>
                          <div className="text-text3">{customer.userId}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-text1">{formatSubscriptionStatus(customer.status)}</div>
                          <div className="text-text3">{customer.cancelAtPeriodEnd ? 'Cancels at period end' : '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          {customer.currentPeriodEnd ? new Date(customer.currentPeriodEnd).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-text1">{customer.planLabel}</div>
                          <div className="text-text3">{customer.stripePriceId || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-text3">
                          <div className="break-all font-mono">{customer.stripeCustomerId || '—'}</div>
                          <div className="break-all font-mono">{customer.stripeSubscriptionId || '—'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function formatSubscriptionStatus(status: string) {
  if (!status || status === 'none') return 'None';
  if (status === 'active') return 'Active';
  if (status === 'past_due') return 'Past due';
  if (status === 'canceled') return 'Canceled';
  if (status === 'unpaid') return 'Unpaid';
  if (status === 'incomplete') return 'Incomplete';
  if (status === 'incomplete_expired') return 'Expired';
  if (status === 'paused') return 'Paused';
  return status;
}

