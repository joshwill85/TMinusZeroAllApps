export const premiumLegalDocumentKeys = ['terms_of_service', 'privacy_notice'] as const;

export type PremiumLegalDocumentKey = (typeof premiumLegalDocumentKeys)[number];

export const PREMIUM_TERMS_VERSION = '2026-04-03';
export const PREMIUM_PRIVACY_VERSION = '2026-04-06';

export const PREMIUM_TERMS_LAST_UPDATED_LABEL = 'Apr 3, 2026';
export const PREMIUM_PRIVACY_LAST_UPDATED_LABEL = 'Apr 6, 2026';

export const premiumLegalDocuments = {
  terms_of_service: {
    key: 'terms_of_service',
    version: PREMIUM_TERMS_VERSION,
    lastUpdatedLabel: PREMIUM_TERMS_LAST_UPDATED_LABEL
  },
  privacy_notice: {
    key: 'privacy_notice',
    version: PREMIUM_PRIVACY_VERSION,
    lastUpdatedLabel: PREMIUM_PRIVACY_LAST_UPDATED_LABEL
  }
} as const;

export function getPremiumLegalVersions() {
  return {
    termsVersion: premiumLegalDocuments.terms_of_service.version,
    privacyVersion: premiumLegalDocuments.privacy_notice.version
  };
}

