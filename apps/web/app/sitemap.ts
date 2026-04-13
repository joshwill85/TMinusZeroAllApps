import type { MetadataRoute } from 'next';

import { getCoreSitemapTier, SITEMAP_REVALIDATE_SECONDS } from '@/lib/server/sitemapData';

export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tiers = await getCoreSitemapTier();
  return tiers.coreEntries;
}
