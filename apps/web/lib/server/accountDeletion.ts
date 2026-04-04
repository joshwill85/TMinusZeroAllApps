import { successResponseSchemaV1 } from '@tminuszero/contracts';
import { stripe } from '@/lib/api/stripe';
import {
  getStoredAppleSignInToken,
  isAppleSignInServerConfigured,
  recordAppleRevocationResult,
  revokeAppleToken,
  userHasAppleIdentity
} from '@/lib/server/appleAuth';
import { isStripeConfigured, isSupabaseAdminConfigured } from '@/lib/server/env';
import { loadProviderEntitlement } from '@/lib/server/providerEntitlements';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { recordBillingEvent } from '@/lib/server/billingEvents';

export class AccountDeletionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function cancelLegacyStripeSubscription(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    userId,
    email
  }: {
    userId: string;
    email: string | null;
  }
) {
  const { data: subscription, error: subError } = await admin
    .from('subscriptions')
    .select('status, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (subError) {
    throw subError;
  }
  if (!isSubscriptionActive(subscription)) {
    return;
  }
  if (!isStripeConfigured() || !subscription?.stripe_subscription_id) {
    throw new AccountDeletionError(409, 'active_subscription');
  }

  try {
    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true });
    const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
    await recordBillingEvent({
      admin,
      userId,
      email,
      eventType: 'subscription_cancel_requested',
      source: 'account_delete',
      stripeSubscriptionId: updated.id,
      status: updated.status || 'unknown',
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
      currentPeriodEnd,
      sendEmail: false
    });
  } catch (error) {
    console.error('account delete stripe cancel error', error);
    throw new AccountDeletionError(502, 'failed_to_cancel_subscription');
  }
}

async function ensureDeletionBillingState(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    userId,
    email
  }: {
    userId: string;
    email: string | null;
  }
) {
  const { entitlement, loadError } = await loadProviderEntitlement(admin, userId);
  if (loadError) {
    throw new AccountDeletionError(500, loadError);
  }

  if (!entitlement?.isActive) {
    await cancelLegacyStripeSubscription(admin, { userId, email });
    return;
  }

  if (entitlement.provider === 'apple_app_store' || entitlement.provider === 'google_play') {
    throw new AccountDeletionError(409, 'active_subscription');
  }

  if (!isStripeConfigured() || !entitlement.subscriptionId) {
    throw new AccountDeletionError(409, 'active_subscription');
  }

  try {
    const updated = await stripe.subscriptions.update(entitlement.subscriptionId, { cancel_at_period_end: true });
    const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
    await recordBillingEvent({
      admin,
      userId,
      email,
      eventType: 'subscription_cancel_requested',
      source: 'account_delete',
      stripeSubscriptionId: updated.id,
      status: updated.status || 'unknown',
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
      currentPeriodEnd,
      sendEmail: false
    });
  } catch (error) {
    console.error('account delete stripe entitlement cancel error', error);
    throw new AccountDeletionError(502, 'failed_to_cancel_subscription');
  }
}

async function revokeAppleIdentityIfNeeded(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
) {
  const hasAppleIdentity = await userHasAppleIdentity(admin, userId);
  if (!hasAppleIdentity) {
    return;
  }

  if (!isAppleSignInServerConfigured()) {
    throw new AccountDeletionError(503, 'apple_revocation_not_configured');
  }

  const stored = await getStoredAppleSignInToken(admin, userId);
  if (!stored?.tokenValue) {
    throw new AccountDeletionError(409, 'apple_revocation_unavailable');
  }

  try {
    await revokeAppleToken({
      token: stored.tokenValue,
      clientId: stored.clientId
    });
    await recordAppleRevocationResult(admin, {
      userId,
      status: 'revoked',
      clearToken: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apple token revocation failed.';
    try {
      await recordAppleRevocationResult(admin, {
        userId,
        status: 'failed',
        errorMessage: message
      });
    } catch (recordError) {
      console.error('apple revocation result record failed', recordError);
    }
    throw new AccountDeletionError(502, 'apple_revocation_failed', message);
  }
}

export async function deleteAccountWithGuards({
  userId,
  email,
  confirm
}: {
  userId: string | null;
  email: string | null;
  confirm: string;
}) {
  if (!userId) {
    throw new AccountDeletionError(401, 'unauthorized');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new AccountDeletionError(501, 'supabase_service_role_missing');
  }
  if (confirm.trim().toUpperCase() !== 'DELETE') {
    throw new AccountDeletionError(400, 'confirm_required');
  }

  const admin = createSupabaseAdminClient();
  await ensureDeletionBillingState(admin, { userId, email });
  await revokeAppleIdentityIfNeeded(admin, userId);

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('account delete error', deleteError);
    throw new AccountDeletionError(500, 'failed_to_delete');
  }

  return successResponseSchemaV1.parse({ ok: true });
}
