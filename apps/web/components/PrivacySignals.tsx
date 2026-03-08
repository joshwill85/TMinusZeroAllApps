'use client';

import { useEffect } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getBrowserClient } from '@/lib/api/supabase';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { deleteCookie, readCookie, setCookie } from '@/lib/privacy/clientCookies';

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
  useEffect(() => {
    let active = true;
    const gpcEnabled = typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true;

    const syncGpcCookie = () => {
      if (gpcEnabled) {
        const saleShare = readCookie(PRIVACY_COOKIES.optOutSaleShare);
        if (saleShare !== '1') setCookie(PRIVACY_COOKIES.optOutSaleShare, '1');
      }
    };

    const syncServerPreferences = async () => {
      try {
        const res = await fetch('/api/me/privacy/preferences', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        const prefs = json?.preferences;
        if (!prefs) return;
        syncCookiePreferences({
          opt_out_sale_share: Boolean(prefs.opt_out_sale_share) || gpcEnabled,
          limit_sensitive: Boolean(prefs.limit_sensitive),
          block_third_party_embeds: Boolean(prefs.block_third_party_embeds)
        });
      } catch {
        return;
      }

      if (gpcEnabled) {
        await fetch('/api/me/privacy/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            opt_out_sale_share: true,
            gpc_enabled: true
          })
        }).catch(() => undefined);
      }
    };

    syncGpcCookie();

    const supabase = getBrowserClient();
    if (!supabase) {
      return () => {
        active = false;
      };
    }

    const runIfAuthed = async () => {
      const sessionResult = await supabase.auth.getSession().catch(() => null);
      if (!active) return;
      const user = sessionResult?.data?.session?.user;
      if (!user) return;
      await syncServerPreferences();
    };

    void runIfAuthed();

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) return;
      void syncServerPreferences();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
