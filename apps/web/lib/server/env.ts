function isPlaceholder(value: string | undefined, placeholders: string[]) {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return placeholders.some((p) => trimmed === p || trimmed.includes(p));
}

function parseCsvSecretList(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readConfiguredValue(value: string | undefined, placeholders: string[]) {
  return isPlaceholder(value, placeholders) ? null : value?.trim() || null;
}

export function getSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}

export function getOgImageVersion() {
  const explicit = process.env.NEXT_PUBLIC_OG_IMAGE_VERSION?.trim();
  if (explicit) return explicit;
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (deploymentId) return deploymentId;
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (commitSha) return commitSha.slice(0, 12);
  return '2026-01-08-2';
}

export function getGoogleSiteVerification() {
  const direct = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  if (direct) return direct;
  const serverOnly = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  if (serverOnly) return serverOnly;
  return null;
}

export function getGoogleMapsStaticApiKey() {
  const key = process.env.GOOGLE_MAPS_STATIC_API_KEY;
  if (isPlaceholder(key, ['GOOGLE_MAPS_STATIC_API_KEY', 'google_maps_static_api_key'])) return null;
  return key?.trim() || null;
}

export function getInternalBlueOriginRevalidateTokens() {
  return parseCsvSecretList(process.env.INTERNAL_REVALIDATE_BLUE_ORIGIN_TOKEN);
}

export function isInternalBlueOriginRevalidateTokenValid(value: string | null | undefined) {
  const provided = String(value || '').trim();
  if (!provided) return false;
  const expected = getInternalBlueOriginRevalidateTokens();
  if (!expected.length) return false;
  return expected.some((candidate) => candidate === provided);
}

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (
    !isPlaceholder(url, ['your-supabase-url.supabase.co', 'https://your-supabase-url.supabase.co']) &&
    !isPlaceholder(anon, ['SUPABASE_ANON_KEY', 'public_anon_key', 'anon_placeholder'])
  );
}

export function isSupabaseAdminConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return (
    !isPlaceholder(url, ['your-supabase-url.supabase.co', 'https://your-supabase-url.supabase.co']) &&
    !isPlaceholder(serviceRole, ['SUPABASE_SERVICE_ROLE_KEY', 'service_role_key', 'service_role_placeholder'])
  );
}

export function isStripeConfigured() {
  const secret = process.env.STRIPE_SECRET_KEY;
  return !isPlaceholder(secret, ['STRIPE_SECRET_PLACEHOLDER', 'sk_test_placeholder']);
}

export function isStripePublishableConfigured() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return !isPlaceholder(key, ['pk_test_placeholder', 'pk_live_placeholder', 'STRIPE_PUBLISHABLE_PLACEHOLDER']);
}

export function isStripePriceConfigured() {
  const priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  return !isPlaceholder(priceId, ['price_placeholder']);
}

export function isStripeWebhookConfigured() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return !isPlaceholder(secret, ['whsec_placeholder']);
}

export function getAppleAppStoreAppId() {
  const raw = readConfiguredValue(process.env.APPLE_APP_STORE_APP_ID, ['APPLE_APP_STORE_APP_ID']);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isAppleBillingConfigured() {
  const issuerId = process.env.APPLE_APP_STORE_ISSUER_ID;
  const keyId = process.env.APPLE_APP_STORE_KEY_ID;
  const privateKey = process.env.APPLE_APP_STORE_PRIVATE_KEY;
  const bundleId = process.env.APPLE_APP_STORE_BUNDLE_ID;
  const productId = process.env.APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID;

  return (
    !isPlaceholder(issuerId, ['APPLE_APP_STORE_ISSUER_ID']) &&
    !isPlaceholder(keyId, ['APPLE_APP_STORE_KEY_ID']) &&
    !isPlaceholder(privateKey, ['APPLE_APP_STORE_PRIVATE_KEY']) &&
    !isPlaceholder(bundleId, ['APPLE_APP_STORE_BUNDLE_ID']) &&
    !isPlaceholder(productId, ['APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID'])
  );
}

export function isAppleBillingNotificationsConfigured() {
  return isAppleBillingConfigured() && getAppleAppStoreAppId() !== null;
}

export function getGooglePlayNotificationAudience() {
  const explicitAudience = readConfiguredValue(process.env.GOOGLE_PLAY_RTDN_PUSH_AUDIENCE, ['GOOGLE_PLAY_RTDN_PUSH_AUDIENCE']);
  if (explicitAudience) {
    return explicitAudience;
  }

  const explicitSiteUrl = readConfiguredValue(process.env.NEXT_PUBLIC_SITE_URL, ['NEXT_PUBLIC_SITE_URL']);
  if (explicitSiteUrl) {
    return `${explicitSiteUrl.replace(/\/+$/, '')}/api/webhooks/google-play`;
  }

  const vercelUrl = readConfiguredValue(process.env.VERCEL_URL, ['VERCEL_URL']);
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/+$/, '')}/api/webhooks/google-play`;
  }

  return null;
}

export function getGooglePlayNotificationServiceAccountEmail() {
  return readConfiguredValue(
    process.env.GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL,
    ['GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL']
  );
}

export function isGoogleBillingConfigured() {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const clientEmail = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  const productId = process.env.GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID;

  return (
    !isPlaceholder(packageName, ['GOOGLE_PLAY_PACKAGE_NAME']) &&
    !isPlaceholder(clientEmail, ['GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL']) &&
    !isPlaceholder(privateKey, ['GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY']) &&
    !isPlaceholder(productId, ['GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID'])
  );
}

export function isGoogleBillingNotificationsConfigured() {
  return (
    isGoogleBillingConfigured() &&
    Boolean(getGooglePlayNotificationAudience()) &&
    Boolean(getGooglePlayNotificationServiceAccountEmail())
  );
}

export function getAppleDeveloperTeamId() {
  return readConfiguredValue(process.env.APPLE_DEVELOPER_TEAM_ID, ['APPLE_DEVELOPER_TEAM_ID']);
}

export function getMobileAppLinkAppleAppIds() {
  const explicit = parseCsvSecretList(process.env.APPLE_APP_LINK_APP_IDS);
  if (explicit.length) {
    return explicit;
  }

  const teamId = getAppleDeveloperTeamId();
  const bundleId =
    readConfiguredValue(process.env.APPLE_APP_STORE_BUNDLE_ID, ['APPLE_APP_STORE_BUNDLE_ID']) ||
    'app.tminuszero.mobile';

  if (!teamId || !bundleId) {
    return [];
  }

  return [`${teamId}.${bundleId}`];
}

export function getMobileAppLinkAndroidPackageName() {
  return readConfiguredValue(process.env.ANDROID_APP_LINK_PACKAGE_NAME, ['ANDROID_APP_LINK_PACKAGE_NAME']) || 'app.tminuszero.mobile';
}

export function getMobileAppLinkAndroidSha256CertFingerprints() {
  return parseCsvSecretList(process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS);
}
