import { ApiClientError } from '@tminuszero/api-client';
import { refreshAndCaptureStoredAppleCredential } from '@/src/auth/supabaseAuth';

export async function prepareAppleAccountDeletion(accessToken: string | null) {
  const normalizedAccessToken = String(accessToken || '').trim();
  if (!normalizedAccessToken) {
    return;
  }

  await refreshAndCaptureStoredAppleCredential(normalizedAccessToken);
}

export function describeMobileAccountDeletionError(error: unknown) {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'confirm_required':
        return 'Type DELETE to confirm.';
      case 'unauthorized':
        return 'Sign in again before deleting your account.';
      case 'active_subscription':
      case 'failed_to_cancel_subscription':
        return 'Cancel any active billing first, then retry account deletion.';
      case 'apple_server_not_configured':
      case 'apple_revocation_not_configured':
        return 'Account deletion for Sign in with Apple is temporarily unavailable. Contact support and try again later.';
      case 'apple_token_exchange_failed':
      case 'apple_revocation_unavailable':
        return 'Please sign in with Apple again on this device, then retry account deletion.';
      case 'apple_revocation_failed':
        return 'We could not complete the Apple account-revocation step. Try again or contact support.';
      default:
        return error.detail || error.code || 'Unable to delete account.';
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) {
      return 'Unable to delete account.';
    }
    const normalized = message.toLowerCase();
    if (normalized.includes('cancelled before it completed')) {
      return 'Apple re-authentication was cancelled. Sign in with Apple again on this device, then retry account deletion.';
    }
    if (normalized.includes('revocable authorization code')) {
      return 'Please sign in with Apple again on this device, then retry account deletion.';
    }
    if (normalized.includes('not available in this build')) {
      return 'Account deletion for Sign in with Apple is temporarily unavailable in this build. Contact support and try again later.';
    }
    return message;
  }

  return 'Unable to delete account.';
}
