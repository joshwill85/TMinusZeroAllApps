'use client';

import { useState } from 'react';
import { resolveAdminAccessOverrideErrorMessage, resolveAdminAccessOverrideUpdateFeedback } from '@tminuszero/domain';
import {
  useAdminAccessOverrideQuery,
  useUpdateAdminAccessOverrideMutation,
  useViewerEntitlementsQuery
} from '@/lib/api/queries';

export default function AdminAccessPage() {
  const entitlementsQuery = useViewerEntitlementsQuery();
  const adminAccessOverrideQuery = useAdminAccessOverrideQuery();
  const updateAdminAccessOverrideMutation = useUpdateAdminAccessOverrideMutation();

  const adminAccessState = adminAccessOverrideQuery.data ?? null;
  const adminAccessOverride = adminAccessState?.adminAccessOverride ?? entitlementsQuery.data?.adminAccessOverride ?? null;
  const effectiveTier = adminAccessState?.effectiveTier ?? entitlementsQuery.data?.tier ?? 'anon';
  const effectiveTierSource = adminAccessState?.effectiveTierSource ?? entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = adminAccessState?.billingIsPaid ?? (entitlementsQuery.data?.billingIsPaid === true);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateAdminAccessOverride(next: 'anon' | 'premium' | null) {
    setMessage(null);
    setError(null);
    try {
      const payload = await updateAdminAccessOverrideMutation.mutateAsync({ adminAccessOverride: next });
      const feedback = resolveAdminAccessOverrideUpdateFeedback({
        requested: next,
        actualOverride: payload.adminAccessOverride,
        effectiveTier: payload.effectiveTier,
        effectiveTierSource: payload.effectiveTierSource
      });
      if (feedback.kind === 'error') {
        setError(feedback.message);
        return;
      }
      setMessage(feedback.message);
    } catch (nextError: unknown) {
      setError(
        resolveAdminAccessOverrideErrorMessage(
          getErrorCode(nextError),
          nextError instanceof Error ? nextError.message : 'Unable to update admin access.'
        )
      );
    }
  }

  const controlsDisabled = adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <section className="rounded-3xl border border-stroke bg-surface-1 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Admin access</div>
            <h1 className="mt-1 text-2xl font-semibold text-text1">Customer access testing</h1>
            <p className="mt-2 max-w-2xl text-sm text-text3">
              Switch this admin account between public and full customer access. Billing records and admin permissions stay unchanged.
            </p>
          </div>
          <span className="whitespace-nowrap rounded-full border border-primary/30 px-3 py-1 text-xs text-primary">
            {formatAdminAccessTierLabel(effectiveTier)}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <AdminAccessButton
            label="Use default"
            active={adminAccessOverride === null}
            disabled={controlsDisabled}
            onClick={() => void updateAdminAccessOverride(null)}
          />
          <AdminAccessButton
            label="Public"
            active={adminAccessOverride === 'anon'}
            disabled={controlsDisabled}
            onClick={() => void updateAdminAccessOverride('anon')}
          />
          <AdminAccessButton
            label="Full access"
            active={adminAccessOverride === 'premium'}
            disabled={controlsDisabled}
            onClick={() => void updateAdminAccessOverride('premium')}
          />
        </div>

        <div className="mt-4 grid gap-3 text-sm text-text2 sm:grid-cols-3">
          <AdminMetric label="Current access" value={formatAdminAccessTierLabel(effectiveTier)} />
          <AdminMetric label="Source" value={formatEffectiveTierSource(effectiveTierSource)} />
          <AdminMetric label="Real billing" value={billingIsPaid ? 'Active' : 'Inactive'} />
        </div>

        {message ? (
          <div className="mt-3 text-sm text-success" aria-live="polite">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 text-sm text-warning" aria-live="polite">
            {error}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function AdminAccessButton({
  label,
  active,
  disabled,
  onClick
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
        active
          ? 'border-primary bg-[rgba(34,211,238,0.16)] text-primary'
          : 'border-stroke bg-surface-0 text-text2 hover:border-primary/40'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function AdminMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
      <div className="text-[11px] uppercase tracking-[0.1em] text-text3">{label}</div>
      <div className="mt-2 text-sm font-semibold text-text1">{value}</div>
    </div>
  );
}

function formatEffectiveTierSource(value: string) {
  if (value === 'admin_override') return 'Manual override';
  if (value === 'admin') return 'Admin default';
  if (value === 'subscription') return 'Paid subscription';
  if (value === 'anon') return 'Anon default';
  return 'Guest session';
}

function formatAdminAccessTierLabel(value: string) {
  return value === 'premium' ? 'Full access' : 'Public access';
}

function getErrorCode(error: unknown) {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
}
