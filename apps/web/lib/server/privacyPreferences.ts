import { cookies, headers } from 'next/headers';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';

export type EffectivePrivacyPreferences = {
  optOutSaleShare: boolean;
  limitSensitive: boolean;
  blockThirdPartyEmbeds: boolean;
  gpcEnabled: boolean;
  source: {
    cookie: boolean;
    account: boolean;
    gpc: boolean;
  };
};

type AccountPrivacyPreferencesRow = {
  opt_out_sale_share: boolean;
  limit_sensitive: boolean;
  block_third_party_embeds: boolean;
  gpc_enabled: boolean;
};

function isGpcHeaderEnabled() {
  const headerStore = headers();
  const secGpc = headerStore.get('Sec-GPC');
  const gpc = headerStore.get('GPC');
  return secGpc === '1' || gpc === '1';
}

export async function getEffectivePrivacyPreferences({ userId }: { userId: string | null }): Promise<EffectivePrivacyPreferences> {
  const cookieStore = cookies();
  const cookieSaleShare = cookieStore.get(PRIVACY_COOKIES.optOutSaleShare)?.value === '1';
  const cookieSensitive = cookieStore.get(PRIVACY_COOKIES.limitSensitive)?.value === '1';
  const cookieEmbeds = cookieStore.get(PRIVACY_COOKIES.blockEmbeds)?.value === '1';

  const gpcEnabled = isGpcHeaderEnabled();

  let account: AccountPrivacyPreferencesRow | null = null;
  if (userId && isSupabaseConfigured()) {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('privacy_preferences')
      .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) account = data as AccountPrivacyPreferencesRow;
  }

  const accountOptOutSaleShare = Boolean(account?.opt_out_sale_share);

  return {
    optOutSaleShare: gpcEnabled || cookieSaleShare || accountOptOutSaleShare,
    limitSensitive: cookieSensitive || Boolean(account?.limit_sensitive),
    blockThirdPartyEmbeds: cookieEmbeds || Boolean(account?.block_third_party_embeds),
    gpcEnabled,
    source: {
      cookie: cookieSaleShare || cookieSensitive || cookieEmbeds,
      account: Boolean(account),
      gpc: gpcEnabled
    }
  };
}
