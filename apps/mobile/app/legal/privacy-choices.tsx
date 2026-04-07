import { useState } from 'react';
import { Linking, Share as NativeShare, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { AccountExportV1 } from '@tminuszero/api-client';
import {
  useAccountExportQuery,
  useDeleteAccountMutation,
  useProfileQuery,
  useViewerSessionQuery
} from '@/src/api/queries';
import { prepareAppleAccountDeletion, describeMobileAccountDeletionError } from '@/src/auth/appleAccountDeletion';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import {
  AccountNotice,
  AccountTextField
} from '@/src/features/account/AccountUi';
import { getPublicSiteUrl } from '@/src/config/api';
import { MOBILE_SUPPORT_EMAIL } from '@/src/features/account/constants';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function PrivacyChoicesScreen() {
  const router = useRouter();
  const { accessToken, clearAuthedQueryState, clearSession } = useMobileBootstrap();
  const publicSiteUrl = getPublicSiteUrl();
  const viewerSessionQuery = useViewerSessionQuery();
  const profileQuery = useProfileQuery();
  const accountExportQuery = useAccountExportQuery({
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
  const deleteAccountMutation = useDeleteAccountMutation();
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const authStatus: 'loading' | 'authed' | 'guest' =
    viewerSessionQuery.isPending && !viewerSessionQuery.data
      ? 'loading'
      : viewerSessionQuery.data?.viewerId
        ? 'authed'
        : 'guest';

  const accountExport = (accountExportQuery.data ?? null) as AccountExportV1 | null;

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
      setRequestError(error instanceof Error ? error.message : 'Unable to prepare account export.');
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
      await prepareAppleAccountDeletion(accessToken);
      await deleteAccountMutation.mutateAsync(deleteConfirm);
      await clearSession();
      await clearAuthedQueryState();
      router.replace('/sign-in');
    } catch (error) {
      setRequestError(describeMobileAccountDeletionError(error));
    }
  }

  return (
    <AppScreen testID="privacy-choices-screen">
      <CustomerShellHero
        eyebrow="Privacy"
        title="Privacy Choices"
        description="Use the native app for account export and deletion, and use the web for browser-specific media and cookie controls."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={authStatus === 'authed' ? 'Signed in' : authStatus === 'loading' ? 'Loading' : 'Guest'} tone={authStatus === 'authed' ? 'success' : 'warning'} />
          <CustomerShellBadge label="Account controls" tone="accent" />
          <CustomerShellBadge label="Web media controls" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Web media and browser controls"
        description="Browser cookie and third-party media controls apply on the website, not inside the native app."
      >
        <View style={{ gap: 10 }}>
          <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
            The current website does not use a broad analytics or advertising cookie banner. Embedded X posts still require an explicit load, while supported launch video players can load
            automatically unless the web external-media preference blocks them.
          </Text>
          <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
            If you want to keep supported third-party media external-only in the browser, use the web Privacy Choices page.
          </Text>
          <CustomerShellActionButton
            label="Open web privacy choices"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(`${publicSiteUrl}/legal/privacy-choices`);
            }}
          />
        </View>
      </CustomerShellPanel>

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
            description="Type DELETE to permanently remove your account. Active billing may need to be canceled first, and Sign in with Apple accounts may require a final Apple re-auth step."
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
