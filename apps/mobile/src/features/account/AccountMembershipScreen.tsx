import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { BillingCatalogOfferV1 } from '@tminuszero/api-client';
import { getMobileViewerTier } from '@tminuszero/domain';
import { useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import {
  buildMobilePremiumCheckoutReturnTo,
  buildMobilePremiumLegalHref,
  buildMobilePremiumUpgradeAuthHref
} from '@/src/auth/premiumOnboarding';
import { createOrResumePremiumOnboardingIntent } from '@/src/auth/supabaseAuth';
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

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function AccountMembershipScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ autostart?: string | string[] }>();
  const { accessToken, theme } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const billing = useNativeBilling(sessionQuery.data?.viewerId ?? null);
  const [premiumOnboardingIntentId, setPremiumOnboardingIntentId] = useState<string | null>(null);
  const [premiumLegalRequired, setPremiumLegalRequired] = useState(false);
  const [premiumOnboardingLoaded, setPremiumOnboardingLoaded] = useState(false);
  const autostartHandledRef = useRef(false);

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
  const autostart = useMemo(() => readParam(params.autostart) === '1', [params.autostart]);
  const premiumCheckoutReturnTo = useMemo(() => buildMobilePremiumCheckoutReturnTo('/account/membership'), []);
  const guestPremiumLegalHref = useMemo(
    () =>
      buildMobilePremiumLegalHref({
        returnTo: premiumCheckoutReturnTo
      }),
    [premiumCheckoutReturnTo]
  );
  const premiumLegalHref = useMemo(
    () =>
      buildMobilePremiumLegalHref({
        returnTo: premiumCheckoutReturnTo,
        intentId: premiumOnboardingIntentId
      }),
    [premiumCheckoutReturnTo, premiumOnboardingIntentId]
  );
  const premiumUpgradeSignInHref = useMemo(
    () =>
      buildMobilePremiumUpgradeAuthHref('sign-in', {
        returnTo: guestPremiumLegalHref
      }),
    [guestPremiumLegalHref]
  );

  useEffect(() => {
    if (!autostart) {
      autostartHandledRef.current = false;
    }
  }, [autostart]);

  useEffect(() => {
    if (!isAuthed || !accessToken || hasSeparateAccessState || tier === 'premium') {
      setPremiumOnboardingIntentId(null);
      setPremiumLegalRequired(false);
      setPremiumOnboardingLoaded(false);
      return;
    }

    let cancelled = false;
    setPremiumOnboardingLoaded(false);

    void createOrResumePremiumOnboardingIntent({
      accessToken,
      returnTo: '/account/membership'
    })
      .then((payload) => {
        if (cancelled) return;
        setPremiumOnboardingIntentId(payload.intent.intentId);
        setPremiumLegalRequired(payload.legal.requiresAcceptance);
        setPremiumOnboardingLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPremiumOnboardingIntentId(null);
        setPremiumLegalRequired(false);
        setPremiumOnboardingLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, hasSeparateAccessState, isAuthed, tier]);

  const beginPremiumPurchase = useCallback(() => {
    if (!isAuthed) {
      void billing.requestSubscription();
      return;
    }

    if (premiumLegalRequired) {
      router.push(premiumLegalHref as Href);
      return;
    }

    void billing.requestSubscription();
  }, [billing, isAuthed, premiumLegalHref, premiumLegalRequired, router]);

  const beginRestorePurchases = useCallback(() => {
    if (!isAuthed) {
      void billing.restorePurchases();
      return;
    }

    if (showPurchaseAction && premiumLegalRequired) {
      router.push(premiumLegalHref as Href);
      return;
    }

    void billing.restorePurchases();
  }, [billing, isAuthed, premiumLegalHref, premiumLegalRequired, router, showPurchaseAction]);

  useEffect(() => {
    if (!autostart || autostartHandledRef.current) {
      return;
    }
    if (!showPurchaseAction || billing.isProcessingPurchase) {
      return;
    }
    if (isAuthed && !premiumOnboardingLoaded) {
      return;
    }

    autostartHandledRef.current = true;

    if (isAuthed && premiumLegalRequired) {
      router.replace(premiumLegalHref as Href);
      return;
    }

    void billing.requestSubscription();
  }, [autostart, billing, isAuthed, premiumLegalHref, premiumLegalRequired, premiumOnboardingLoaded, router, showPurchaseAction]);

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
          title={billing.claim ? 'Claim Premium' : 'Start Premium'}
          description={
            billing.claim
              ? 'Your store purchase is verified. Sign in to an existing account or create one now to claim Premium on this device.'
              : 'Start or restore Premium from this device first. Once purchase verification completes, sign in or create an account to claim it.'
          }
        >
          <View style={{ gap: 10 }}>
            {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 14, lineHeight: 21 }}>{billing.actionMessage}</Text> : null}
            {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 14, lineHeight: 21 }}>{billing.actionError}</Text> : null}
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
              {billing.claim
                ? 'Claiming Premium links the verified purchase to a T-Minus Zero account for ownership, recovery, and restore.'
                : 'Guest purchase and restore stay on this device until you sign in or create an account to claim ownership.'}
            </Text>
            {!billing.claim ? (
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                Existing account holders can still sign in first if they want the purchase bound to that account during checkout.
              </Text>
            ) : null}
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
                  label={billing.isProcessingPurchase ? 'Working…' : 'Start Premium'}
                  onPress={() => {
                    beginPremiumPurchase();
                  }}
                  disabled={billing.isProcessingPurchase || !billing.isStoreReady}
                />
                <CustomerShellActionButton
                  label="Restore purchases"
                  variant="secondary"
                  onPress={() => {
                    beginRestorePurchases();
                  }}
                  disabled={billing.isProcessingPurchase || !billing.isStoreReady}
                />
                <CustomerShellActionButton
                  label="Sign in to existing account"
                  variant="secondary"
                  onPress={() => {
                    router.push(premiumUpgradeSignInHref as Href);
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
            {showPurchaseAction && premiumOnboardingLoaded && premiumLegalRequired ? (
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                Review the latest Terms of Service and Privacy Notice before Premium checkout can begin on this device.
              </Text>
            ) : null}
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
                beginPremiumPurchase();
              }}
              disabled={billing.isProcessingPurchase || (showStoreManagementAction ? !billingSummary.managementUrl : !billing.isStoreReady)}
            />
          ) : null}

          {showRestoreAction ? (
            <CustomerShellActionButton
              label="Restore purchases"
              variant="secondary"
              onPress={() => {
                beginRestorePurchases();
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
