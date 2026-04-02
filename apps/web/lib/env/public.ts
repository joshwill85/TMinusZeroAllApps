import { BRAND_FACEBOOK_URL, BRAND_X_URL } from '@/lib/brand';
import { normalizeEnvText } from '@/lib/env/normalize';

const STRIPE_PUBLISHABLE_PLACEHOLDERS = [
  'pk_test_placeholder',
  'pk_live_placeholder',
  'STRIPE_PUBLISHABLE_PLACEHOLDER'
];

function isPlaceholder(value: string | undefined, placeholders: string[]) {
  const trimmed = normalizeEnvText(value);
  if (!trimmed) return true;
  return placeholders.some((placeholder) => trimmed === placeholder || trimmed.includes(placeholder));
}

export function getStripePublishableKey() {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (isPlaceholder(key, STRIPE_PUBLISHABLE_PLACEHOLDERS)) return null;
  return normalizeEnvText(key);
}

function normalizeHttpsUrl(raw: string | undefined) {
  const trimmed = normalizeEnvText(raw);
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  return url.toString();
}

export type PublicSocialLinks = {
  facebookUrl: string | null;
  xUrl: string | null;
};

export function getPublicSocialLinks(): PublicSocialLinks {
  const facebookRaw = process.env.NEXT_PUBLIC_FACEBOOK_URL;
  const xRaw = process.env.NEXT_PUBLIC_X_URL;

  const facebookUrl = facebookRaw === undefined ? BRAND_FACEBOOK_URL : normalizeHttpsUrl(facebookRaw);
  const xUrl = xRaw === undefined ? BRAND_X_URL : normalizeHttpsUrl(xRaw);
  return { facebookUrl, xUrl };
}
