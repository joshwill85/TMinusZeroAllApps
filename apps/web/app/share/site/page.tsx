import type { Metadata } from 'next';
import Link from 'next/link';
import { ShareLaunchRedirect } from '@/components/ShareLaunchRedirect';
import { buildSiteMeta } from '@/lib/server/siteMeta';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Site Share Debug | ${BRAND_NAME}`,
  robots: { index: false, follow: false }
};

type ShareSearchParams = Record<string, string | string[] | undefined>;

type OgInspect = {
  status: number;
  ok: boolean;
  contentType: string | null;
  cacheControl: string | null;
  source: string | null;
  error: string | null;
};

function getFirstParam(value?: string | string[]) {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function buildSiteOgMeta(searchParams?: ShareSearchParams) {
  const ogOverride = getFirstParam(searchParams?.og) || getFirstParam(searchParams?.v);
  return buildSiteMeta({ ogOverride: ogOverride || null });
}

function formatMetaTags(meta: ReturnType<typeof buildSiteMeta>) {
  const tags = [
    `<title>${meta.title}</title>`,
    `<meta name=\"description\" content=\"${meta.description}\" />`,
    `<link rel=\"canonical\" href=\"${meta.siteUrl}\" />`,
    `<meta property=\"og:title\" content=\"${meta.ogTitle}\" />`,
    `<meta property=\"og:description\" content=\"${meta.ogDescription}\" />`,
    `<meta property=\"og:url\" content=\"${meta.siteUrl}\" />`,
    `<meta property=\"og:site_name\" content=\"${meta.siteName}\" />`,
    `<meta property=\"og:image\" content=\"${meta.ogImage}\" />`,
    `<meta property=\"og:image:width\" content=\"1200\" />`,
    `<meta property=\"og:image:height\" content=\"630\" />`,
    `<meta property=\"og:image:alt\" content=\"${meta.ogImageAlt}\" />`,
    `<meta property=\"og:image:type\" content=\"image/jpeg\" />`,
    `<meta property=\"og:type\" content=\"website\" />`,
    `<meta name=\"twitter:card\" content=\"summary_large_image\" />`,
    `<meta name=\"twitter:title\" content=\"${meta.ogTitle}\" />`,
    `<meta name=\"twitter:description\" content=\"${meta.ogDescription}\" />`,
    `<meta name=\"twitter:image\" content=\"${meta.ogImage}\" />`,
    `<meta name=\"twitter:image:alt\" content=\"${meta.ogImageAlt}\" />`
  ];

  return tags.join('\n');
}

function isDebugEnabled(searchParams?: ShareSearchParams) {
  const value = getFirstParam(searchParams?.debug);
  if (!value) return false;
  return ['1', 'true', 'yes', 'debug'].includes(value.trim().toLowerCase());
}

async function inspectOgImage(url: string): Promise<OgInspect> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      source: response.headers.get('x-tmn-og-source'),
      error: response.headers.get('x-tmn-og-error')
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    return {
      status: 0,
      ok: false,
      contentType: null,
      cacheControl: null,
      source: null,
      error: message
    };
  }
}

export default async function ShareSitePage({ searchParams }: { searchParams?: ShareSearchParams }) {
  const debug = isDebugEnabled(searchParams);
  const meta = buildSiteOgMeta(searchParams);
  const ogInspect = debug ? await inspectOgImage(meta.ogImage) : null;
  const metaTags = debug ? formatMetaTags(meta) : null;
  const target = '/';

  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {!debug && <ShareLaunchRedirect target={target} />}
      <div className="text-xs uppercase tracking-[0.1em] text-text3">Sharing site</div>
      <h1 className="text-2xl font-semibold text-text1">{meta.ogTitle}</h1>
      <p className="text-sm text-text2">{debug ? 'Debug mode enabled.' : 'Redirecting to the homepage...'}</p>
      <Link href={target} className="btn-secondary rounded-lg px-4 py-2 text-sm">
        Open homepage
      </Link>
      {debug && (
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
          {ogInspect && (
            <div className="mt-3 rounded-lg border border-stroke bg-black/20 p-3 font-mono text-[11px] text-text2">
              <div>
                Status: {ogInspect.status || 'error'} {ogInspect.ok ? '(ok)' : '(not ok)'}
              </div>
              <div>Content-Type: {ogInspect.contentType || 'unknown'}</div>
              <div>Cache-Control: {ogInspect.cacheControl || 'unknown'}</div>
              <div>X-TMN-OG-Source: {ogInspect.source || 'missing'}</div>
              {ogInspect.error && <div>X-TMN-OG-Error: {ogInspect.error}</div>}
            </div>
          )}
          <img
            src={meta.ogImage}
            alt={meta.ogImageAlt}
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
