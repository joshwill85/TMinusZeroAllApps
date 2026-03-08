import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildLaunchShare } from '@/lib/share';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getOgImageVersion, getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { buildOgVersionSegment } from '@/lib/server/og';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { ShareLaunchRedirect } from '@/components/ShareLaunchRedirect';
import { SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export const dynamic = 'force-dynamic';

type ShareLaunch = {
  launch: ReturnType<typeof mapPublicCacheRow>;
  cacheGeneratedAt?: string | null;
};

type ShareSearchParams = Record<string, string | string[] | undefined>;

const fetchLaunch = cache(async (id: string): Promise<ShareLaunch | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('*')
      .eq('launch_id', id)
      .maybeSingle();
    if (error || !data) return null;
    return { launch: mapPublicCacheRow(data), cacheGeneratedAt: data.cache_generated_at ?? null };
  } catch {
    return null;
  }
});

function buildShareMeta(shareData: ShareLaunch, searchParams?: ShareSearchParams) {
  const { launch, cacheGeneratedAt } = shareData;
  const share = buildLaunchShare(launch);
  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}${share.path}`;
  const canonical = buildLaunchHref(launch);
  const version = cacheGeneratedAt || undefined;
  const ogVersion = getOgImageVersion();
  const ogOverrideParam = searchParams?.og;
  const ogOverride = Array.isArray(ogOverrideParam) ? ogOverrideParam[0] : ogOverrideParam;
  const versionSegment = buildOgVersionSegment({
    baseVersion: ogVersion,
    cacheGeneratedAt: version,
    override: ogOverride || null
  });
  const ogImage = `${siteUrl}/launches/${launch.id}/opengraph-image/${versionSegment}/jpeg`;

  return {
    launch,
    share,
    shareUrl,
    canonical,
    ogImage
  };
}

function formatMetaTags(meta: ReturnType<typeof buildShareMeta>) {
  const { launch, share, shareUrl, canonical, ogImage } = meta;
  const tags = [
    `<title>${share.title}</title>`,
    `<meta name=\"description\" content=\"${share.text}\" />`,
    `<meta name=\"robots\" content=\"noindex, follow\" />`,
    `<link rel=\"canonical\" href=\"${getSiteUrl()}${canonical}\" />`,
    `<meta property=\"og:title\" content=\"${share.title}\" />`,
    `<meta property=\"og:description\" content=\"${share.text}\" />`,
    `<meta property=\"og:url\" content=\"${shareUrl}\" />`,
    `<meta property=\"og:site_name\" content=\"${SITE_META.siteName}\" />`,
    `<meta property=\"og:image\" content=\"${ogImage}\" />`,
    `<meta property=\"og:image:width\" content=\"1200\" />`,
    `<meta property=\"og:image:height\" content=\"630\" />`,
    `<meta property=\"og:image:alt\" content=\"${launch.name} launch card\" />`,
    `<meta property=\"og:image:type\" content=\"image/jpeg\" />`,
    `<meta property=\"og:type\" content=\"website\" />`,
    `<meta name=\"twitter:card\" content=\"summary_large_image\" />`,
    `<meta name=\"twitter:title\" content=\"${share.title}\" />`,
    `<meta name=\"twitter:description\" content=\"${share.text}\" />`,
    `<meta name=\"twitter:image\" content=\"${ogImage}\" />`,
    `<meta name=\"twitter:image:alt\" content=\"${launch.name} launch card\" />`
  ];

  return tags.join('\n');
}

function isDebugEnabled(searchParams?: ShareSearchParams) {
  const value = searchParams?.debug;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const shareValue = searchParams?.share;
  const shareValues = Array.isArray(shareValue) ? shareValue : shareValue ? [shareValue] : [];
  return [...values, ...shareValues].some((entry) => ['1', 'true', 'yes', 'debug'].includes(entry.trim().toLowerCase()));
}

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: ShareSearchParams;
}): Promise<Metadata> {
  const shareData = await fetchLaunch(params.id);
  if (!shareData) {
    return {
      title: `Launch not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const meta = buildShareMeta(shareData, searchParams);

  return {
    title: meta.share.title,
    description: meta.share.text,
    alternates: { canonical: meta.canonical },
    openGraph: {
      title: meta.share.title,
      description: meta.share.text,
      url: meta.shareUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [
        {
          url: meta.ogImage,
          width: 1200,
          height: 630,
          alt: `${meta.launch.name} launch card`,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.share.title,
      description: meta.share.text,
      images: [
        {
          url: meta.ogImage,
          alt: `${meta.launch.name} launch card`
        }
      ]
    },
    robots: { index: false, follow: true }
  };
}

export default async function ShareLaunchDebugPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: ShareSearchParams;
}) {
  const shareData = await fetchLaunch(params.id);
  if (!shareData) return notFound();

  const target = buildLaunchHref(shareData.launch);
  const debug = isDebugEnabled(searchParams);
  const meta = debug ? buildShareMeta(shareData, searchParams) : null;
  const metaTags = meta ? formatMetaTags(meta) : null;

  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {!debug && <ShareLaunchRedirect target={target} />}
      <div className="text-xs uppercase tracking-[0.1em] text-text3">Sharing launch</div>
      <h1 className="text-2xl font-semibold text-text1">{shareData.launch.name}</h1>
      <p className="text-sm text-text2">{debug ? 'Debug mode enabled.' : 'Redirecting to the launch details…'}</p>
      <Link href={target} className="btn-secondary rounded-lg px-4 py-2 text-sm">
        Open launch detail
      </Link>
      {meta && (
        <div className="mt-6 w-full rounded-xl border border-stroke bg-surface-1 p-4 text-left text-xs text-text2">
          <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-text3">OG image preview</div>
          <a
            href={meta.ogImage}
            target="_blank"
            rel="noreferrer"
            className="block break-all font-mono text-[11px] text-text2 underline"
          >
            {meta.ogImage}
          </a>
          <img
            src={meta.ogImage}
            alt={`${shareData.launch.name} OG preview`}
            className="mt-3 w-full rounded-lg border border-stroke bg-black/20"
          />
        </div>
      )}
      {metaTags && (
        <div className="mt-6 w-full rounded-xl border border-stroke bg-surface-1 p-4 text-left text-xs text-text2">
          <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-text3">Resolved meta tags</div>
          <pre className="whitespace-pre-wrap break-all">{metaTags}</pre>
        </div>
      )}
    </div>
  );
}
