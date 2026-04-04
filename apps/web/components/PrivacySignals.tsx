'use client';

import { useEffect } from 'react';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { deleteCookie, setCookie } from '@/lib/privacy/clientCookies';
import { notifyPrivacyPreferencesChanged } from '@/lib/privacy/embedPreference';
import { usePrivacyPreferencesQuery, useViewerSessionQuery } from '@/lib/api/queries';

export function PrivacySignals() {
  const viewerSessionQuery = useViewerSessionQuery();
  const privacyPreferencesQuery = usePrivacyPreferencesQuery();
  const isAuthed = Boolean(viewerSessionQuery.data?.viewerId);

  useEffect(() => {
    deleteCookie(PRIVACY_COOKIES.optOutSaleShare);
    deleteCookie(PRIVACY_COOKIES.limitSensitive);
    notifyPrivacyPreferencesChanged();
  }, []);

  useEffect(() => {
    if (!isAuthed || !privacyPreferencesQuery.data) return;

    if (privacyPreferencesQuery.data.blockThirdPartyEmbeds) {
      setCookie(PRIVACY_COOKIES.blockEmbeds, '1');
      notifyPrivacyPreferencesChanged();
      return;
    }

    deleteCookie(PRIVACY_COOKIES.blockEmbeds);
    notifyPrivacyPreferencesChanged();
  }, [isAuthed, privacyPreferencesQuery.data]);

  return null;
}
