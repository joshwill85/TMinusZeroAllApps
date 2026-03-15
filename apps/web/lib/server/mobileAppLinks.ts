import {
  getMobileAppLinkAndroidPackageName,
  getMobileAppLinkAndroidSha256CertFingerprints,
  getMobileAppLinkAppleAppIds
} from '@/lib/server/env';

const APPLE_APP_LINK_PATHS = ['/auth/callback*', '/auth/reset-password*', '/launches/*', '/search*', '/calendar*', '/account*', '/me/preferences*'];

function requireAppleAppLinkIds() {
  const appIds = getMobileAppLinkAppleAppIds();
  if (!appIds.length) {
    throw new Error('Verified iOS app links require APPLE_APP_LINK_APP_IDS or APPLE_DEVELOPER_TEAM_ID with APPLE_APP_STORE_BUNDLE_ID.');
  }

  return appIds;
}

export function buildAppleAppSiteAssociationPayload() {
  const appIds = requireAppleAppLinkIds();

  return {
    applinks: {
      apps: [],
      details: appIds.map((appId) => ({
        appID: appId,
        paths: APPLE_APP_LINK_PATHS
      }))
    }
  };
}

export function buildAndroidAssetLinksPayload() {
  const sha256CertFingerprints = getMobileAppLinkAndroidSha256CertFingerprints();
  if (!sha256CertFingerprints.length) {
    return [];
  }

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: getMobileAppLinkAndroidPackageName(),
        sha256_cert_fingerprints: sha256CertFingerprints
      }
    }
  ];
}
