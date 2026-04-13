import { getOgImageVersion } from '@/lib/server/env';
import { getIndexingSiteUrl } from '@/lib/server/indexing';
import { BRAND_NAME, BRAND_TECHNICAL_NAME } from '@/lib/brand';

export const SITE_META = {
  title: `${BRAND_NAME} | US Rocket Launch Schedule`,
  description:
    'Upcoming US rocket launches with countdowns, launch windows, and live coverage links for SpaceX, NASA, ULA, and more.',
  keywords: [
    'rocket launches',
    'rocket launch schedule',
    'launch schedule',
    'US launch schedule',
    'rocket launch countdown',
    'space launch tracker',
    'SpaceX launches',
    'NASA launches',
    'ULA launches',
    'rocket launch alerts',
    'artemis',
    'artemis ii',
    'artemis 2',
    'artemis ii launch date',
    'artemis 2 countdown',
    'artemis launch schedule',
    'artemis awardees',
    'artemis contractors',
    'artemis procurement awards'
  ],
  ogTitle: 'US Rocket Launch Schedule',
  ogDescription:
    'Upcoming US rocket launches with countdowns, launch windows, and live coverage links.',
  siteName: BRAND_NAME,
  ogImageAlt: `${BRAND_TECHNICAL_NAME} orbit arc with a minimalist rocket`
};

export function buildSiteMeta(options?: { ogOverride?: string | null }) {
  const siteUrl = getIndexingSiteUrl();
  const ogOverride = options?.ogOverride?.trim();
  const ogVersion = ogOverride || getOgImageVersion();
  const ogImage = `${siteUrl}/opengraph-image/jpeg?v=${encodeURIComponent(ogVersion)}`;

  return {
    ...SITE_META,
    siteUrl,
    ogImage
  };
}
