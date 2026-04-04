import type { AdminAccessOverrideV1, EntitlementsV1 } from '@tminuszero/contracts';
import { getTierCapabilities, getTierLimits, getTierRefreshSeconds, tierToMode } from './viewer';

export function resolveAdminAccessOverrideErrorMessage(code: string | null, fallback: string) {
  if (code === 'admin_access_override_not_configured') {
    return 'Admin access testing is not configured on this backend yet. Apply the admin access override migration before using this control.';
  }

  if (code === 'supabase_admin_not_configured') {
    return 'Admin access testing is unavailable because this backend is missing admin Supabase configuration.';
  }

  if (code === 'forbidden') {
    return 'Admin access testing is only available to signed-in admins.';
  }

  return fallback;
}

export function applyAdminAccessOverrideToEntitlements(
  current: EntitlementsV1 | undefined,
  payload: AdminAccessOverrideV1
): EntitlementsV1 | undefined {
  if (!current) {
    return current;
  }

  const tier = payload.effectiveTier;
  return {
    ...current,
    tier,
    isPaid: tier === 'premium',
    billingIsPaid: payload.billingIsPaid,
    isAdmin: payload.isAdmin,
    mode: tierToMode(tier),
    effectiveTierSource: payload.effectiveTierSource,
    adminAccessOverride: payload.adminAccessOverride,
    refreshIntervalSeconds: getTierRefreshSeconds(tier),
    capabilities: getTierCapabilities(tier),
    limits: getTierLimits(tier)
  };
}

function formatAdminAccessOverrideValue(value: AdminAccessOverrideV1['adminAccessOverride']) {
  if (value === null) {
    return 'default access';
  }

  return value === 'premium' ? 'premium override' : 'anon override';
}

export function resolveAdminAccessOverrideUpdateFeedback({
  requested,
  actualOverride,
  effectiveTier,
  effectiveTierSource
}: {
  requested: AdminAccessOverrideV1['adminAccessOverride'];
  actualOverride: AdminAccessOverrideV1['adminAccessOverride'];
  effectiveTier: AdminAccessOverrideV1['effectiveTier'];
  effectiveTierSource: AdminAccessOverrideV1['effectiveTierSource'];
}) {
  if (requested !== actualOverride) {
    return {
      kind: 'error' as const,
      message: `Requested ${formatAdminAccessOverrideValue(requested)}, but the server returned ${formatAdminAccessOverrideValue(actualOverride)} with ${effectiveTier} access from ${effectiveTierSource.replace(/_/g, ' ')}.`
    };
  }

  return {
    kind: 'success' as const,
    message:
      actualOverride === null
        ? 'Default admin access restored.'
        : actualOverride === 'premium'
        ? 'Admin premium test mode is active.'
        : 'Admin anon test mode is active.'
  };
}
