import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/server/env';

function shouldAllowIndexing(siteUrl: string) {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv && vercelEnv !== 'production') return false;

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv && nodeEnv !== 'production') return false;

  return !siteUrl.toLowerCase().includes('localhost');
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

  if (!shouldAllowIndexing(siteUrl)) {
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
