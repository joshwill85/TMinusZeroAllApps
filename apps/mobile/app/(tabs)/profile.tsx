import { Text, View } from 'react-native';
import { useProfileQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { useNativeBilling } from '@/src/billing/useNativeBilling';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { ViewerTierCard } from '@/src/components/ViewerTierCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function ProfileScreen() {
  const { accessToken, theme } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();
  const billing = useNativeBilling(sessionQuery.data?.viewerId ?? null);
  const billingSummary = billing.billingSummaryQuery.data ?? null;
  const tier = entitlementsQuery.data?.tier ?? 'anon';
  const isAuthed = entitlementsQuery.data?.isAuthed ?? Boolean(accessToken);
  const fullName = [profileQuery.data?.firstName, profileQuery.data?.lastName].filter(Boolean).join(' ').trim();
  const email = profileQuery.data?.email ?? sessionQuery.data?.email ?? null;
  const title = fullName ? fullName : isAuthed ? 'Your account' : 'Profile';

  return (
    <AppScreen testID="profile-screen">
      <CustomerShellHero
        eyebrow="Account"
        title={title}
        description={
          isAuthed
            ? 'Review your account details, membership status, and native billing state.'
            : 'Sign in for filters, calendar access, basic mobile push alerts, and membership status on this device.'
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
            value={formatTierLabel(tier)}
            caption={entitlementsQuery.data?.isPaid ? 'Premium is active' : 'Free access'}
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

      <ViewerTierCard tier={tier} showAction={!isAuthed || tier === 'free'} testID="profile-tier-card" />

      {sessionQuery.isPending ? (
        <CustomerShellPanel title="Loading account" description="Checking your current sign-in state." />
      ) : sessionQuery.isError ? (
        <CustomerShellPanel title="Account unavailable" description={sessionQuery.error.message} />
      ) : (
        <CustomerShellPanel testID="profile-viewer-session-section" title="Current viewer" description="The viewer identity currently active in this app session.">
          <Text testID="profile-viewer-email" style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>
            {email ?? 'Not signed in'}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21, marginTop: 4 }}>
            {isAuthed
              ? 'Signed in and ready for filters, calendar access, notifications, and account billing state.'
              : 'Browsing without an authenticated account session.'}
          </Text>
        </CustomerShellPanel>
      )}

      {!isAuthed ? (
        <CustomerShellPanel
          testID="profile-entitlements-section"
          title="Membership"
          description="Free unlocks signed-in filters, calendar access, and basic mobile push alerts. Premium adds saved items, follows, browser-style integrations, and the fastest refresh."
        >
          <Text testID="profile-entitlements-tier" style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
            {formatTierLabel(tier)}
          </Text>
        </CustomerShellPanel>
      ) : profileQuery.isPending ? (
        <CustomerShellPanel title="Loading profile" description="Fetching your account details." />
      ) : profileQuery.isError ? (
        <CustomerShellPanel title="Profile unavailable" description={profileQuery.error.message} />
      ) : (
        <>
          <CustomerShellPanel
            testID="profile-data-section"
            title="Profile details"
            description="The account identity synced to this device."
          >
            <View style={{ gap: 10 }}>
              <DetailRow testID="profile-display-name" label="Name" value={fullName || 'Name not set'} />
              <DetailRow testID="profile-email" label="Email" value={profileQuery.data.email} />
              <DetailRow label="Timezone" value={profileQuery.data.timezone || 'Not set'} />
              {profileQuery.data.role === 'admin' ? <DetailRow label="Role" value="Admin" /> : null}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel
            testID="profile-entitlements-section"
            title="Membership"
            description="Your current access tier, provider source, and renewal state."
          >
            <View style={{ gap: 10 }}>
              <DetailRow testID="profile-entitlements-tier" label="Tier" value={formatTierLabel(tier)} />
              <DetailRow label="Status" value={formatBillingStatus(entitlementsQuery.data?.status || 'unknown')} />
              <DetailRow label="Source" value={formatBillingProvider(entitlementsQuery.data?.source || 'none')} />
              {entitlementsQuery.data?.currentPeriodEnd ? (
                <DetailRow label="Current period end" value={formatDate(entitlementsQuery.data.currentPeriodEnd)} />
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
                <DetailRow
                  testID="profile-billing-provider"
                  label="Provider"
                  value={
                    billingSummary.provider === 'none'
                      ? 'No active Premium billing'
                      : formatBillingProvider(billingSummary.provider)
                  }
                />
                <DetailRow testID="profile-billing-status" label="Status" value={formatBillingStatus(billingSummary.status)} />
                <DetailRow
                  testID="profile-billing-paid-access"
                  label="Paid access"
                  value={billingSummary.isPaid ? 'Yes' : 'No'}
                />
                {billingSummary.currentPeriodEnd ? (
                  <DetailRow label="Current period end" value={formatDate(billingSummary.currentPeriodEnd)} />
                ) : null}
                {billingSummary.providerMessage ? (
                  <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{billingSummary.providerMessage}</Text>
                ) : null}
                {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 14, lineHeight: 21 }}>{billing.actionMessage}</Text> : null}
                {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{billing.actionError}</Text> : null}
              </View>

              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
                {billingSummary.provider === 'stripe' && billingSummary.isPaid
                  ? 'This subscription is billed on web. Open the web account surface to manage Stripe billing.'
                  : billing.isStoreReady
                    ? 'Native billing is available on this device.'
                    : 'Store billing is not available for this platform or current build configuration yet.'}
              </Text>

              <CustomerShellActionButton
                testID="profile-billing-primary-action"
                label={
                  billing.isProcessingPurchase
                    ? 'Working…'
                    : billingSummary.isPaid
                      ? billingSummary.provider === 'stripe'
                        ? 'Open web billing'
                        : 'Manage subscription'
                      : 'Unlock Premium'
                }
                onPress={() => {
                  if (billingSummary.isPaid && billingSummary.managementUrl) {
                    void billing.openManagementLink(billingSummary.managementUrl);
                    return;
                  }
                  void billing.requestSubscription();
                }}
                disabled={billing.isProcessingPurchase || (!billing.isStoreReady && !billingSummary.managementUrl)}
              />

              <CustomerShellActionButton
                testID="profile-billing-restore-action"
                label="Restore purchases"
                variant="secondary"
                onPress={() => {
                  void billing.restorePurchases();
                }}
                disabled={billing.isProcessingPurchase || !billing.isStoreReady}
              />
            </CustomerShellPanel>
          ) : null}
        </>
      )}
    </AppScreen>
  );
}

function DetailRow({
  label,
  value,
  testID
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(234, 240, 255, 0.08)',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        paddingHorizontal: 14,
        paddingVertical: 12
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '700', flex: 1 }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
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

function formatTierLabel(tier: 'anon' | 'free' | 'premium') {
  if (tier === 'premium') {
    return 'Premium';
  }
  if (tier === 'free') {
    return 'Free account';
  }
  return 'Guest access';
}

function formatBillingProvider(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatBillingStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
