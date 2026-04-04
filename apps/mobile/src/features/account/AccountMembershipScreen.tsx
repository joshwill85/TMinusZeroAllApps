import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { BillingCatalogOfferV1 } from '@tminuszero/api-client';
import { getMobileViewerTier } from '@tminuszero/domain';
import { useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { buildClaimAuthHref } from '@/src/billing/nativeBillingUi';
import { useNativeBilling } from '@/src/billing/useNativeBilling';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellActionButton, CustomerShellBadge, CustomerShellHero, CustomerShellMetric, CustomerShellPanel } from '@/src/components/CustomerShell';
import { AccountDetailRow } from '@/src/features/account/AccountUi';
import {
  BillingPurchaseNotice,
  buildAccessCaption,
  buildBillingMessage,
  buildMembershipStatusCaption,
  formatBillingProvider,
  formatBillingStatus,
  formatDate,
  formatEffectiveTierSource,
  formatManagementProviderLabel,
  formatMembershipStatusLabel,
  formatTierLabel,
  isStoreManagedBillingProvider
} from '@/src/features/account/ProfileScreenUi';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function AccountMembershipScreen() {
  const router = useRouter();
  const { accessToken, theme } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const billing = useNativeBilling(sessionQuery.data?.viewerId ?? null);

  const billingSummary = billing.billingSummaryQuery.data ?? null;
  const catalogProduct = billing.catalogProduct ?? null;
  const catalogOffers = catalogProduct?.offers ?? [];
  const purchaseProvider = catalogProduct?.provider ?? (billing.platform === 'ios' ? 'apple_app_store' : 'google_play');
  const isAuthed = entitlementsQuery.data?.isAuthed ?? Boolean(accessToken);
  const tier = getMobileViewerTier(entitlementsQuery.data?.tier ?? 'anon');
  const effectiveTierSource = entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = entitlementsQuery.data?.billingIsPaid === true;
  const hasSeparateAccessState =
    entitlementsQuery.data?.isAdmin === true && (effectiveTierSource === 'admin' || effectiveTierSource === 'admin_override');
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
  const showStoreManagementAction = Boolean(
    billingSummary && billingSummary.isPaid && isStoreManagedBillingProvider(billingSummary.provider) && billingSummary.managementUrl
  );
  const showPurchaseAction = Boolean(billingSummary && !billingSummary.isPaid && !hasSeparateAccessState);
  const showRestoreAction = Boolean(billing.isStoreReady && !hasSeparateAccessState && (showStoreManagementAction || showPurchaseAction));

  return (
    <AppScreen testID="account-membership-screen">
      <CustomerShellHero
        eyebrow="Account"
        title="Membership & Billing"
        description={
          isAuthed
            ? 'Review access, renewal timing, and store-aware billing actions for this account on this device.'
            : 'Premium purchase, restore, and claim flows live here on mobile.'
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={formatTierLabel(tier, isAuthed)} tone={tier === 'premium' ? 'accent' : 'default'} />
          <CustomerShellBadge label={isAuthed ? 'Signed in' : 'Guest'} tone={isAuthed ? 'success' : 'warning'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Membership summary" description="One source of truth for access and renewal state on this device.">
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
          <AccountDetailRow label="Access source" value={formatEffectiveTierSource(effectiveTierSource)} />
          <AccountDetailRow label="Billing state" value={billingIsPaid ? 'Paid access' : 'No paid billing'} />
        </View>
      </CustomerShellPanel>

      {!isAuthed ? (
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
            {!billing.claim ? (
              <BillingPurchaseNotice
                displayName={catalogProduct?.displayName}
                priceLabel={catalogProduct?.priceLabel}
                provider={purchaseProvider}
                onOpenPrivacy={() => router.push('/legal/privacy' as Href)}
                onOpenTerms={() => router.push('/legal/terms' as Href)}
              />
            ) : null}
            {catalogOffers.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>Active offers on this device</Text>
                {catalogOffers.map((offer) => (
                  <View
                    key={offer.offerKey}
                    style={{
                      gap: 6,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: theme.stroke,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      paddingHorizontal: 12,
                      paddingVertical: 12
                    }}
                  >
                    <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{offer.label}</Text>
                    {offer.eligibilityHint ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{offer.eligibilityHint}</Text> : null}
                    {offer.promotionCode ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Code: {offer.promotionCode}</Text> : null}
                    {offer.redemptionUrl ? (
                      <CustomerShellActionButton
                        label="Redeem App Store offer"
                        variant="secondary"
                        onPress={() => {
                          void billing.openManagementLink(offer.redemptionUrl);
                        }}
                      />
                    ) : null}
                  </View>
                ))}
                {hasAutomaticGoogleOffer(catalogOffers) ? (
                  <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                    Eligible Google Play offers are applied automatically when checkout starts on this device.
                  </Text>
                ) : null}
              </View>
            ) : null}
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
      ) : billing.billingSummaryQuery.isPending ? (
        <CustomerShellPanel title="Billing" description="Loading provider-aware billing status." />
      ) : billing.billingSummaryQuery.isError ? (
        <CustomerShellPanel title="Billing unavailable" description={billing.billingSummaryQuery.error.message} />
      ) : billingSummary ? (
        <CustomerShellPanel
          testID="account-membership-billing-section"
          title="Billing management"
          description={
            hasSeparateAccessState
              ? 'Stored billing on this device can appear separately from the current access state.'
              : 'Manage your current plan and purchase status on this device.'
          }
        >
          <View style={{ gap: 10 }}>
            <AccountDetailRow
              label="Provider"
              value={billingSummary.provider === 'none' ? 'No active Premium billing' : formatBillingProvider(billingSummary.provider)}
            />
            <AccountDetailRow label="Status" value={formatBillingStatus(billingSummary.status)} />
            <AccountDetailRow label="Paid access" value={billingSummary.isPaid ? 'Yes' : 'No'} />
            {billingSummary.currentPeriodEnd ? <AccountDetailRow label="Current period end" value={formatDate(billingSummary.currentPeriodEnd)} /> : null}
            {billingSummary.providerMessage ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{billingSummary.providerMessage}</Text> : null}
            {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 14, lineHeight: 21 }}>{billing.actionMessage}</Text> : null}
            {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{billing.actionError}</Text> : null}
          </View>

          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            {hasSeparateAccessState
              ? 'Current access can stay active even when this device has no active paid billing record.'
              : buildBillingMessage(billingSummary.provider, billingSummary.isPaid, billing.isStoreReady)}
          </Text>

          {showPurchaseAction ? (
            <BillingPurchaseNotice
              displayName={catalogProduct?.displayName}
              priceLabel={catalogProduct?.priceLabel}
              provider={purchaseProvider}
              onOpenPrivacy={() => router.push('/legal/privacy' as Href)}
              onOpenTerms={() => router.push('/legal/terms' as Href)}
            />
          ) : null}

          {catalogOffers.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>Active offers on this device</Text>
              {catalogOffers.map((offer) => (
                <View
                  key={offer.offerKey}
                  style={{
                    gap: 6,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    paddingHorizontal: 12,
                    paddingVertical: 12
                  }}
                >
                  <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{offer.label}</Text>
                  {offer.eligibilityHint ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{offer.eligibilityHint}</Text> : null}
                  {offer.promotionCode ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>Code: {offer.promotionCode}</Text> : null}
                  {offer.redemptionUrl ? (
                    <CustomerShellActionButton
                      label="Redeem App Store offer"
                      variant="secondary"
                      onPress={() => {
                        void billing.openManagementLink(offer.redemptionUrl);
                      }}
                    />
                  ) : null}
                </View>
              ))}
              {hasAutomaticGoogleOffer(catalogOffers) ? (
                <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                  Eligible Google Play offers are applied automatically when checkout starts on this device.
                </Text>
              ) : null}
            </View>
          ) : null}

          {showStoreManagementAction || showPurchaseAction ? (
            <CustomerShellActionButton
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
    </AppScreen>
  );
}

function hasAutomaticGoogleOffer(offers: BillingCatalogOfferV1[]) {
  return offers.some((offer) => offer.provider === 'google_play' && Boolean(offer.offerToken));
}
