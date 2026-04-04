'use client';

import { useEffect, useState } from 'react';
import { readCookie } from '@/lib/privacy/clientCookies';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';

const PRIVACY_PREFERENCES_CHANGED_EVENT = 'tmz:privacy-preferences-changed';

function readBlockThirdPartyEmbedsPreference() {
  return readCookie(PRIVACY_COOKIES.blockEmbeds) === '1';
}

export function notifyPrivacyPreferencesChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(PRIVACY_PREFERENCES_CHANGED_EVENT));
}

export function useBlockThirdPartyEmbedsPreference() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const sync = () => {
      setBlocked(readBlockThirdPartyEmbedsPreference());
    };

    sync();
    window.addEventListener(PRIVACY_PREFERENCES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(PRIVACY_PREFERENCES_CHANGED_EVENT, sync);
    };
  }, []);

  return blocked;
}
