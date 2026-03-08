import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/server/env';
import { fetchSatelliteSitemapBatch } from '@/lib/server/satellites';
import { buildSitemapIndexXml, buildSitemapXml, SITEMAP_CACHE_CONTROL, SITEMAP_REVALIDATE_SECONDS } from '@/lib/server/sitemapData';
import { buildSatelliteHref } from '@/lib/utils/satelliteLinks';

export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = 'force-dynamic';

const SATELLITE_SITEMAP_PAGE_SIZE = 5000;
const SATELLITE_SITEMAP_MAX_PAGES = 200;

export async function GET(request: Request) {
  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const requestUrl = new URL(request.url);
  const page = parsePage(requestUrl.searchParams.get('page'));

  if (page != null) {
    const entries = await getSatellitePageEntries(siteUrl, page);
    return new Response(buildSitemapXml(entries), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': SITEMAP_CACHE_CONTROL
      }
    });
  }

  const pageCount = await resolveSatelliteSitemapPageCount();
  const sitemapUrls = Array.from({ length: Math.max(1, pageCount) }, (_, idx) => `${siteUrl}/sitemap-satellites.xml?page=${idx + 1}`);
  const xml = buildSitemapIndexXml(sitemapUrls);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': SITEMAP_CACHE_CONTROL
    }
  });
}

async function getSatellitePageEntries(siteUrl: string, page: number): Promise<MetadataRoute.Sitemap> {
  const offset = (page - 1) * SATELLITE_SITEMAP_PAGE_SIZE;
  const batch = await fetchSatelliteSitemapBatch(SATELLITE_SITEMAP_PAGE_SIZE, offset);
  return batch.map((row) => ({
    url: `${siteUrl}${buildSatelliteHref(row.noradCatId)}`,
    lastModified: parseDate(row.satcatUpdatedAt),
    changeFrequency: 'weekly',
    priority: 0.52
  }));
}

async function resolveSatelliteSitemapPageCount() {
  let pages = 0;
  for (let page = 1; page <= SATELLITE_SITEMAP_MAX_PAGES; page += 1) {
    const offset = (page - 1) * SATELLITE_SITEMAP_PAGE_SIZE;
    const batch = await fetchSatelliteSitemapBatch(SATELLITE_SITEMAP_PAGE_SIZE, offset);
    if (batch.length === 0) break;
    pages = page;
    if (batch.length < SATELLITE_SITEMAP_PAGE_SIZE) break;
  }
  return pages;
}

function parsePage(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const page = Math.trunc(parsed);
  if (page < 1 || page > SATELLITE_SITEMAP_MAX_PAGES) return null;
  return page;
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}
