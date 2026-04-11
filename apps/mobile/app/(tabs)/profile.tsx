import { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { getMobileViewerTier } from '@tminuszero/domain';
import { useProfileQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { signOut } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellActionButton, CustomerShellBadge, CustomerShellHero, CustomerShellMetric, CustomerShellPanel } from '@/src/components/CustomerShell';
import { AccountDetailRow, AccountNavRow, AccountNotice } from '@/src/features/account/AccountUi';
import {
  buildAccessCaption,
  buildMembershipStatusCaption,
  formatDate,
  formatMembershipStatusLabel,
  formatTierLabel
} from '@/src/features/account/ProfileScreenUi';
import { useMobilePush } from '@/src/providers/MobilePushProvider';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function ProfileScreen() {
  const router = useRouter();
  const { accessToken, clearSession } = useMobileBootstrap();
  const { permissionStatus, isPushEnabled, isRegistered } = useMobilePush();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();

  const isAuthed = entitlementsQuery.data?.isAuthed ?? Boolean(accessToken);
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const effectiveTierSource = entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = entitlementsQuery.data?.billingIsPaid === true;
  const membershipStatusLabel = formatMembershipStatusLabel({
    tier,
    effectiveTierSource,
    status: entitlementsQuery.data?.status ?? null,
    cancelAtPeriodEnd: entitlementsQuery.data?.cancelAtPeriodEnd ?? false
  });
  const membershipStatusCaption = buildMembershipStatusCaption({
    tier,
    isAuthed,
    effectiveTierSource,
    currentPeriodEnd: entitlementsQuery.data?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: entitlementsQuery.data?.cancelAtPeriodEnd ?? false
  });
  const profile = profileQuery.data ?? null;
  const summaryName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const summaryEmail = profile?.email ?? sessionQuery.data?.email ?? '—';
  const emailVerified = Boolean(profile?.emailConfirmedAt);
  const alertStatusLabel = isPushEnabled ? 'On' : permissionStatus === 'granted' ? (isRegistered ? 'Ready' : 'Pending') : 'Off';

  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut(accessToken).catch(() => undefined);
      await clearSession();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <AppScreen testID="profile-screen">
      <CustomerShellHero
        eyebrow="Account"
        title="Account"
        description={
          isAuthed
            ? 'Account, billing, alerts, privacy, and support now live in dedicated sections instead of one long mixed screen.'
            : 'Browse freely, then sign in when you want to manage account details, claim Premium, or restore purchases.'
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={formatTierLabel(tier, isAuthed)} tone={tier === 'premium' ? 'accent' : 'default'} />
          <CustomerShellBadge label={isAuthed ? 'Signed in' : 'Guest'} tone={isAuthed ? 'success' : 'warning'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Account summary" description="One summary block for identity, access, and renewal state on this device.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric
            label="Access"
            value={formatTierLabel(tier, isAuthed)}
            caption={buildAccessCaption({
              tier,
              isAuthed,
              effectiveTierSource,
              billingIsPaid
            })}
          />
          <CustomerShellMetric label="Membership" value={membershipStatusLabel} caption={membershipStatusCaption} />
          <CustomerShellMetric
            label="Renewal"
            value={entitlementsQuery.data?.currentPeriodEnd ? formatDate(entitlementsQuery.data.currentPeriodEnd) : '—'}
            caption="Current period end"
          />
        </View>

        <View style={{ gap: 10 }}>
          <AccountDetailRow label="Name" value={summaryName || 'Name not set'} />
          <AccountDetailRow label="Email" value={summaryEmail} />
          {isAuthed ? <AccountDetailRow label="Email verified" value={emailVerified ? 'Yes' : 'No'} /> : null}
        </View>
      </CustomerShellPanel>

      {!isAuthed ? (
        <>
          <CustomerShellPanel title="Start here" description="Use a smaller set of focused destinations instead of managing everything from the root account screen.">
            <View style={{ gap: 10 }}>
              <AccountNavRow
                title="Membership & billing"
                description="Premium purchase, restore, claim, and subscription management on mobile."
                value={formatTierLabel(tier, isAuthed)}
                onPress={() => {
                  router.push('/account/membership' as Href);
                }}
              />
              <AccountNavRow
                title="Alerts"
                description="Push permissions, device registration, and mobile launch alert rules."
                value="Mobile only"
                onPress={() => {
                  router.push('/preferences' as Href);
                }}
              />
              <AccountNavRow
                title="Support & legal"
                description="Account help plus privacy and terms links."
                onPress={() => {
                  router.push('/support' as Href);
                }}
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellActionButton
            label="Sign in"
            onPress={() => {
              router.push('/sign-in');
            }}
          />
        </>
      ) : (
        <>
          <CustomerShellPanel title="Identity & security" description="Profile fields and authentication methods for this customer account.">
            <View style={{ gap: 10 }}>
              <AccountNavRow
                title="Personal info"
                description="Name, email verification, timezone, and marketing email preferences."
                value={summaryName || summaryEmail}
                onPress={() => {
                  router.push('/account/personal' as Href);
                }}
              />
              <AccountNavRow
                title="Login methods"
                description="Email/password, Google, and Sign in with Apple management for this account."
                onPress={() => {
                  router.push('/account/login-methods' as Href);
                }}
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Membership & billing" description="Keep plan status, renewal timing, and billing actions in one owned destination.">
            <AccountNavRow
              title="Membership & billing"
              description="Plan, renewal, restore, and provider-aware billing management."
              value={membershipStatusLabel}
              onPress={() => {
                router.push('/account/membership' as Href);
              }}
            />
          </CustomerShellPanel>

          <CustomerShellPanel title="Communications & alerts" description="Marketing email stays account-wide while push stays device-specific.">
            <AccountNavRow
              title="Alerts"
              description="Push permissions, device registration, and mobile launch alert rules."
              value={alertStatusLabel}
              onPress={() => {
                router.push('/preferences' as Href);
              }}
            />
          </CustomerShellPanel>

          <CustomerShellPanel title="Launch tools" description="Saved items already have their own tab. Premium integrations stay in a dedicated account destination.">
            <AccountNavRow
              title="Integrations"
              description="Recurring calendar feeds, RSS feeds, and next-launch widgets."
              value="Premium"
              onPress={() => {
                router.push('/account/integrations' as Href);
              }}
            />
          </CustomerShellPanel>

          <CustomerShellPanel title="Privacy & data" description="Keep export, deletion, and embed privacy preferences together in one place.">
            <AccountNavRow
              title="Privacy choices & data requests"
              description="Export account data, delete your account, and manage media-loading privacy preferences."
              value="Export + delete"
              onPress={() => {
                router.push('/legal/privacy-choices' as Href);
              }}
            />
          </CustomerShellPanel>

          <CustomerShellPanel title="Support & legal" description="Account help, billing help, and the linked legal summaries for mobile.">
            <AccountNavRow
              title="Support"
              description="Contact support and open privacy or terms links from one place."
              onPress={() => {
                router.push('/support' as Href);
              }}
            />
          </CustomerShellPanel>
          <AccountNotice message={signOutError} tone="error" />
          <CustomerShellActionButton
            label={isSigningOut ? 'Signing out…' : 'Sign out'}
            variant="secondary"
            onPress={() => {
              void handleSignOut();
            }}
            disabled={isSigningOut}
          />
        </>
      )}
    </AppScreen>
  );
}
