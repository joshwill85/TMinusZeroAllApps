import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { getMobileViewerTier } from '@tminuszero/domain';
import {
  useAdminAccessOverrideQuery,
  useMarketingEmailQuery,
  useProfileQuery,
  useUpdateAdminAccessOverrideMutation,
  useUpdateMarketingEmailMutation,
  useUpdateProfileMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/src/api/queries';
import { resendSignupVerification } from '@/src/auth/supabaseAuth';
import { useNativeBilling } from '@/src/billing/useNativeBilling';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { MobileAccountDeletionPanel } from '@/src/components/MobileAccountDeletionPanel';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { getPublicSiteUrl } from '@/src/config/api';
import { AccountDetailRow, AccountNotice, AccountTextField } from '@/src/features/account/AccountUi';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function ProfileScreen() {
  const router = useRouter();
  const { accessToken, theme } = useMobileBootstrap();
  const callbackUrl = useMemo(() => `${getPublicSiteUrl()}/auth/callback`, []);
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const adminAccessOverrideQuery = useAdminAccessOverrideQuery();
  const profileQuery = useProfileQuery();
  const marketingEmailQuery = useMarketingEmailQuery();
  const updateAdminAccessOverrideMutation = useUpdateAdminAccessOverrideMutation();
  const updateProfileMutation = useUpdateProfileMutation();
  const updateMarketingEmailMutation = useUpdateMarketingEmailMutation();
  const billing = useNativeBilling(sessionQuery.data?.viewerId ?? null);
  const billingSummary = billing.billingSummaryQuery.data ?? null;
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const isAuthed = entitlementsQuery.data?.isAuthed ?? Boolean(accessToken);
  const profile = profileQuery.data ?? null;
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const email = profile?.email ?? sessionQuery.data?.email ?? null;
  const title = fullName ? fullName : isAuthed ? 'Your account' : 'Profile';
  const emailVerified = Boolean(profile?.emailConfirmedAt);
  const isAdminViewer = sessionQuery.data?.role === 'admin';
  const adminAccessOverride = adminAccessOverrideQuery.data?.adminAccessOverride ?? entitlementsQuery.data?.adminAccessOverride ?? null;
  const effectiveTierSource = entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = entitlementsQuery.data?.billingIsPaid === true;
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editTimezone, setEditTimezone] = useState('America/New_York');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState<boolean | null>(null);
  const [marketingMessage, setMarketingMessage] = useState<string | null>(null);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [adminAccessMessage, setAdminAccessMessage] = useState<string | null>(null);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const showStoreManagementAction = Boolean(
    billingSummary && billingSummary.isPaid && isStoreManagedBillingProvider(billingSummary.provider) && billingSummary.managementUrl
  );
  const showPurchaseAction = Boolean(billingSummary && !billingSummary.isPaid);
  const showRestoreAction = Boolean(billing.isStoreReady && (showStoreManagementAction || showPurchaseAction));

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

  async function updateAdminAccessOverride(next: 'anon' | 'premium' | null) {
    setAdminAccessMessage(null);
    setAdminAccessError(null);
    try {
      await updateAdminAccessOverrideMutation.mutateAsync({ adminAccessOverride: next });
      setAdminAccessMessage(
        next === null ? 'Default admin access restored.' : next === 'premium' ? 'Admin premium test mode is active.' : 'Admin free test mode is active.'
      );
    } catch (error) {
      setAdminAccessError(error instanceof Error ? error.message : 'Unable to update admin access.');
    }
  }

  return (
    <AppScreen testID="profile-screen">
      <CustomerShellHero
        eyebrow="Account"
        title={title}
        description={
          isAuthed
            ? 'Manage your identity, profile, privacy controls, integrations, and membership status natively.'
            : 'Browse freely, then sign in when you want account management, restore purchases, or Premium.'
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={formatTierLabel(tier)} tone={tier === 'premium' ? 'accent' : 'default'} />
          <CustomerShellBadge label={isAuthed ? 'Signed in' : 'Guest'} tone={isAuthed ? 'success' : 'warning'} />
          {sessionQuery.data?.role === 'admin' ? <CustomerShellBadge label="Admin" /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Account overview"
        description="Identity, access level, and billing status for the current viewer on this device."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric
            label="Access"
            value={formatTierLabel(tier, isAuthed)}
            caption={buildAccessCaption({
              isAuthed,
              effectiveTierSource,
              billingIsPaid
            })}
          />
          <CustomerShellMetric
            label="Billing"
            value={billingSummary ? formatBillingProvider(billingSummary.provider) : accessToken ? 'Loading…' : '—'}
            caption={billingSummary ? formatBillingStatus(billingSummary.status) : 'Store or web billing state'}
          />
          <CustomerShellMetric
            label="Renewal"
            value={entitlementsQuery.data?.currentPeriodEnd ? formatDate(entitlementsQuery.data.currentPeriodEnd) : '—'}
            caption="Current period end"
          />
        </View>
      </CustomerShellPanel>

      {isAdminViewer ? (
        <CustomerShellPanel
          title="Admin access testing"
          description="Switch this admin account between free and premium customer access. Billing and admin tools stay unchanged."
        >
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <CustomerShellMetric label="Current access" value={tier === 'premium' ? 'Premium' : 'Free'} caption={formatEffectiveTierSource(effectiveTierSource)} />
              <CustomerShellMetric label="Real billing" value={billingIsPaid ? 'Active' : 'Inactive'} caption="Store or web subscription state" />
            </View>
            <CustomerShellActionButton
              label={adminAccessOverride === null ? 'Using default' : 'Use default'}
              variant={adminAccessOverride === null ? 'primary' : 'secondary'}
              disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
              onPress={() => {
                void updateAdminAccessOverride(null);
              }}
            />
            <CustomerShellActionButton
              label={adminAccessOverride === 'anon' ? 'Free mode active' : 'Switch to free'}
              variant={adminAccessOverride === 'anon' ? 'primary' : 'secondary'}
              disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
              onPress={() => {
                void updateAdminAccessOverride('anon');
              }}
            />
            <CustomerShellActionButton
              label={adminAccessOverride === 'premium' ? 'Premium mode active' : 'Switch to premium'}
              variant={adminAccessOverride === 'premium' ? 'primary' : 'secondary'}
              disabled={adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending}
              onPress={() => {
                void updateAdminAccessOverride('premium');
              }}
            />
            {adminAccessMessage ? <Text style={{ color: '#7ff0bc', fontSize: 13, lineHeight: 19 }}>{adminAccessMessage}</Text> : null}
            {adminAccessError ? <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{adminAccessError}</Text> : null}
          </View>
        </CustomerShellPanel>
      ) : null}

      <ViewerTierCard tier={tier} isAuthed={isAuthed} showAction={tier !== 'premium'} testID="profile-tier-card" />
      <AccountNotice message={accountMessage} tone="success" />

      {!isAuthed ? (
        <>
          <CustomerShellPanel
            testID="profile-entitlements-section"
            title="Membership"
            description="Mobile browsing, filters, the calendar, and basic reminders are available without paying. Premium adds follows, saved views, recurring feeds, and advanced alerts."
          >
            <Text testID="profile-entitlements-tier" style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
              {formatTierLabel(tier)}
            </Text>
          </CustomerShellPanel>

          <CustomerShellPanel
            title={billing.claim ? 'Claim Premium' : 'Premium'}
            description={
              billing.claim
                ? 'Your store purchase is verified. Sign in to an existing account or create one now to claim Premium on this device.'
                : 'Buy Premium first, then sign in or create an account to claim it on this device.'
            }
          >
            <View style={{ gap: 10 }}>
              {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 14, lineHeight: 21 }}>{billing.actionMessage}</Text> : null}
              {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{billing.actionError}</Text> : null}
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                {billing.claim ? 'Claiming Premium links the verified purchase to a T-Minus Zero account for ownership, recovery, and restore.' : buildBillingMessage('none', false, billing.isStoreReady)}
              </Text>
              {billing.claim ? (
                <>
                  <CustomerShellActionButton
                    label="Sign in to claim Premium"
                    onPress={() => {
                      router.push(buildClaimAuthHref('/sign-in', billing.claim?.claimToken, billing.claim?.returnTo));
                    }}
                  />
                  <CustomerShellActionButton
                    label="Create account to claim Premium"
                    variant="secondary"
                    onPress={() => {
                      router.push(buildClaimAuthHref('/sign-up', billing.claim?.claimToken, billing.claim?.returnTo));
                    }}
                  />
                </>
              ) : (
                <>
                  <CustomerShellActionButton
                    label={billing.isProcessingPurchase ? 'Working…' : 'Unlock Premium'}
                    onPress={() => {
                      void billing.requestSubscription();
                    }}
                    disabled={billing.isProcessingPurchase || !billing.isStoreReady}
                  />
                  <CustomerShellActionButton
                    label="Restore purchases"
                    variant="secondary"
                    onPress={() => {
                      void billing.restorePurchases();
                    }}
                    disabled={billing.isProcessingPurchase || !billing.isStoreReady}
                  />
                  <CustomerShellActionButton
                    label="Sign in"
                    variant="secondary"
                    onPress={() => {
                      router.push('/sign-in');
                    }}
                  />
                </>
              )}
            </View>
          </CustomerShellPanel>
        </>
      ) : profileQuery.isPending ? (
        <CustomerShellPanel title="Loading profile" description="Fetching your account details." />
      ) : profileQuery.isError ? (
        <CustomerShellPanel title="Profile unavailable" description={profileQuery.error.message} />
      ) : (
        <>
          <CustomerShellPanel testID="profile-data-section" title="Profile details" description="Your account identity synced to this device.">
            <View style={{ gap: 10 }}>
              <AccountDetailRow testID="profile-display-name" label="Name" value={fullName || 'Name not set'} />
              <AccountDetailRow testID="profile-email" label="Email" value={profile?.email || '—'} />
              <AccountDetailRow label="Email verified" value={emailVerified ? 'Yes' : 'No'} />
              <AccountDetailRow label="Timezone" value={profile?.timezone || 'America/New_York'} />
            </View>
          </CustomerShellPanel>

          <AccountNotice message={profileMessage} tone="success" />
          <AccountNotice message={profileError} tone="error" />
          <CustomerShellPanel title="Update profile" description="Edit the shared account fields used across supported surfaces.">
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
          </CustomerShellPanel>

          {!emailVerified ? (
            <>
              <AccountNotice message={resendMessage} tone="success" />
              <AccountNotice message={resendError} tone="error" />
              <CustomerShellPanel title="Email verification" description="Verify your email to keep account recovery and account security flows healthy.">
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
                </View>
              </CustomerShellPanel>
            </>
          ) : null}

          <AccountNotice message={marketingMessage} tone="success" />
          <AccountNotice message={marketingError} tone="error" />
          <CustomerShellPanel title="Communication preferences" description="Manage marketing email preferences and jump into alert or privacy settings.">
            <View style={{ gap: 10 }}>
              <AccountDetailRow
                label="Marketing emails"
                value={marketingEmailOptIn == null ? 'Loading…' : marketingEmailOptIn ? 'Enabled' : 'Disabled'}
              />
              <CustomerShellActionButton
                label={
                  marketingEmailOptIn == null
                    ? 'Loading…'
                    : marketingEmailOptIn
                      ? 'Disable marketing emails'
                      : 'Enable marketing emails'
                }
                onPress={() => {
                  if (marketingEmailOptIn == null) return;
                  void toggleMarketingEmail(!marketingEmailOptIn);
                }}
                disabled={marketingEmailOptIn == null || updateMarketingEmailMutation.isPending}
              />
              <CustomerShellActionButton
                label="Open alert settings"
                variant="secondary"
                onPress={() => {
                  router.push('/preferences');
                }}
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel testID="profile-entitlements-section" title="Membership" description="Your current access tier, source, and renewal state.">
            <View style={{ gap: 10 }}>
              <AccountDetailRow testID="profile-entitlements-tier" label="Tier" value={formatTierLabel(tier)} />
              <AccountDetailRow label="Status" value={formatBillingStatus(entitlementsQuery.data?.status || 'unknown')} />
              <AccountDetailRow label="Source" value={formatBillingProvider(entitlementsQuery.data?.source || 'none')} />
              {entitlementsQuery.data?.currentPeriodEnd ? (
                <AccountDetailRow label="Current period end" value={formatDate(entitlementsQuery.data.currentPeriodEnd)} />
              ) : null}
            </View>
          </CustomerShellPanel>

          {billing.billingSummaryQuery.isPending ? (
            <CustomerShellPanel title="Billing" description="Loading provider-aware billing status." />
          ) : billing.billingSummaryQuery.isError ? (
            <CustomerShellPanel title="Billing unavailable" description={billing.billingSummaryQuery.error.message} />
          ) : billingSummary ? (
            <CustomerShellPanel
              testID="profile-billing-section"
              title="Billing"
              description="Manage your current plan and purchase status on this device."
            >
              <View style={{ gap: 10 }}>
                <AccountDetailRow
                  testID="profile-billing-provider"
                  label="Provider"
                  value={billingSummary.provider === 'none' ? 'No active Premium billing' : formatBillingProvider(billingSummary.provider)}
                />
                <AccountDetailRow testID="profile-billing-status" label="Status" value={formatBillingStatus(billingSummary.status)} />
                <AccountDetailRow testID="profile-billing-paid-access" label="Paid access" value={billingSummary.isPaid ? 'Yes' : 'No'} />
                {billingSummary.currentPeriodEnd ? (
                  <AccountDetailRow label="Current period end" value={formatDate(billingSummary.currentPeriodEnd)} />
                ) : null}
                {billingSummary.providerMessage ? (
                  <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{billingSummary.providerMessage}</Text>
                ) : null}
                {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 14, lineHeight: 21 }}>{billing.actionMessage}</Text> : null}
                {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{billing.actionError}</Text> : null}
              </View>

              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                {buildBillingMessage(billingSummary.provider, billingSummary.isPaid, billing.isStoreReady)}
              </Text>

              {showStoreManagementAction || showPurchaseAction ? (
                <CustomerShellActionButton
                  testID="profile-billing-primary-action"
                  label={
                    billing.isProcessingPurchase
                      ? 'Working…'
                      : showStoreManagementAction
                        ? `Manage in ${formatManagementProviderLabel(billingSummary.provider)}`
                        : 'Unlock Premium'
                  }
                  onPress={() => {
                    if (showStoreManagementAction && billingSummary.managementUrl) {
                      void billing.openManagementLink(billingSummary.managementUrl);
                      return;
                    }
                    void billing.requestSubscription();
                  }}
                  disabled={billing.isProcessingPurchase || (showStoreManagementAction ? !billingSummary.managementUrl : !billing.isStoreReady)}
                />
              ) : null}

              {showRestoreAction ? (
                <CustomerShellActionButton
                  testID="profile-billing-restore-action"
                  label="Restore purchases"
                  variant="secondary"
                  onPress={() => {
                    void billing.restorePurchases();
                  }}
                  disabled={billing.isProcessingPurchase}
                />
              ) : null}
            </CustomerShellPanel>
          ) : null}

          <MobileAccountDeletionPanel
            billingSummary={billingSummary}
            onDeleted={(message) => {
              setAccountMessage(message);
            }}
          />

          <CustomerShellPanel title="Account tools" description="Open the remaining customer account surfaces that now stay native on mobile.">
            <View style={{ gap: 10 }}>
              <CustomerShellActionButton label="Saved items" onPress={() => router.push('/saved')} />
              <CustomerShellActionButton label="Integrations" variant="secondary" onPress={() => router.push('/account/integrations' as Href)} />
              <CustomerShellActionButton label="Privacy choices" variant="secondary" onPress={() => router.push('/legal/privacy-choices' as Href)} />
              <CustomerShellActionButton label="Privacy notice" variant="secondary" onPress={() => router.push('/legal/privacy' as Href)} />
              <CustomerShellActionButton label="Terms of service" variant="secondary" onPress={() => router.push('/legal/terms' as Href)} />
            </View>
          </CustomerShellPanel>
        </>
      )}
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

function formatTierLabel(tier: 'anon' | 'premium', isAuthed = false) {
  if (tier === 'premium') {
    return 'Premium';
  }
  return isAuthed ? 'Signed in' : 'Public';
}

function buildAccessCaption({
  isAuthed,
  effectiveTierSource,
  billingIsPaid
}: {
  isAuthed: boolean;
  effectiveTierSource: string;
  billingIsPaid: boolean;
}) {
  if (effectiveTierSource === 'admin_override') {
    return 'Admin test mode is active';
  }
  if (effectiveTierSource === 'admin') {
    return 'Admin premium access is active';
  }
  if (billingIsPaid || effectiveTierSource === 'subscription') {
    return 'Premium is active';
  }
  return isAuthed ? 'Premium available' : 'Public access';
}

function formatEffectiveTierSource(value: string) {
  if (value === 'admin_override') {
    return 'Manual override';
  }
  if (value === 'admin') {
    return 'Admin default';
  }
  if (value === 'subscription') {
    return 'Paid subscription';
  }
  if (value === 'free') {
    return 'Signed in without Premium';
  }
  return 'Guest';
}

function formatBillingProvider(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatBillingStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isStoreManagedBillingProvider(value: string) {
  return value === 'apple_app_store' || value === 'google_play';
}

function formatManagementProviderLabel(value: string) {
  if (value === 'apple_app_store') {
    return 'App Store';
  }
  if (value === 'google_play') {
    return 'Google Play';
  }
  return 'store';
}

function buildBillingMessage(provider: string, isPaid: boolean, isStoreReady: boolean) {
  if (provider === 'stripe' && isPaid) {
    return 'This subscription is billed on the web. Billing changes are not available inside the iOS or Android app.';
  }
  if (provider === 'apple_app_store' && isPaid) {
    return 'Manage or cancel this subscription in the App Store.';
  }
  if (provider === 'google_play' && isPaid) {
    return 'Manage or cancel this subscription in Google Play.';
  }
  if (isStoreReady) {
    return 'Native billing is available on this device.';
  }
  return 'Store billing is not available for this platform or current build configuration yet.';
}

function buildClaimAuthHref(pathname: '/sign-in' | '/sign-up', claimToken: string | null | undefined, returnTo: string | null | undefined) {
  const params = new URLSearchParams();
  if (claimToken) {
    params.set('claim_token', claimToken);
  }
  if (returnTo) {
    params.set('return_to', returnTo);
  }
  params.set('intent', 'upgrade');
  return `${pathname}?${params.toString()}` as Href;
}
