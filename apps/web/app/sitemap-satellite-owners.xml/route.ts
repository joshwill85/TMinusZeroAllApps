import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/server/env';
import { fetchAllSatelliteOwners } from '@/lib/server/satellites';
import { buildSitemapXml, SITEMAP_CACHE_CONTROL, SITEMAP_REVALIDATE_SECONDS } from '@/lib/server/sitemapData';
import { buildSatelliteOwnerHref } from '@/lib/utils/satelliteLinks';

export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = 'force-dynamic';

export async function GET() {
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const owners = await fetchAllSatelliteOwners();

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/satellites/owners`,
      changeFrequency: 'daily',
      priority: 0.62
    }
  ];

  for (const row of owners) {
    const href = buildSatelliteOwnerHref(row.owner);
    if (!href) continue;
    entries.push({
      url: `${siteUrl}${href}`,
      lastModified: parseDate(row.lastSatcatUpdatedAt),
      changeFrequency: 'weekly',
      priority: 0.54
    });
  }

  return new Response(buildSitemapXml(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': SITEMAP_CACHE_CONTROL
    }
  });
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}
