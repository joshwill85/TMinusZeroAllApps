import { mapPublicCacheRow } from '@/lib/server/transformers';
import { buildLaunchShare } from '@/lib/share';
import { buildOgVersionSegment } from '@/lib/server/og';
import { getOgImageVersion, getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const runtime = 'edge';

const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const requestUrl = new URL(request.url);
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const shareUrl = `${siteUrl}${requestUrl.pathname}${requestUrl.search}`;

  if (!isSupabaseConfigured()) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  const launchRow = await fetchLaunchRow(params.id);
  if (!launchRow) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  const launch = mapPublicCacheRow(launchRow);
  const share = buildLaunchShare(launch);
  const canonicalPath = buildLaunchHref(launch);
  const canonicalUrl = `${siteUrl}${canonicalPath}`;

  const ogOverride = requestUrl.searchParams.get('og') || null;
  const ogBaseVersion = getOgImageVersion();
  const versionSegment = buildOgVersionSegment({
    baseVersion: ogBaseVersion,
    cacheGeneratedAt: launch.cacheGeneratedAt ?? null,
    override: ogOverride
  });
  const ogImage = `${siteUrl}/launches/${launch.id}/opengraph-image/${versionSegment}/jpeg`;
  const ogAlt = `${launch.name} launch card`;

  const title = share.title;
  const description = share.text;

  const html = buildHtml({
    title,
    description,
    canonicalUrl,
    shareUrl,
    ogImage,
    ogAlt,
    redirectTarget: canonicalUrl
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL
    }
  });
}

async function fetchLaunchRow(id: string): Promise<Record<string, unknown> | null> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) return null;

  const params = new URLSearchParams({
    select: '*',
    launch_id: `eq.${id}`,
    limit: '1'
  });

  const response = await fetch(`${supabaseUrl}/rest/v1/launches_public_cache?${params.toString()}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    cache: 'no-store'
  });

  if (!response.ok) return null;
  const data = (await response.json()) as Array<Record<string, unknown>>;
  return data?.[0] ?? null;
}

function buildHtml({
  title,
  description,
  canonicalUrl,
  shareUrl,
  ogImage,
  ogAlt,
  redirectTarget
}: {
  title: string;
  description: string;
  canonicalUrl: string;
  shareUrl: string;
  ogImage: string;
  ogAlt: string;
  redirectTarget: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeCanonicalUrl = escapeHtml(canonicalUrl);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeOgImage = escapeHtml(ogImage);
  const safeOgAlt = escapeHtml(ogAlt);
  const safeRedirect = escapeHtml(redirectTarget);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${safeTitle}</title>`,
    `<meta name="description" content="${safeDescription}" />`,
    '<meta name="robots" content="noindex, follow" />',
    `<link rel="canonical" href="${safeCanonicalUrl}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDescription}" />`,
    `<meta property="og:url" content="${safeShareUrl}" />`,
    '<meta property="og:site_name" content="T-Minus Zero" />',
    `<meta property="og:image" content="${safeOgImage}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${safeOgAlt}" />`,
    '<meta property="og:image:type" content="image/jpeg" />',
    '<meta property="og:type" content="website" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDescription}" />`,
    `<meta name="twitter:image" content="${safeOgImage}" />`,
    `<meta name="twitter:image:alt" content="${safeOgAlt}" />`,
    '</head>',
    '<body>',
    `<p>Redirecting to <a href="${safeCanonicalUrl}">${safeCanonicalUrl}</a>…</p>`,
    `<script>location.replace(${JSON.stringify(safeRedirect)});</script>`,
    '</body>',
    '</html>'
  ].join('\n');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
