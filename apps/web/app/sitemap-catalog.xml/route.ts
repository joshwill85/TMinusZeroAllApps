import {
  buildSitemapIndexXml,
  buildSitemapXml,
  getCatalogSitemapTier,
  getSitemapPageCount,
  getSitemapPageEntries,
  SITEMAP_CACHE_CONTROL,
  SITEMAP_REVALIDATE_SECONDS
} from '@/lib/server/sitemapData';

export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const tiers = await getCatalogSitemapTier();
  const requestUrl = new URL(request.url);
  const pageCount = getSitemapPageCount(tiers.catalogEntries);
  const page = parsePage(requestUrl.searchParams.get('page'), pageCount);

  const xml =
    page != null
      ? buildSitemapXml(getSitemapPageEntries(tiers.catalogEntries, page))
      : buildSitemapIndexXml(
          Array.from({ length: pageCount }, (_, idx) => `${tiers.siteUrl}/sitemap-catalog.xml?page=${idx + 1}`)
        );

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': SITEMAP_CACHE_CONTROL
    }
  });
}

function parsePage(value: string | null, maxPages: number) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const page = Math.trunc(parsed);
  if (page < 1 || page > maxPages) return null;
  return page;
}
