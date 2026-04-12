import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthMethodV1 } from '@tminuszero/api-client';
import { getMobileViewerTier, isRecoveryOnlyViewer } from '@tminuszero/domain';
import { sharedQueryKeys } from '@tminuszero/query';
import { useAuthMethodsQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { isMobileAppleAuthEnabled } from '@/src/auth/appleAuth';
import {
  isSupabaseMobileAuthConfigured,
  linkAppleIdentityToCurrentSession,
  linkGoogleIdentityToCurrentSession,
  unlinkAppleIdentityFromCurrentSession,
  unlinkGoogleIdentityFromCurrentSession
} from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { AccountRecoveryOnlyScreen } from '@/src/features/account/AccountRecoveryOnlyScreen';
import { AccountDetailRow, AccountNotice } from '@/src/features/account/AccountUi';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

function findMethod(methods: AuthMethodV1[] | undefined, provider: AuthMethodV1['provider']) {
  return methods?.find((method) => method.provider === provider) ?? null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LoginMethodsScreen() {
  const queryClient = useQueryClient();
  const { accessToken, refreshToken, persistSession, theme } = useMobileBootstrap();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const authMethodsQuery = useAuthMethodsQuery();
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [busyAction, setBusyAction] = useState<'link_apple' | 'unlink_apple' | 'link_google' | 'unlink_google' | null>(null);

  const emailMethod = findMethod(authMethodsQuery.data?.methods, 'email_password');
  const googleMethod = findMethod(authMethodsQuery.data?.methods, 'google');
  const appleMethod = findMethod(authMethodsQuery.data?.methods, 'apple');
  const canManageAppleOnDevice = Platform.OS === 'ios' && isMobileAppleAuthEnabled();
  const canManageGoogleOnDevice = isSupabaseMobileAuthConfigured();
  const isAuthed = Boolean(accessToken);
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const isRecoveryOnly = isRecoveryOnlyViewer({ isAuthed, tier });
  const isLoading = isAuthed && authMethodsQuery.isPending && !authMethodsQuery.data;

  async function refreshAuthMethods() {
    await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.authMethods });
  }

  async function handleLinkApple() {
    if (!accessToken) {
      setNotice({ tone: 'warning', message: 'Sign in before linking another login method.' });
      return;
    }

    if (!canManageAppleOnDevice) {
      setNotice({ tone: 'warning', message: 'Sign in with Apple linking is available on iPhone only.' });
      return;
    }

    setBusyAction('link_apple');
    setNotice(null);
    try {
      const result = await linkAppleIdentityToCurrentSession({ accessToken, refreshToken });
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await refreshAuthMethods();
      setNotice({ tone: 'success', message: 'Sign in with Apple linked to this account.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'Unable to link Sign in with Apple.')
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUnlinkApple() {
    if (!accessToken) {
      setNotice({ tone: 'warning', message: 'Sign in before changing login methods.' });
      return;
    }

    setBusyAction('unlink_apple');
    setNotice(null);
    try {
      const result = await unlinkAppleIdentityFromCurrentSession({ accessToken, refreshToken });
      await persistSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      });
      await refreshAuthMethods();
      setNotice({ tone: 'success', message: 'Sign in with Apple removed from this account.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'Unable to remove Sign in with Apple.')
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLinkGoogle() {
    if (!accessToken) {
      setNotice({ tone: 'warning', message: 'Sign in before linking another login method.' });
      return;
    }

    if (!canManageGoogleOnDevice) {
      setNotice({ tone: 'warning', message: 'Google linking is not available in this build.' });
      return;
    }

    setBusyAction('link_google');
    setNotice(null);
    try {
      const result = await linkGoogleIdentityToCurrentSession({ accessToken, refreshToken });
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await refreshAuthMethods();
      setNotice({ tone: 'success', message: 'Google linked to this account.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'Unable to link Google.')
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUnlinkGoogle() {
    if (!accessToken) {
      setNotice({ tone: 'warning', message: 'Sign in before changing login methods.' });
      return;
    }

    setBusyAction('unlink_google');
    setNotice(null);
    try {
      const result = await unlinkGoogleIdentityFromCurrentSession({ accessToken, refreshToken });
      await persistSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      });
      await refreshAuthMethods();
      setNotice({ tone: 'success', message: 'Google removed from this account.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'Unable to remove Google.')
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (isRecoveryOnly) {
    return (
      <AccountRecoveryOnlyScreen
        title="Login Methods"
        description="Login-method management returns when Premium is active again. Membership recovery, privacy, and support stay available now."
      />
    );
  }

  return (
    <AppScreen testID="login-methods-screen">
      <CustomerShellHero
        eyebrow="Account"
        title="Login Methods"
        description="Manage the sign-in methods attached to this customer account on mobile."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Account security" tone="accent" />
          <CustomerShellBadge label={Platform.OS === 'ios' ? 'iPhone' : 'Android'} />
        </View>
      </CustomerShellHero>

      {notice ? <AccountNotice tone={notice.tone} message={notice.message} /> : null}

      {isLoading ? <Text style={{ color: theme.muted, fontSize: 14 }}>Loading…</Text> : null}

      {!isAuthed ? (
        <CustomerShellPanel title="Sign in required" description="A signed-in account is required before login methods can be managed on this device.">
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            Sign in first, then return here to link or remove Google or Sign in with Apple.
          </Text>
        </CustomerShellPanel>
      ) : null}

      {isAuthed ? (
        <>
          <CustomerShellPanel
            title="Policy"
            description="Same-email provider sign-ins may link automatically through Supabase. Apple private relay or different-email identities stay separate until you link them explicitly here."
          />

          <CustomerShellPanel title="Current methods" description="These rows show what is attached to the current customer account.">
            <View style={{ gap: 10 }}>
              <AccountDetailRow
                label="Email and password"
                value={emailMethod?.linked ? emailMethod.email || 'Linked' : 'Not linked'}
              />
              <AccountDetailRow label="Google" value={googleMethod?.linked ? googleMethod.email || 'Linked' : 'Not linked'} />
              <AccountDetailRow
                label="Sign in with Apple"
                value={
                  appleMethod?.linked
                    ? appleMethod.email
                      ? appleMethod.emailIsPrivateRelay
                        ? `${appleMethod.email} (private relay)`
                        : appleMethod.email
                      : 'Linked'
                    : 'Not linked'
                }
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Manage Google" description="Link Google to this account or remove it once another login method is available.">
            <View style={{ gap: 10 }}>
              {googleMethod?.linkedAt ? (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                  Linked on {formatDate(googleMethod.linkedAt)}.
                </Text>
              ) : null}

              {googleMethod?.linked && !googleMethod.canUnlink ? (
                <AccountNotice tone="warning" message="Add another sign-in method before removing Google." />
              ) : null}

              {!googleMethod?.linked ? (
                <CustomerShellActionButton
                  label={busyAction === 'link_google' ? 'Linking…' : 'Link Google'}
                  disabled={busyAction !== null || !canManageGoogleOnDevice}
                  onPress={() => {
                    void handleLinkGoogle();
                  }}
                />
              ) : null}

              {googleMethod?.linked ? (
                <CustomerShellActionButton
                  label={busyAction === 'unlink_google' ? 'Removing…' : 'Remove Google'}
                  variant="secondary"
                  disabled={busyAction !== null || !googleMethod.canUnlink}
                  onPress={() => {
                    void handleUnlinkGoogle();
                  }}
                />
              ) : null}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel
            title="Manage Apple"
            description={
              canManageAppleOnDevice
                ? 'Link Apple to this account on iPhone, or remove it once another login method is available.'
                : 'Apple linking stays iPhone-only. Android can still show the current link state.'
            }
          >
            <View style={{ gap: 10 }}>
              {appleMethod?.linkedAt ? (
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                  Linked on {formatDate(appleMethod.linkedAt)}.
                </Text>
              ) : null}

              {appleMethod?.linked && !appleMethod.canUnlink ? (
                <AccountNotice tone="warning" message="Add another sign-in method before removing Sign in with Apple." />
              ) : null}

              {!appleMethod?.linked ? (
                <CustomerShellActionButton
                  label={busyAction === 'link_apple' ? 'Linking…' : 'Link Sign in with Apple'}
                  disabled={busyAction !== null || !canManageAppleOnDevice}
                  onPress={() => {
                    void handleLinkApple();
                  }}
                />
              ) : null}

              {appleMethod?.linked ? (
                <CustomerShellActionButton
                  label={busyAction === 'unlink_apple' ? 'Removing…' : 'Remove Sign in with Apple'}
                  variant="secondary"
                  disabled={busyAction !== null || !appleMethod.canUnlink}
                  onPress={() => {
                    void handleUnlinkApple();
                  }}
                />
              ) : null}
            </View>
          </CustomerShellPanel>
        </>
      ) : null}
    </AppScreen>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
