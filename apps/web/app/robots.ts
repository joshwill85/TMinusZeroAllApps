import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/server/env';

function parseBooleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

function shouldAllowRobotsIndexing(siteUrl: string) {
  const normalizedSiteUrl = siteUrl.trim().toLowerCase();
  const isLocalhost = normalizedSiteUrl.includes('localhost');
  if (isLocalhost) {
    return parseBooleanEnv(process.env.TMZ_ALLOW_LOCAL_INDEXING);
  }

  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv) {
    return vercelEnv === 'production';
  }

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv) {
    return nodeEnv === 'production';
  }

  return true;
}

function getHost(siteUrl: string) {
  try {
    return new URL(siteUrl).host;
  } catch {
    return null;
  }
}

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const host = getHost(siteUrl);
  const sitemaps = [
    `${siteUrl}/sitemap.xml`,
    `${siteUrl}/sitemap-launches.xml`,
    `${siteUrl}/sitemap-entities.xml`,
    `${siteUrl}/sitemap-catalog.xml`,
    `${siteUrl}/sitemap-satellites.xml`,
    `${siteUrl}/sitemap-satellite-owners.xml`
  ];

  if (!shouldAllowRobotsIndexing(siteUrl)) {
    return {
      rules: { userAgent: '*', disallow: '/' }
    };
  }

  return {
    rules: {
      userAgent: '*',
      // Allow specific routes that live under generally-disallowed prefixes.
      allow: ['/', '/share/launch'],
      disallow: [
        '/api',
        '/api/',
        '/account',
        '/account/',
        '/admin',
        '/admin/',
        '/auth',
        '/auth/',
        '/me',
        '/me/',
        '/embed',
        '/embed/',
        '/share',
        '/share/',
        '/opengraph-image',
        '/opengraph-image/',
        '/launches/*/opengraph-image',
        '/launches/*/opengraph-image/',
        '/unsubscribe',
        '/unsubscribe/'
      ]
    },
    sitemap: sitemaps,
    ...(host ? { host } : {})
  };
}
