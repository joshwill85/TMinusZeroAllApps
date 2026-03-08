export const PRIVACY_COOKIES = {
  optOutSaleShare: 'tmn_opt_out_sale_share',
  limitSensitive: 'tmn_limit_sensitive',
  blockEmbeds: 'tmn_block_third_party_embeds'
} as const;

export type PrivacyCookieName = (typeof PRIVACY_COOKIES)[keyof typeof PRIVACY_COOKIES];
