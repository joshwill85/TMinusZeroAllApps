'use client';

import { useEffect, useRef } from 'react';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { deleteCookie, readCookie, setCookie } from '@/lib/privacy/clientCookies';
import { usePrivacyPreferencesQuery, useUpdatePrivacyPreferencesMutation, useViewerSessionQuery } from '@/lib/api/queries';

type CookiePreferences = {
  opt_out_sale_share: boolean;
  limit_sensitive: boolean;
  block_third_party_embeds: boolean;
};

function syncCookiePreferences(prefs: CookiePreferences) {
  if (prefs.opt_out_sale_share) setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
  else deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
  if (prefs.limit_sensitive) setCookie(PRIVACY_COOKIES.limitSensitive, '1');
  else deleteCookie(PRIVACY_COOKIES.limitSensitive);
  if (prefs.block_third_party_embeds) setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
  else deleteCookie(PRIVACY_COOKIES.blockEmbeds);
}

export function PrivacySignals() {
  const viewerSessionQuery = useViewerSessionQuery();
  const privacyPreferencesQuery = usePrivacyPreferencesQuery();
  const updatePrivacyPreferencesMutation = useUpdatePrivacyPreferencesMutation();
  const promotionSignatureRef = useRef<string | null>(null);
  const gpcEnabled = typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true;
  const isAuthed = Boolean(viewerSessionQuery.data?.viewerId);

  useEffect(() => {
    if (gpcEnabled && readCookie(PRIVACY_COOKIES.optOutSaleShare) !== '1') {
      setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
    }
  }, [gpcEnabled]);

  useEffect(() => {
    if (!isAuthed || !privacyPreferencesQuery.data) return;

    const prefs = privacyPreferencesQuery.data;
    syncCookiePreferences({
      opt_out_sale_share: prefs.optOutSaleShare || gpcEnabled,
      limit_sensitive: prefs.limitSensitive,
      block_third_party_embeds: prefs.blockThirdPartyEmbeds
    });

    const promote = {
      ...(gpcEnabled && !prefs.gpcEnabled ? { gpcEnabled: true } : {}),
      ...(gpcEnabled && !prefs.optOutSaleShare ? { optOutSaleShare: true } : {})
    };
    const keys = Object.keys(promote);
    if (keys.length === 0) {
      promotionSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify(promote);
    if (promotionSignatureRef.current === signature) {
      return;
    }
    promotionSignatureRef.current = signature;

    void updatePrivacyPreferencesMutation.mutateAsync(promote).catch(() => {
      if (promotionSignatureRef.current === signature) {
        promotionSignatureRef.current = null;
      }
    });
  }, [gpcEnabled, isAuthed, privacyPreferencesQuery.data, updatePrivacyPreferencesMutation]);

  return null;
}
