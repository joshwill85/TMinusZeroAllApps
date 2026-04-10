import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMarketingEmailQuery, useProfileQuery, useUpdateMarketingEmailMutation, useUpdateProfileMutation, useViewerSessionQuery } from '@/src/api/queries';
import { resendSignupVerification } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellActionButton, CustomerShellBadge, CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';
import { getPublicSiteUrl } from '@/src/config/api';
import { AccountDetailRow, AccountNotice, AccountTextField, AccountToggleRow } from '@/src/features/account/AccountUi';
import { formatDate } from '@/src/features/account/ProfileScreenUi';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function AccountPersonalScreen() {
  const router = useRouter();
  const { accessToken, theme } = useMobileBootstrap();
  const callbackUrl = useMemo(() => {
    const url = new URL('/auth/callback', getPublicSiteUrl());
    url.searchParams.set('return_to', '/');
    return url.toString();
  }, []);
  const sessionQuery = useViewerSessionQuery();
  const profileQuery = useProfileQuery();
  const marketingEmailQuery = useMarketingEmailQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const updateMarketingEmailMutation = useUpdateMarketingEmailMutation();

  const isAuthed = Boolean(sessionQuery.data?.viewerId ?? accessToken);
  const profile = profileQuery.data ?? null;
  const email = profile?.email ?? sessionQuery.data?.email ?? null;
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const emailVerified = Boolean(profile?.emailConfirmedAt);

  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editTimezone, setEditTimezone] = useState('America/New_York');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState<boolean | null>(null);
  const [marketingMessage, setMarketingMessage] = useState<string | null>(null);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setEditFirstName(profile.firstName || '');
    setEditLastName(profile.lastName || '');
    setEditTimezone(profile.timezone || 'America/New_York');
  }, [profile]);

  useEffect(() => {
    if (!marketingEmailQuery.data) return;
    setMarketingEmailOptIn(marketingEmailQuery.data.marketingEmailOptIn);
  }, [marketingEmailQuery.data]);

  const profileFirstName = String(profile?.firstName || '').trim();
  const profileLastName = String(profile?.lastName || '').trim();
  const profileTimezone = String(profile?.timezone || 'America/New_York').trim();
  const nextFirstName = editFirstName.trim();
  const nextLastName = editLastName.trim();
  const nextTimezone = editTimezone.trim();
  const hasBlankedExistingName =
    (profileFirstName.length > 0 && nextFirstName.length === 0) || (profileLastName.length > 0 && nextLastName.length === 0);
  const hasProfileChanges =
    nextFirstName !== profileFirstName || nextLastName !== profileLastName || nextTimezone !== profileTimezone;
  const canSaveProfile = Boolean(
    isAuthed && nextTimezone && hasProfileChanges && !hasBlankedExistingName && !updateProfileMutation.isPending
  );

  async function saveProfile() {
    if (!canSaveProfile) {
      if (hasBlankedExistingName) {
        setProfileError('First and last name cannot be cleared once set.');
      }
      return;
    }

    const payload: { firstName?: string; lastName?: string; timezone?: string } = {};
    if (nextFirstName && nextFirstName !== profileFirstName) payload.firstName = nextFirstName;
    if (nextLastName && nextLastName !== profileLastName) payload.lastName = nextLastName;
    if (nextTimezone !== profileTimezone) payload.timezone = nextTimezone;

    setProfileMessage(null);
    setProfileError(null);
    try {
      const nextProfile = await updateProfileMutation.mutateAsync(payload);
      setEditFirstName(nextProfile.firstName || '');
      setEditLastName(nextProfile.lastName || '');
      setEditTimezone(nextProfile.timezone || 'America/New_York');
      setProfileMessage('Profile updated.');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Unable to update profile.');
    }
  }

  async function toggleMarketingEmail(next: boolean) {
    if (!isAuthed) {
      setMarketingError('Sign in to update marketing email preferences.');
      return;
    }

    const previous = marketingEmailOptIn;
    setMarketingEmailOptIn(next);
    setMarketingMessage(null);
    setMarketingError(null);
    try {
      const payload = await updateMarketingEmailMutation.mutateAsync(next);
      setMarketingEmailOptIn(payload.marketingEmailOptIn);
      setMarketingMessage(
        payload.marketingEmailOptIn
          ? 'Marketing emails enabled.'
          : 'Marketing emails disabled. Essential account emails will still be sent.'
      );
    } catch (error) {
      setMarketingEmailOptIn(previous);
      setMarketingError(error instanceof Error ? error.message : 'Unable to update marketing email settings.');
    }
  }

  async function resendVerificationEmail() {
    if (!email) {
      return;
    }

    setResendingEmail(true);
    setResendMessage(null);
    setResendError(null);
    try {
      await resendSignupVerification(email, callbackUrl);
      setResendMessage(`Verification email resent to ${email}.`);
    } catch (error) {
      setResendError(error instanceof Error ? error.message : 'Unable to resend verification email.');
    } finally {
      setResendingEmail(false);
    }
  }

  return (
    <AppScreen testID="account-personal-screen">
      <CustomerShellHero
        eyebrow="Account"
        title="Personal Info"
        description="Update the shared account fields used across web, iPhone, and Android."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={isAuthed ? 'Signed in' : 'Guest'} tone={isAuthed ? 'success' : 'warning'} />
          {emailVerified ? <CustomerShellBadge label="Verified" tone="accent" /> : null}
        </View>
      </CustomerShellHero>

      {!isAuthed ? (
        <CustomerShellPanel title="Sign in required" description="Sign in to edit profile fields, resend verification, and manage account email preferences.">
          <CustomerShellActionButton
            label="Sign in"
            onPress={() => {
              router.push('/sign-in');
            }}
          />
        </CustomerShellPanel>
      ) : profileQuery.isPending ? (
        <CustomerShellPanel title="Loading profile" description="Fetching your account details." />
      ) : profileQuery.isError ? (
        <CustomerShellPanel title="Profile unavailable" description={profileQuery.error.message} />
      ) : (
        <>
          <CustomerShellPanel title="Current profile" description="This summary reflects the account identity currently attached to this device.">
            <View style={{ gap: 10 }}>
              <AccountDetailRow label="Name" value={fullName || 'Name not set'} />
              <AccountDetailRow label="Email" value={email || '—'} />
              <AccountDetailRow label="Email verified" value={emailVerified ? 'Yes' : 'No'} />
              <AccountDetailRow label="Timezone" value={profile?.timezone || 'America/New_York'} />
              <AccountDetailRow label="Member since" value={profile?.createdAt ? formatDate(profile.createdAt) : '—'} />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Update profile" description="Keep account identity fields current without changing billing or alerts.">
            <View style={{ gap: 12 }}>
              <AccountTextField label="First name" value={editFirstName} onChangeText={setEditFirstName} placeholder="First name" />
              <AccountTextField label="Last name" value={editLastName} onChangeText={setEditLastName} placeholder="Last name" />
              <AccountTextField
                label="Timezone (IANA)"
                value={editTimezone}
                onChangeText={setEditTimezone}
                placeholder="America/New_York"
                autoCapitalize="none"
              />
              <CustomerShellActionButton
                label={updateProfileMutation.isPending ? 'Saving…' : 'Save profile'}
                onPress={() => {
                  void saveProfile();
                }}
                disabled={!canSaveProfile}
              />
            </View>

            {hasBlankedExistingName ? <AccountNotice message="First and last name cannot be cleared once set." tone="warning" /> : null}
            <AccountNotice message={profileMessage} tone="success" />
            <AccountNotice message={profileError} tone="error" />
          </CustomerShellPanel>

          {!emailVerified ? (
            <CustomerShellPanel
              title="Email verification"
              description="Verify your email to keep account recovery and security flows working correctly."
            >
              <View style={{ gap: 10 }}>
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                  We sent a verification email to {email || 'your account email'}. Open the link on this device to finish verification.
                </Text>
                <CustomerShellActionButton
                  label={resendingEmail ? 'Sending…' : 'Resend verification email'}
                  onPress={() => {
                    void resendVerificationEmail();
                  }}
                  disabled={resendingEmail || !email}
                />
                <AccountNotice message={resendMessage} tone="success" />
                <AccountNotice message={resendError} tone="error" />
              </View>
            </CustomerShellPanel>
          ) : null}

          <CustomerShellPanel
            title="Marketing emails"
            description="Optional product updates and occasional offers. Essential account and security emails still send when needed."
          >
            <View style={{ gap: 10 }}>
              <AccountToggleRow
                label="Marketing emails"
                description="Turn optional marketing updates on or off for this account."
                enabled={marketingEmailOptIn === true}
                disabled={marketingEmailOptIn == null || updateMarketingEmailMutation.isPending}
                onPress={() => {
                  if (marketingEmailOptIn == null) return;
                  void toggleMarketingEmail(!marketingEmailOptIn);
                }}
              />
              <AccountNotice message={marketingMessage} tone="success" />
              <AccountNotice message={marketingError} tone="error" />
            </View>
          </CustomerShellPanel>
        </>
      )}
    </AppScreen>
  );
}
