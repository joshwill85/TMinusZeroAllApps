import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useIAP, type Purchase, type PurchaseAndroid, type PurchaseIOS } from 'expo-iap';
import type { BillingCatalogProductV1, PremiumClaimV1 } from '@tminuszero/api-client';
import { sharedQueryKeys } from '@tminuszero/query';
import { useBillingCatalogQuery, useBillingSummaryQuery } from '@/src/api/queries';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';

type NativeBillingResult = {
  platform: 'ios' | 'android';
  billingSummaryQuery: ReturnType<typeof useBillingSummaryQuery>;
  billingCatalogQuery: ReturnType<typeof useBillingCatalogQuery>;
  catalogProduct: BillingCatalogProductV1 | null;
  claim: PremiumClaimV1 | null;
  actionMessage: string | null;
  actionError: string | null;
  isProcessingPurchase: boolean;
  isStoreReady: boolean;
  requestSubscription: () => Promise<void>;
  restorePurchases: () => Promise<void>;
  openManagementLink: (url: string | null | undefined) => Promise<void>;
  clearClaim: () => void;
};

export function useNativeBilling(viewerId: string | null): NativeBillingResult {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const billingSummaryQuery = useBillingSummaryQuery();
  const billingCatalogQuery = useBillingCatalogQuery(platform);
  const catalogProduct = billingCatalogQuery.data?.products[0] ?? null;

  const [claim, setClaim] = useState<PremiumClaimV1 | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessingPurchase, setIsProcessingPurchase] = useState(false);
  const syncedPurchaseKeysRef = useRef<Set<string>>(new Set());

  function handleBillingError(error: unknown, fallback: string) {
    setIsProcessingPurchase(false);
    setActionMessage(null);
    setActionError(formatBillingError(error, fallback));
  }

  useEffect(() => {
    syncedPurchaseKeysRef.current.clear();
    setActionMessage(null);
    setActionError(null);
    if (viewerId) {
      setClaim(null);
    }
  }, [viewerId]);

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      syncPurchaseEvent(purchase);
    },
    onPurchaseError: (error) => {
      handleBillingError(error, 'Unable to complete purchase.');
    },
    onError: (error) => {
      handleBillingError(error, 'Billing is unavailable right now.');
    }
  });
  const syncPurchaseEvent = useEffectEvent((purchase: Purchase) => {
    void syncPurchase(purchase);
  });

  const productId = catalogProduct?.providerProductId ?? null;
  const googleOfferToken =
    catalogProduct?.offers?.find((offer) => offer.provider === 'google_play' && offer.offerToken)?.offerToken ??
    catalogProduct?.googleOfferToken ??
    null;
  const isStoreReady = Boolean(catalogProduct?.available && productId);

  useEffect(() => {
    if (!isStoreReady || !productId) {
      return;
    }

    let active = true;
    void iap
      .fetchProducts({
        skus: [productId],
        type: 'subs'
      })
      .catch((error: unknown) => {
        if (!active) return;
        setActionError(formatBillingError(error, 'Unable to load store products.'));
      });

    return () => {
      active = false;
    };
  }, [iap, isStoreReady, productId]);

  useEffect(() => {
    if (!productId) {
      return;
    }

    const restoredPurchase = (iap.availablePurchases ?? []).find((purchase) => purchase.productId === productId);
    if (!restoredPurchase) {
      return;
    }

    syncPurchaseEvent(restoredPurchase);
  }, [iap.availablePurchases, productId, syncPurchaseEvent]);

  async function invalidateBillingState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sharedQueryKeys.billingSummary }),
      queryClient.invalidateQueries({ queryKey: sharedQueryKeys.entitlements })
    ]);
  }

  async function syncPurchase(purchase: Purchase) {
    const purchaseKey = [purchase.purchaseToken, purchase.transactionId, purchase.id].find(Boolean);
    if (!purchaseKey || syncedPurchaseKeysRef.current.has(purchaseKey)) {
      return;
    }

    setIsProcessingPurchase(true);
    setActionError(null);

    try {
      if (platform === 'ios') {
        const iosPurchase = purchase as PurchaseIOS;
        if (!iosPurchase.transactionId) {
          throw new Error('Missing App Store transaction id.');
        }
        if (viewerId) {
          await client.syncAppleBilling({
            transactionId: iosPurchase.transactionId,
            productId: iosPurchase.productId,
            originalTransactionId: iosPurchase.originalTransactionIdentifierIOS ?? undefined,
            appAccountToken: viewerId,
            environment:
              iosPurchase.environmentIOS?.toLowerCase() === 'sandbox'
                ? 'sandbox'
                : iosPurchase.environmentIOS?.toLowerCase() === 'production'
                  ? 'production'
                  : undefined
          });
        } else {
          const payload = await client.syncAppleBillingClaim({
            transactionId: iosPurchase.transactionId,
            productId: iosPurchase.productId,
            originalTransactionId: iosPurchase.originalTransactionIdentifierIOS ?? undefined,
            environment:
              iosPurchase.environmentIOS?.toLowerCase() === 'sandbox'
                ? 'sandbox'
                : iosPurchase.environmentIOS?.toLowerCase() === 'production'
                  ? 'production'
                  : undefined
          });
          setClaim(payload.claim);
        }
      } else {
        const androidPurchase = purchase as PurchaseAndroid;
        const purchaseToken = androidPurchase.purchaseToken ?? null;
        if (!purchaseToken) {
          throw new Error('Missing Google Play purchase token.');
        }
        if (viewerId) {
          await client.syncGoogleBilling({
            purchaseToken,
            productId: androidPurchase.productId,
            basePlanId: androidPurchase.currentPlanId ?? undefined,
            obfuscatedAccountId: viewerId
          });
        } else {
          const payload = await client.syncGoogleBillingClaim({
            purchaseToken,
            productId: androidPurchase.productId,
            basePlanId: androidPurchase.currentPlanId ?? undefined
          });
          setClaim(payload.claim);
        }
      }

      await iap.finishTransaction({
        purchase,
        isConsumable: false
      });

      syncedPurchaseKeysRef.current.add(purchaseKey);
      if (viewerId) {
        await invalidateBillingState();
        setActionMessage('Premium access updated.');
      } else {
        setActionMessage('Premium purchase verified. Sign in or create an account to claim it.');
      }
    } catch (error) {
      handleBillingError(error, 'Unable to sync purchase.');
      throw error;
    } finally {
      setIsProcessingPurchase(false);
    }
  }

  async function requestSubscription() {
    if (!catalogProduct?.available || !productId) {
      setActionError('Premium is not available on this platform yet.');
      return;
    }

    setActionMessage(null);
    setActionError(null);
    setIsProcessingPurchase(true);

    try {
      if (platform === 'ios') {
        await iap.requestPurchase({
          request: {
            apple: {
              sku: productId,
              appAccountToken: viewerId || undefined
            }
          },
          type: 'subs'
        });
      } else {
        await iap.requestPurchase({
          request: {
            google: {
              skus: [productId],
              obfuscatedAccountId: viewerId || undefined,
              subscriptionOffers: googleOfferToken
                ? [{ sku: productId, offerToken: googleOfferToken }]
                : undefined
            }
          },
          type: 'subs'
        });
      }
    } catch (error) {
      handleBillingError(error, 'Unable to start purchase.');
    }
  }

  async function restorePurchases() {
    if (!productId) {
      setActionError('Premium is not configured for this platform.');
      return;
    }

    setActionMessage(null);
    setActionError(null);
    setIsProcessingPurchase(true);

    try {
      await iap.restorePurchases();
      await iap.getAvailablePurchases();

      const restoredPurchase = (iap.availablePurchases ?? []).find((purchase) => purchase.productId === productId);
      if (!restoredPurchase) {
        setActionMessage('No previous Premium purchase was found for this account.');
        setIsProcessingPurchase(false);
        return;
      }

      await syncPurchase(restoredPurchase);
    } catch (error) {
      handleBillingError(error, 'Unable to restore purchases.');
    }
  }

  async function openManagementLink(url: string | null | undefined) {
    if (!url) {
      setActionError('Billing management link is unavailable.');
      return;
    }

    try {
      await Linking.openURL(url);
    } catch (error) {
      setActionError(formatBillingError(error, 'Unable to open billing management.'));
    }
  }

  function clearClaim() {
    setClaim(null);
  }

  return {
    platform,
    billingSummaryQuery,
    billingCatalogQuery,
    catalogProduct,
    claim,
    actionMessage,
    actionError,
    isProcessingPurchase,
    isStoreReady,
    requestSubscription,
    restorePurchases,
    openManagementLink,
    clearClaim
  };
}

function formatBillingError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '').trim();
  return message || fallback;
}
