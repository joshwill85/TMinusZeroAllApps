'use client';

import { useEffect, useState } from 'react';
import InfoCard from '../_components/InfoCard';
import SectionCard from '../_components/SectionCard';

type BillingConfig = {
  stripeSecret: boolean;
  stripePublishable: boolean;
  stripeWebhook: boolean;
  stripePrice: boolean;
  appleBilling: boolean;
  appleNotifications: boolean;
  googleBilling: boolean;
  googleNotifications: boolean;
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

type ProviderSummary = {
  totalEntitlements: number;
  activeEntitlements: number;
  providers: Array<{
    provider: 'stripe' | 'apple_app_store' | 'google_play';
    label: string;
    total: number;
    active: number;
    canceling: number;
    expired: number;
    pending: number;
    other: number;
  }>;
};

type BillingWebhook = {
  source: 'stripe' | 'apple_app_store' | 'google_play';
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
  provider: 'stripe' | 'apple_app_store' | 'google_play' | null;
  providerProductId: string | null;
  providerLabel: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  planLabel: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  updatedAt: string | null;
};

type PurchaseEvent = {
  user_id: string | null;
  provider: 'stripe' | 'apple_app_store' | 'google_play';
  event_type: string;
  status: string | null;
  provider_event_id: string | null;
  provider_product_id: string | null;
  provider_subscription_id: string | null;
  created_at: string | null;
};

type WebhookFailure = {
  source: 'stripe' | 'apple_app_store' | 'google_play';
  event_id?: string | null;
  received_at: string | null;
  processed: boolean;
  error: string | null;
};

type ClaimSummary = {
  pending: number;
  verified: number;
  claimed: number;
  unattached: number;
};

type MappingSummary = {
  providerCustomerMappings: number;
  unmappedPurchaseEvents: number;
};

type CampaignSummary = {
  totalCampaigns: number;
  activeCampaigns: number;
  specificUserCampaigns: number;
  activeArtifacts: number;
  stripeArtifacts: number;
  appleArtifacts: number;
  googleArtifacts: number;
};

type PremiumClaim = {
  user_id: string | null;
  provider: 'stripe' | 'apple_app_store' | 'google_play';
  status: string;
  provider_product_id: string | null;
  current_period_end: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type BillingResponse = {
  config: BillingConfig | null;
  summary: BillingSummary | null;
  providerSummary: ProviderSummary | null;
  claimSummary: ClaimSummary | null;
  mappingSummary: MappingSummary | null;
  campaignSummary: CampaignSummary | null;
  webhooks: {
    stripe: BillingWebhook;
    apple_app_store: BillingWebhook;
    google_play: BillingWebhook;
  } | null;
  recentClaims: PremiumClaim[];
  recentPurchaseEvents: PurchaseEvent[];
  recentWebhookFailures: WebhookFailure[];
  customers: BillingCustomer[];
};

export default function AdminBillingPage() {
  const [billingStatus, setBillingStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingData, setBillingData] = useState<BillingResponse | null>(null);

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
        setBillingData({
          config: json.config || null,
          summary: json.summary || null,
          providerSummary: json.providerSummary || null,
          claimSummary: json.claimSummary || null,
          mappingSummary: json.mappingSummary || null,
          campaignSummary: json.campaignSummary || null,
          webhooks: json.webhooks || null,
          recentClaims: Array.isArray(json.recentClaims) ? (json.recentClaims as PremiumClaim[]) : [],
          recentPurchaseEvents: Array.isArray(json.recentPurchaseEvents) ? (json.recentPurchaseEvents as PurchaseEvent[]) : [],
          recentWebhookFailures: Array.isArray(json.recentWebhookFailures) ? (json.recentWebhookFailures as WebhookFailure[]) : [],
          customers: Array.isArray(json.customers) ? (json.customers as BillingCustomer[]) : []
        });
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

  const webhooks = billingData?.webhooks
    ? [billingData.webhooks.stripe, billingData.webhooks.apple_app_store, billingData.webhooks.google_play]
    : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Billing</h1>
        <p className="text-sm text-text2">
          Stripe continuity, provider-neutral entitlements, and webhook health for Stripe, App Store, and Google Play.
        </p>
      </div>

      {billingStatus === 'error' && billingError && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {billingError}
        </div>
      )}

      <SectionCard title="Billing Config" description="Readiness for Stripe, App Store, and Google Play billing flows.">
        {billingStatus === 'loading' && <div className="text-sm text-text3">Loading billing...</div>}
        {billingStatus === 'error' && <div className="text-sm text-warning">{billingError}</div>}

        {billingStatus === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Stripe secret" value={formatConfigured(billingData?.config?.stripeSecret)} />
              <InfoCard label="Stripe publishable" value={formatConfigured(billingData?.config?.stripePublishable)} />
              <InfoCard label="Stripe webhook" value={formatConfigured(billingData?.config?.stripeWebhook)} />
              <InfoCard label="Stripe price" value={formatConfigured(billingData?.config?.stripePrice)} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Apple billing" value={formatConfigured(billingData?.config?.appleBilling)} />
              <InfoCard label="Apple notifications" value={formatConfigured(billingData?.config?.appleNotifications)} />
              <InfoCard label="Google billing" value={formatConfigured(billingData?.config?.googleBilling)} />
              <InfoCard label="Google RTDN auth" value={formatConfigured(billingData?.config?.googleNotifications)} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Stripe Summary" description="Legacy Stripe route continuity during provider-neutral billing rollout.">
        {billingStatus === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Users" value={billingData?.summary?.totalUsers ?? 0} />
              <InfoCard label="Stripe customers" value={billingData?.summary?.stripeCustomers ?? 0} />
              <InfoCard label="Subscriptions" value={billingData?.summary?.subscriptions ?? 0} />
              <InfoCard label="Canceling" value={billingData?.summary?.canceling ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Active" value={billingData?.summary?.active ?? 0} />
              <InfoCard label="Trialing" value={billingData?.summary?.trialing ?? 0} />
              <InfoCard label="Past due" value={billingData?.summary?.pastDue ?? 0} />
              <InfoCard label="Unpaid" value={billingData?.summary?.unpaid ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Canceled" value={billingData?.summary?.canceled ?? 0} />
              <InfoCard label="Incomplete" value={billingData?.summary?.incomplete ?? 0} />
              <InfoCard label="Paused" value={billingData?.summary?.paused ?? 0} />
              <InfoCard label="Other" value={billingData?.summary?.other ?? 0} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Provider Entitlements"
        description="Authoritative provider-neutral entitlement state across Stripe, App Store, and Google Play."
      >
        {billingStatus === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Entitlements" value={billingData?.providerSummary?.totalEntitlements ?? 0} />
              <InfoCard label="Active" value={billingData?.providerSummary?.activeEntitlements ?? 0} />
              <InfoCard
                label="Stripe active"
                value={providerActiveCount(billingData?.providerSummary, 'stripe')}
              />
              <InfoCard
                label="Store active"
                value={
                  providerActiveCount(billingData?.providerSummary, 'apple_app_store') +
                  providerActiveCount(billingData?.providerSummary, 'google_play')
                }
              />
            </div>

            <div className="rounded-xl border border-stroke bg-surface-0">
              <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">Provider breakdown</div>
              <div className="max-h-[240px] overflow-auto">
                <table className="w-full text-left text-xs text-text2">
                  <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                    <tr>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Active</th>
                      <th className="px-3 py-2">Canceling</th>
                      <th className="px-3 py-2">Expired</th>
                      <th className="px-3 py-2">Pending</th>
                      <th className="px-3 py-2">Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(billingData?.providerSummary?.providers ?? []).map((provider) => (
                      <tr key={provider.provider} className="border-t border-stroke">
                        <td className="px-3 py-2 text-text1">{provider.label}</td>
                        <td className="px-3 py-2">{provider.total}</td>
                        <td className="px-3 py-2">{provider.active}</td>
                        <td className="px-3 py-2">{provider.canceling}</td>
                        <td className="px-3 py-2">{provider.expired}</td>
                        <td className="px-3 py-2">{provider.pending}</td>
                        <td className="px-3 py-2">{provider.other}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Webhook Health"
        description="Recent webhook and RTDN state for Stripe, App Store Server Notifications, and Google Pub/Sub push."
      >
        {billingStatus === 'ready' && (
          <div className="grid gap-3 md:grid-cols-3">
            {webhooks.map((webhook) => (
              <div key={webhook.source} className="rounded-xl border border-stroke bg-surface-0 p-4">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">{formatProvider(webhook.source)}</div>
                <div className="mt-3 grid gap-3">
                  <InfoCard
                    label="Last received"
                    value={webhook.lastReceivedAt ? new Date(webhook.lastReceivedAt).toLocaleString() : '—'}
                  />
                  <InfoCard
                    label="Last success"
                    value={webhook.lastSuccessAt ? new Date(webhook.lastSuccessAt).toLocaleString() : '—'}
                  />
                  <InfoCard label="Failures (24h)" value={webhook.failedLast24h} />
                  <InfoCard label="Pending" value={webhook.pendingCount} />
                </div>
                {webhook.lastError && (
                  <div className="mt-3 rounded-lg border border-warning bg-[rgba(251,191,36,0.08)] px-3 py-2 text-xs text-warning">
                    Last error: {webhook.lastError}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Claims & Campaigns"
        description="Admin recovery visibility for cross-platform purchases plus imported discount campaign health."
      >
        {billingStatus === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Pending claims" value={billingData?.claimSummary?.pending ?? 0} />
              <InfoCard label="Verified claims" value={billingData?.claimSummary?.verified ?? 0} />
              <InfoCard label="Claimed" value={billingData?.claimSummary?.claimed ?? 0} />
              <InfoCard label="Unattached claims" value={billingData?.claimSummary?.unattached ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Provider mappings" value={billingData?.mappingSummary?.providerCustomerMappings ?? 0} />
              <InfoCard label="Unmapped purchase events" value={billingData?.mappingSummary?.unmappedPurchaseEvents ?? 0} />
              <InfoCard label="Discount campaigns" value={billingData?.campaignSummary?.totalCampaigns ?? 0} />
              <InfoCard label="Active campaigns" value={billingData?.campaignSummary?.activeCampaigns ?? 0} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <InfoCard label="Active artifacts" value={billingData?.campaignSummary?.activeArtifacts ?? 0} />
              <InfoCard label="Specific-user campaigns" value={billingData?.campaignSummary?.specificUserCampaigns ?? 0} />
              <InfoCard label="App Store artifacts" value={billingData?.campaignSummary?.appleArtifacts ?? 0} />
              <InfoCard label="Google artifacts" value={billingData?.campaignSummary?.googleArtifacts ?? 0} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent Claims" description="Latest premium claim and account-attach state for store purchases made before sign-in.">
        {billingStatus === 'ready' && (
          <div className="rounded-xl border border-stroke bg-surface-0">
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full text-left text-xs text-text2">
                <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                  <tr>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Period end</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData?.recentClaims ?? []).length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-text3" colSpan={6}>
                        No premium claims yet.
                      </td>
                    </tr>
                  )}
                  {(billingData?.recentClaims ?? []).map((claim, index) => (
                    <tr key={`${claim.provider}-${claim.updated_at || index}`} className="border-t border-stroke">
                      <td className="px-3 py-2">{claim.updated_at ? new Date(claim.updated_at).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-text1">{formatProvider(claim.provider)}</td>
                      <td className="px-3 py-2">{formatSubscriptionStatus(claim.status)}</td>
                      <td className="px-3 py-2 break-all">{claim.user_id || '—'}</td>
                      <td className="px-3 py-2 break-all font-mono text-text3">{claim.provider_product_id || '—'}</td>
                      <td className="px-3 py-2">{claim.current_period_end ? new Date(claim.current_period_end).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent Purchase Events" description="Latest provider-neutral purchase events written during sync and webhook processing.">
        {billingStatus === 'ready' && (
          <div className="rounded-xl border border-stroke bg-surface-0">
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full text-left text-xs text-text2">
                <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Provider IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData?.recentPurchaseEvents ?? []).length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-text3" colSpan={6}>
                        No purchase events yet.
                      </td>
                    </tr>
                  )}
                  {(billingData?.recentPurchaseEvents ?? []).map((event, index) => (
                    <tr key={`${event.provider}-${event.provider_event_id || index}`} className="border-t border-stroke">
                      <td className="px-3 py-2">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-text1">{formatProvider(event.provider)}</td>
                      <td className="px-3 py-2">{event.event_type}</td>
                      <td className="px-3 py-2">{formatSubscriptionStatus(event.status || 'none')}</td>
                      <td className="px-3 py-2">
                        <div className="break-all">{event.user_id || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-text3">
                        <div className="break-all font-mono">{event.provider_product_id || '—'}</div>
                        <div className="break-all font-mono">{event.provider_subscription_id || event.provider_event_id || '—'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent Webhook Failures" description="Latest provider webhook failures that need investigation before widening rollout.">
        {billingStatus === 'ready' && (
          <div className="rounded-xl border border-stroke bg-surface-0">
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full text-left text-xs text-text2">
                <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Processed</th>
                    <th className="px-3 py-2">Event ID</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData?.recentWebhookFailures ?? []).length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-text3" colSpan={5}>
                        No webhook failures recorded.
                      </td>
                    </tr>
                  )}
                  {(billingData?.recentWebhookFailures ?? []).map((failure, index) => (
                    <tr key={`${failure.source}-${failure.event_id || index}`} className="border-t border-stroke">
                      <td className="px-3 py-2">{failure.received_at ? new Date(failure.received_at).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-text1">{formatProvider(failure.source)}</td>
                      <td className="px-3 py-2">{failure.processed ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2 break-all font-mono text-text3">{failure.event_id || '—'}</td>
                      <td className="px-3 py-2">{failure.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Customers & Entitlements" description="Current user-level billing and entitlement mapping across providers.">
        {billingStatus === 'ready' && (
          <div className="rounded-xl border border-stroke bg-surface-0">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-xs text-text2">
                <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Period end</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Provider IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {(billingData?.customers ?? []).length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-text3" colSpan={6}>
                        No billing records yet.
                      </td>
                    </tr>
                  )}
                  {(billingData?.customers ?? []).map((customer) => (
                    <tr key={customer.userId} className="border-t border-stroke">
                      <td className="px-3 py-2">
                        <div className="text-text1">{customer.email || customer.userId}</div>
                        <div className="text-text3">{customer.userId}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-text1">{customer.providerLabel}</div>
                        <div className="text-text3">{customer.provider || '—'}</div>
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
                        <div className="text-text3">{customer.providerProductId || customer.stripePriceId || '—'}</div>
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
        )}
      </SectionCard>
    </div>
  );
}

function formatConfigured(value: boolean | null | undefined) {
  return value ? 'Configured' : 'Missing';
}

function formatProvider(provider: 'stripe' | 'apple_app_store' | 'google_play') {
  if (provider === 'apple_app_store') return 'App Store';
  if (provider === 'google_play') return 'Google Play';
  return 'Stripe';
}

function providerActiveCount(summary: ProviderSummary | null | undefined, provider: ProviderSummary['providers'][number]['provider']) {
  return summary?.providers.find((item) => item.provider === provider)?.active ?? 0;
}

function formatSubscriptionStatus(status: string) {
  if (!status || status === 'none') return 'None';
  if (status === 'active') return 'Active';
  if (status === 'past_due') return 'Past due';
  if (status === 'canceled') return 'Canceled';
  if (status === 'unpaid') return 'Unpaid';
  if (status === 'incomplete') return 'Incomplete';
  if (status === 'incomplete_expired') return 'Expired';
  if (status === 'pending') return 'Pending';
  if (status === 'on_hold') return 'On hold';
  if (status === 'paused') return 'Paused';
  if (status === 'revoked') return 'Revoked';
  return status;
}
