import { useEffect, useState } from 'react';
import { Share as NativeShare, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiClientError, type AccountExportV1 } from '@tminuszero/api-client';
import {
  useAccountExportQuery,
  useDeleteAccountMutation,
  usePrivacyPreferencesQuery,
  useProfileQuery,
  useUpdatePrivacyPreferencesMutation,
  useViewerSessionQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import {
  AccountNotice,
  AccountTextField,
  AccountToggleRow
} from '@/src/features/account/AccountUi';
import { MOBILE_SUPPORT_EMAIL } from '@/src/features/account/constants';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function PrivacyChoicesScreen() {
  const router = useRouter();
  const { clearAuthedQueryState, clearSession } = useMobileBootstrap();
  const viewerSessionQuery = useViewerSessionQuery();
  const profileQuery = useProfileQuery();
  const privacyPreferencesQuery = usePrivacyPreferencesQuery();
  const accountExportQuery = useAccountExportQuery({
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
  const updatePrivacyPreferencesMutation = useUpdatePrivacyPreferencesMutation();
  const deleteAccountMutation = useDeleteAccountMutation();
  const [prefsMessage, setPrefsMessage] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [optOutSaleShare, setOptOutSaleShare] = useState(false);
  const [limitSensitive, setLimitSensitive] = useState(false);
  const [blockEmbeds, setBlockEmbeds] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const authStatus: 'loading' | 'authed' | 'guest' =
    viewerSessionQuery.isPending && !viewerSessionQuery.data
      ? 'loading'
      : viewerSessionQuery.data?.viewerId
        ? 'authed'
        : 'guest';

  useEffect(() => {
    if (!privacyPreferencesQuery.data) {
      return;
    }

    setOptOutSaleShare(privacyPreferencesQuery.data.optOutSaleShare);
    setLimitSensitive(privacyPreferencesQuery.data.limitSensitive);
    setBlockEmbeds(privacyPreferencesQuery.data.blockThirdPartyEmbeds);
  }, [privacyPreferencesQuery.data]);

  const accountExport = (accountExportQuery.data ?? null) as AccountExportV1 | null;

  async function savePreference(
    key: 'optOutSaleShare' | 'limitSensitive' | 'blockThirdPartyEmbeds',
    value: boolean
  ) {
    if (authStatus !== 'authed') {
      setPrefsError('Sign in to manage account privacy preferences.');
      return;
    }

    const previous = {
      optOutSaleShare,
      limitSensitive,
      blockThirdPartyEmbeds: blockEmbeds
    };

    setPrefsMessage(null);
    setPrefsError(null);

    if (key === 'optOutSaleShare') setOptOutSaleShare(value);
    if (key === 'limitSensitive') setLimitSensitive(value);
    if (key === 'blockThirdPartyEmbeds') setBlockEmbeds(value);

    try {
      await updatePrivacyPreferencesMutation.mutateAsync({ [key]: value });
      setPrefsMessage('Privacy preferences updated.');
    } catch (error) {
      setOptOutSaleShare(previous.optOutSaleShare);
      setLimitSensitive(previous.limitSensitive);
      setBlockEmbeds(previous.blockThirdPartyEmbeds);
      setPrefsError(toPrivacyMessage(error, 'Unable to save preferences.'));
    }
  }

  async function shareExport() {
    if (authStatus !== 'authed') {
      setRequestError('Sign in to export account data.');
      return;
    }

    setRequestMessage(null);
    setRequestError(null);

    try {
      const payload = (accountExportQuery.data ?? (await accountExportQuery.refetch()).data ?? null) as AccountExportV1 | null;
      if (!payload) {
        throw new Error('Export data is unavailable right now.');
      }
      await NativeShare.share({
        message: JSON.stringify(payload, null, 2)
      });
      setRequestMessage('Account export is ready to share.');
    } catch (error) {
      setRequestError(toPrivacyMessage(error, 'Unable to prepare account export.'));
    }
  }

  async function deleteAccount() {
    if (authStatus !== 'authed') {
      setRequestError('Sign in to delete your account.');
      return;
    }

    setRequestMessage(null);
    setRequestError(null);

    try {
      await deleteAccountMutation.mutateAsync(deleteConfirm);
      await clearSession();
      await clearAuthedQueryState();
      router.replace('/sign-in');
    } catch (error) {
      setRequestError(toDeleteAccountMessage(error));
    }
  }

  return (
    <AppScreen testID="privacy-choices-screen">
      <CustomerShellHero
        eyebrow="Privacy"
        title="Privacy Choices"
        description="Manage account-level privacy preferences, data export, and account deletion without leaving the native app."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={authStatus === 'authed' ? 'Signed in' : authStatus === 'loading' ? 'Loading' : 'Guest'} tone={authStatus === 'authed' ? 'success' : 'warning'} />
          <CustomerShellBadge label="Account controls" tone="accent" />
        </View>
      </CustomerShellHero>

      {authStatus === 'guest' ? (
        <CustomerShellPanel title="Sign in required" description="Privacy choices that affect your account are available after sign-in.">
          <CustomerShellActionButton
            label="Sign in"
            onPress={() => {
              router.push('/sign-in');
            }}
          />
        </CustomerShellPanel>
      ) : (
        <>
          <AccountNotice message={prefsMessage} tone="success" />
          <AccountNotice message={prefsError} tone="error" />
          <CustomerShellPanel
            title="Privacy preferences"
            description="These settings are saved to your account and used by the mobile app and other signed-in surfaces."
          >
            <View style={{ gap: 10 }}>
              <AccountToggleRow
                label="Opt out of sale or sharing"
                description="If state privacy laws apply, this preference records an account-level opt-out."
                enabled={optOutSaleShare}
                disabled={updatePrivacyPreferencesMutation.isPending || privacyPreferencesQuery.isPending}
                onPress={() => {
                  void savePreference('optOutSaleShare', !optOutSaleShare);
                }}
              />
              <AccountToggleRow
                label="Limit sensitive-data use"
                description="Record a state-law sensitive-data limitation request where applicable."
                enabled={limitSensitive}
                disabled={updatePrivacyPreferencesMutation.isPending || privacyPreferencesQuery.isPending}
                onPress={() => {
                  void savePreference('limitSensitive', !limitSensitive);
                }}
              />
              <AccountToggleRow
                label="Block third-party embeds"
                description="Disable third-party video/embed loading in supported experiences."
                enabled={blockEmbeds}
                disabled={updatePrivacyPreferencesMutation.isPending || privacyPreferencesQuery.isPending}
                onPress={() => {
                  void savePreference('blockThirdPartyEmbeds', !blockEmbeds);
                }}
              />
            </View>
          </CustomerShellPanel>

          <AccountNotice message={requestMessage} tone="success" />
          <AccountNotice message={requestError} tone="error" />
          <CustomerShellPanel
            title="Data export"
            description="Prepare your current account export and share it through the native share sheet."
          >
            <View style={{ gap: 10 }}>
              <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
                {accountExport?.generated_at
                  ? `Latest export payload generated ${formatDateTime(accountExport.generated_at)}.`
                  : 'The export payload is generated on request from the shared account export endpoint.'}
              </Text>
              <CustomerShellActionButton
                label={accountExportQuery.isFetching ? 'Preparing export…' : 'Share account export'}
                onPress={() => {
                  void shareExport();
                }}
                disabled={accountExportQuery.isFetching}
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel
            title="Delete account"
            description="Type DELETE to permanently remove your account. Active billing may need to be canceled first."
          >
            <View style={{ gap: 12 }}>
              <AccountTextField
                label="Delete confirmation"
                value={deleteConfirm}
                onChangeText={setDeleteConfirm}
                placeholder="Type DELETE"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <CustomerShellActionButton
                label={deleteAccountMutation.isPending ? 'Deleting…' : 'Delete my account'}
                variant="secondary"
                onPress={() => {
                  void deleteAccount();
                }}
                disabled={deleteAccountMutation.isPending || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
              />
            </View>
          </CustomerShellPanel>
        </>
      )}

      <CustomerShellPanel
        title="Contact"
        description={
          authStatus === 'authed'
            ? `Signed in as ${profileQuery.data?.email || viewerSessionQuery.data?.email || 'your account'}. For formal privacy requests or appeals, contact ${MOBILE_SUPPORT_EMAIL}.`
            : `For formal privacy requests or appeals, contact ${MOBILE_SUPPORT_EMAIL}.`
        }
      />
    </AppScreen>
  );
}

function toPrivacyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    if (error.code === 'unauthorized') return 'Sign in to manage account privacy preferences.';
    if (error.code === 'no_changes') return 'No changes to save.';
  }
  return error instanceof Error ? error.message : fallback;
}

function toDeleteAccountMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'confirm_required') return 'Type DELETE to confirm.';
    if (error.code === 'unauthorized') return 'Sign in to delete your account.';
    if (error.code === 'active_subscription') {
      return 'Cancel any active billing first, then retry account deletion.';
    }
    return error.code || 'Unable to delete account.';
  }
  return error instanceof Error ? error.message : 'Unable to delete account.';
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}
