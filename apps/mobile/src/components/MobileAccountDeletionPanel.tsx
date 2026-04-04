import { useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import type { BillingSummaryV1 } from '@tminuszero/api-client';
import { useDeleteAccountMutation } from '@/src/api/queries';
import { describeMobileAccountDeletionError, prepareAppleAccountDeletion } from '@/src/auth/appleAccountDeletion';
import { signOut } from '@/src/auth/supabaseAuth';
import { CustomerShellActionButton, CustomerShellPanel } from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';

type MobileAccountDeletionPanelProps = {
  billingSummary: BillingSummaryV1 | null;
  onDeleted: (message: string) => void;
};

export function MobileAccountDeletionPanel({ billingSummary, onDeleted }: MobileAccountDeletionPanelProps) {
  const { accessToken, clearSession, theme } = useMobileBootstrap();
  const { unregisterCurrentDevice } = useMobilePush();
  const deleteAccountMutation = useDeleteAccountMutation();
  const [confirmText, setConfirmText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const hasActiveStoreSubscription = Boolean(
    billingSummary &&
      billingSummary.isPaid &&
      (billingSummary.provider === 'apple_app_store' || billingSummary.provider === 'google_play')
  );
  const hasActiveStripeSubscription = Boolean(billingSummary && billingSummary.isPaid && billingSummary.provider === 'stripe');
  const storeManagementUrl = hasActiveStoreSubscription ? billingSummary?.managementUrl ?? null : null;
  const canSubmitDeletion = confirmText.trim().toUpperCase() === 'DELETE' && !deleteAccountMutation.isPending;

  async function openStoreManagement() {
    if (!storeManagementUrl) {
      return;
    }

    setErrorText(null);
    try {
      await Linking.openURL(storeManagementUrl);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to open store subscription management.');
    }
  }

  async function handleDeleteAccount() {
    setErrorText(null);

    try {
      await unregisterCurrentDevice().catch(() => undefined);
      await prepareAppleAccountDeletion(accessToken);
      await deleteAccountMutation.mutateAsync(confirmText);
      setConfirmText('');
      setIsExpanded(false);
      await signOut(accessToken).catch(() => undefined);
      await clearSession();
      onDeleted('Account deleted. This device is now back in guest mode.');
    } catch (error) {
      setErrorText(describeMobileAccountDeletionError(error));
    }
  }

  return (
    <CustomerShellPanel
      testID="profile-delete-section"
      title="Delete account"
      description="Permanently remove your T-Minus Zero account from the app."
    >
      <View style={{ gap: 12 }}>
        <View
          style={{
            gap: 8,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(255, 144, 135, 0.35)',
            backgroundColor: 'rgba(255, 144, 135, 0.08)',
            paddingHorizontal: 14,
            paddingVertical: 14
          }}
        >
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>
            Deletion removes your first-party account data.
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            This removes your profile, preferences, saved items, watchlists, alert rules, and other first-party account data tied to this login.
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            Some processor-held billing records and limited security or event logs may remain where required by law or needed to prevent fraud and abuse.
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            If you used Sign in with Apple, we may ask Apple for a final authorization refresh so we can revoke that connection before deletion completes.
          </Text>
          {hasActiveStoreSubscription ? (
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
              Your Premium subscription is managed in {formatStoreLabel(billingSummary?.provider ?? 'none')}. Delete the account here if you want, but cancel in the store first if you do not want renewal to continue.
            </Text>
          ) : null}
          {hasActiveStripeSubscription ? (
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
              If this account has an active web-billed subscription, we attempt to stop renewal automatically before deletion. If that fails, contact support before trying again.
            </Text>
          ) : null}
        </View>

        {hasActiveStoreSubscription && storeManagementUrl ? (
          <CustomerShellActionButton
            testID="profile-delete-manage-store-action"
            label={`Manage in ${formatStoreLabel(billingSummary?.provider ?? 'none')}`}
            onPress={() => {
              void openStoreManagement();
            }}
            variant="secondary"
            disabled={deleteAccountMutation.isPending}
          />
        ) : null}

        {!isExpanded ? (
          <CustomerShellActionButton
            testID="profile-delete-expand-action"
            label="Review deletion"
            onPress={() => {
              setIsExpanded(true);
              setErrorText(null);
            }}
            variant="secondary"
            disabled={deleteAccountMutation.isPending}
          />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Type DELETE to confirm</Text>
            <TextInput
              testID="profile-delete-confirm-input"
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DELETE"
              placeholderTextColor={theme.muted}
              style={buildDeleteInputStyle(theme)}
            />
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
              This action cannot be undone. Your current app session will be cleared after deletion completes.
            </Text>
            {errorText ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{errorText}</Text> : null}
            <CustomerShellActionButton
              testID="profile-delete-submit-action"
              label={deleteAccountMutation.isPending ? 'Deleting...' : 'Delete account now'}
              onPress={() => {
                void handleDeleteAccount();
              }}
              disabled={!canSubmitDeletion}
            />
            <CustomerShellActionButton
              testID="profile-delete-cancel-action"
              label="Cancel"
              onPress={() => {
                setIsExpanded(false);
                setConfirmText('');
                setErrorText(null);
              }}
              variant="secondary"
              disabled={deleteAccountMutation.isPending}
            />
          </View>
        )}
      </View>
    </CustomerShellPanel>
  );
}

function buildDeleteInputStyle(theme: ReturnType<typeof useMobileBootstrap>['theme']) {
  return {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.stroke,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    color: theme.foreground,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  } as const;
}

function formatStoreLabel(provider: BillingSummaryV1['provider']) {
  if (provider === 'apple_app_store') {
    return 'App Store';
  }
  if (provider === 'google_play') {
    return 'Google Play';
  }
  return 'your store';
}
