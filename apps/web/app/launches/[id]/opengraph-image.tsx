import { ImageResponse } from 'next/og';
import { cache } from 'react';
import { isDateOnlyNet } from '@/lib/time';
import { resolveProviderLogoUrl as resolveProviderLogoUrlFromLaunch } from '@/lib/utils/providerLogo';
import { BOT_USER_AGENT } from '@/lib/brand';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Tone = 'success' | 'danger' | 'neutral' | 'warning';

type LaunchShareRow = {
  name: string | null;
  provider: string | null;
  vehicle: string | null;
  rocket_image_url: string | null;
  image_thumbnail_url: string | null;
  image_url: string | null;
  provider_logo_url: string | null;
  provider_image_url: string | null;
  rocket_manufacturer_logo_url: string | null;
  rocket_manufacturer_image_url: string | null;
  pad_short_code: string | null;
  pad_state_code: string | null;
  pad_timezone: string | null;
  net: string | null;
  net_precision: string | null;
  status_abbrev: string | null;
  status_name: string | null;
};

type StatusMeta = {
  label: string;
  tone: Tone;
  isPast: boolean;
  isScrubbed: boolean;
  timelineFillPct: number;
};

const loadFonts = cache(async () => {
  try {
    const fontWeight = 600 as const;
    const fontStyle = 'normal' as const;
    const [spaceGrotesk, jetBrainsMono] = await Promise.all([
      fetchFont('Space Grotesk', fontWeight),
      fetchFont('JetBrains Mono', fontWeight)
    ]);
    return [
      { name: 'Space Grotesk', data: spaceGrotesk, weight: fontWeight, style: fontStyle },
      { name: 'JetBrains Mono', data: jetBrainsMono, weight: fontWeight, style: fontStyle }
    ];
  } catch {
    return [];
  }
});

const fontCache = new Map<string, Promise<ArrayBuffer>>();

async function fetchFont(family: string, weight: number) {
  const cacheKey = `${family}-${weight}`;
  let cached = fontCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const familyQuery = family.replace(/ /g, '+');
      const css = await fetch(`https://fonts.googleapis.com/css2?family=${familyQuery}:wght@${weight}&display=swap`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }).then((res) => res.text());
      const match = css.match(
        new RegExp(`font-weight: ${weight};[\\s\\S]*?src: url\\(([^)]+)\\) format\\('woff2'\\)`)
      );
      if (!match) {
        throw new Error(`Failed to load ${family} ${weight}`);
      }
      const fontResponse = await fetch(match[1]);
      if (!fontResponse.ok) {
        throw new Error(`Failed to fetch ${family} ${weight}`);
      }
      return fontResponse.arrayBuffer();
    })();
    fontCache.set(cacheKey, cached);
  }
  return cached;
}

type OgSearchParams = Record<string, string | string[] | undefined>;

export default async function OpengraphImage({
  params,
  searchParams,
  requestHeaders
}: {
  params: { id: string };
  searchParams?: OgSearchParams;
  requestHeaders?: Headers | null;
}) {
  const debug = isDebugEnabled(searchParams);
  const lite = isLiteEnabled(searchParams);
  logDebug(debug, 'request', { id: params.id, lite, searchParams: sanitizeSearchParams(searchParams) });
  const ifNoneMatch = debug ? null : requestHeaders?.get('if-none-match');

  const launch = await fetchLaunch(params.id, debug);
  const title = truncateText(launch?.name || 'Launch detail', 60);
  const provider = launch?.provider || 'Unknown provider';
  const detailLine = formatDetailLine(launch);
  const statusMeta = resolveStatusMeta(launch);
  const netLabel = formatNetLabel(launch);
  const rawHeroImageUrl = lite ? null : resolveHeroImageUrl(launch);
  const rawProviderLogoUrl = lite
    ? null
    : resolveProviderLogoUrlFromLaunch({
        providerLogoUrl: launch?.provider_logo_url ?? undefined,
        providerImageUrl: launch?.provider_image_url ?? undefined,
        rocket: {
          manufacturerLogoUrl: launch?.rocket_manufacturer_logo_url ?? undefined,
          manufacturerImageUrl: launch?.rocket_manufacturer_image_url ?? undefined
        }
      });
  const heroImageUrl = sanitizeOgImageUrl(rawHeroImageUrl);
  const providerLogoUrl = sanitizeOgImageUrl(rawProviderLogoUrl ?? null);

  if (debug && rawHeroImageUrl && !heroImageUrl) {
    logDebug(true, 'hero image filtered', { url: rawHeroImageUrl });
  }
  if (debug && rawProviderLogoUrl && !providerLogoUrl) {
    logDebug(true, 'provider logo filtered', { url: rawProviderLogoUrl });
  }

  const cacheControl = debug
    ? 'no-store, no-cache, must-revalidate'
    : launch
      ? 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=604800, immutable, no-transform'
      : 'no-store, no-cache, must-revalidate';

  logDebug(debug, 'resolved', {
    title,
    provider,
    detailLine,
    statusMeta,
    netLabel,
    heroImageUrl,
    providerLogoUrl
  });

  try {
    return await buildOgImage({
      title,
      provider,
      detailLine,
      statusMeta,
      netLabel,
      heroImageUrl,
      providerLogoUrl,
      cacheControl,
      debug,
      lite,
      ifNoneMatch
    });
  } catch (error) {
    console.error('opengraph image render failed', error);
    try {
      return await buildFallbackOgImage({
        title,
        provider,
        detailLine,
        statusMeta,
        netLabel,
        heroImageUrl,
        providerLogoUrl,
        cacheControl,
        debug,
        lite,
        ifNoneMatch,
        debugInfo: error instanceof Error ? error.message : 'unknown error'
      });
    } catch (fallbackError) {
      console.error('opengraph image fallback failed', fallbackError);
      return new Response('OG image failed to render', { status: 500 });
    }
  }
}

async function buildOgImage({
  title,
  provider,
  detailLine,
  statusMeta,
  netLabel,
  heroImageUrl,
  providerLogoUrl,
  cacheControl,
  debug,
  lite,
  ifNoneMatch
}: {
  title: string;
  provider: string;
  detailLine: string;
  statusMeta: StatusMeta;
  netLabel: string;
  heroImageUrl: string | null;
  providerLogoUrl: string | null;
  cacheControl: string;
  debug: boolean;
  lite: boolean;
  ifNoneMatch?: string | null;
}) {
  const fonts = lite ? [] : await loadFonts();
  const hasFonts = fonts.length > 0;
  const sansFamily = hasFonts ? 'Space Grotesk' : undefined;
  const monoFamily = hasFonts ? 'JetBrains Mono' : undefined;
  logDebug(debug, 'fonts loaded', { count: fonts.length, hasFonts });
  const rootFont = sansFamily ? { fontFamily: sansFamily } : {};
  const monoFont = monoFamily ? { fontFamily: monoFamily } : {};
  const palette = getTonePalette(statusMeta.tone);
  const heroOpacity = statusMeta.isScrubbed ? 0.18 : 0.7;
  const statusLabel = statusMeta.label;
  const [heroImage, providerLogo] = await Promise.all([
    heroImageUrl ? fetchImageAsDataUrl(heroImageUrl, debug) : Promise.resolve(null),
    providerLogoUrl ? fetchImageAsDataUrl(providerLogoUrl, debug) : Promise.resolve(null)
  ]);
  const heroImageSrc = heroImage?.src ?? heroImageUrl;
  const providerLogoSrc = providerLogo?.src ?? null;
  logDebug(debug, 'image sources', {
    hero: heroImage ? { bytes: heroImage.bytes, contentType: heroImage.contentType } : null,
    providerLogo: providerLogo ? { bytes: providerLogo.bytes, contentType: providerLogo.contentType } : null
  });

  const headers: Record<string, string> = { 'Cache-Control': cacheControl };
  if (debug) {
    headers['X-TMN-OG-Source'] = 'main';
    headers['X-TMN-OG-Hero'] = heroImageSrc ? 'ok' : 'missing';
    headers['X-TMN-OG-Logo'] = providerLogo ? 'ok' : providerLogoUrl ? 'fetch-failed' : 'missing';
    headers['X-TMN-OG-Logo-Inlined'] = providerLogo ? '1' : '0';
    headers['X-TMN-OG-Variant'] = lite ? 'lite' : 'full';
    if (heroImageUrl) headers['X-TMN-OG-Hero-Url'] = toDebugUrlSummary(heroImageUrl);
    if (providerLogoUrl) headers['X-TMN-OG-Logo-Url'] = toDebugUrlSummary(providerLogoUrl);
  }

  return renderImageResponse(
    new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#05060a',
          color: '#e2e8f0',
          ...rootFont
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 1120,
            height: 550,
            borderRadius: 24,
            border: `1px solid ${palette.border}`,
            backgroundColor: '#0b1020',
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
	          {heroImageSrc ? (
	            <div
	              style={{
	                position: 'absolute',
	                top: -24,
	                bottom: -24,
	                right: -32,
	                width: '60%',
	                opacity: heroOpacity,
	                display: 'flex'
	              }}
	            >
              <img
                src={heroImageSrc}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'right center'
                }}
              />
            </div>
          ) : null}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              backgroundImage:
                'linear-gradient(90deg, rgba(8, 12, 26, 0.98) 0%, rgba(8, 12, 26, 0.88) 48%, rgba(8, 12, 26, 0.55) 70%, rgba(8, 12, 26, 0.18) 100%)'
            }}
          />

            <div
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                padding: '48px 56px'
              }}
            >
	            <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 52,
                  gap: 18
                }}
              >
	              {providerLogoSrc ? (
	                <div
	                  style={{
	                    display: 'flex',
	                    alignItems: 'center',
	                    justifyContent: 'center',
	                    padding: '8px 14px',
	                    borderRadius: 16,
	                    border: '1px solid rgba(255, 255, 255, 0.14)',
	                    backgroundColor: 'rgba(7, 9, 19, 0.72)',
	                    boxShadow: '0 0 18px rgba(34, 211, 238, 0.12)',
	                    width: 250,
	                    height: 56
	                  }}
	                >
	                  <img src={providerLogoSrc} alt="" style={{ height: 40, width: 220, objectFit: 'contain' }} />
	                </div>
	              ) : (
	                <div
	                  style={{
	                    display: 'flex',
	                    alignItems: 'center',
	                    justifyContent: 'center',
	                    padding: '8px 14px',
	                    borderRadius: 999,
	                    border: '1px solid rgba(255, 255, 255, 0.12)',
	                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
	                    fontSize: 11,
	                    letterSpacing: '0.28em',
	                    textTransform: 'uppercase',
	                    color: '#cbd5e1',
	                    fontWeight: 700,
	                    maxWidth: 260,
	                    ...monoFont
	                  }}
	                >
	                  {truncateText(provider, 22).toUpperCase()}
	                </div>
	              )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    fontSize: 12,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: palette.accent,
                    fontWeight: 700,
                    ...monoFont
                  }}
                >
                  {statusLabel}
                </div>
            </div>

	            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
	              <div
	                style={{
	                  display: 'flex',
	                  fontSize: 44,
	                  fontWeight: 600,
	                  textTransform: 'uppercase',
	                  letterSpacing: '0.16em',
	                  color: '#f5f7ff',
	                  lineHeight: 1.1,
	                  maxWidth: 760,
	                  ...monoFont
	                }}
	              >
	                {title}
	              </div>
	              {detailLine ? (
	                <div
	                  style={{
	                    display: 'flex',
	                    fontSize: 15,
	                    letterSpacing: '0.22em',
	                    textTransform: 'uppercase',
	                    color: '#94a3b8',
	                    fontWeight: 600,
                    maxWidth: 720
                  }}
                >
                  {detailLine}
                </div>
              ) : null}
            </div>

	            <div
	              style={{
	                marginTop: 'auto',
	                display: 'flex',
	                flexDirection: 'column',
	                gap: 8
	              }}
	            >
	              <div
	                style={{
	                  display: 'flex',
	                  fontSize: 12,
	                  letterSpacing: '0.32em',
	                  textTransform: 'uppercase',
	                  color: '#94a3b8',
	                  fontWeight: 600
                }}
              >
                NET
              </div>
	              <div
	                style={{
	                  display: 'flex',
	                  fontSize: 30,
	                  fontWeight: 600,
	                  color: '#f8fafc',
	                  maxWidth: 640,
                  lineHeight: 1.2,
                  ...monoFont
                }}
              >
                {netLabel}
              </div>
            </div>
          </div>
          {debug ? (
            <div
              style={{
                position: 'absolute',
                bottom: 18,
                right: 20,
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(148, 163, 184, 0.3)',
                backgroundColor: 'rgba(15, 23, 42, 0.72)',
                color: '#e2e8f0',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase'
              }}
	            >
	              <div style={{ display: 'flex' }}>{`hero ${heroImageSrc ? 'ok' : 'missing'}`}</div>
	              <div style={{ display: 'flex' }}>{`logo ${providerLogoSrc ? 'ok' : providerLogoUrl ? 'fetch-failed' : 'missing'}`}</div>
	            </div>
	          ) : null}
        </div>
      </div>
    ),
      {
        width: size.width,
        height: size.height,
        headers,
        fonts: hasFonts ? fonts : undefined
      }
    ),
    ifNoneMatch
  );
}

async function renderImageResponse(response: ImageResponse, ifNoneMatch?: string | null) {
  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('OG image rendered empty');
  }
  const headers = new Headers(response.headers);
  const etag = await buildEtag(buffer);
  if (etag) headers.set('ETag', etag);
  headers.set('Content-Length', String(buffer.byteLength));
  if (etag && ifNoneMatch && matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(buffer, { status: response.status, headers });
}

async function buildEtag(buffer: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const base64 = arrayBufferToBase64(hash);
  return `"${base64}"`;
}

function matchesIfNoneMatch(header: string, etag: string) {
  const normalized = normalizeEtag(etag);
  if (header.trim() === '*') return true;
  return header.split(',').some((value) => normalizeEtag(value) === normalized);
}

function normalizeEtag(value: string) {
  return value.replace(/^W\//i, '').trim();
}

async function buildFallbackOgImage({
  title,
  provider,
  detailLine,
  statusMeta,
  netLabel,
  heroImageUrl,
  providerLogoUrl,
  cacheControl,
  debug,
  lite,
  ifNoneMatch,
  debugInfo
}: {
  title: string;
  provider: string;
  detailLine: string;
  statusMeta: StatusMeta;
  netLabel: string;
  heroImageUrl: string | null;
  providerLogoUrl: string | null;
  cacheControl: string;
  debug?: boolean;
  lite: boolean;
  ifNoneMatch?: string | null;
  debugInfo?: string;
}) {
  const palette = getTonePalette(statusMeta.tone);
  const statusText = statusMeta.label;
  const secondaryLine = detailLine || provider;
  const debugLabel = debugInfo ? truncateText(debugInfo, 120) : 'unknown';
  const [heroImage, providerLogo] = await Promise.all([
    heroImageUrl ? fetchImageAsDataUrl(heroImageUrl, Boolean(debug)) : Promise.resolve(null),
    providerLogoUrl ? fetchImageAsDataUrl(providerLogoUrl, Boolean(debug)) : Promise.resolve(null)
  ]);
  const heroImageSrc = heroImage?.src ?? heroImageUrl;
  const providerLogoSrc = providerLogo?.src ?? null;

  const headers: Record<string, string> = { 'Cache-Control': cacheControl };
  if (debug) {
    headers['X-TMN-OG-Source'] = 'fallback';
    headers['X-TMN-OG-Hero'] = heroImageSrc ? 'ok' : 'missing';
    headers['X-TMN-OG-Logo'] = providerLogo ? 'ok' : providerLogoUrl ? 'fetch-failed' : 'missing';
    headers['X-TMN-OG-Logo-Inlined'] = providerLogo ? '1' : '0';
    headers['X-TMN-OG-Variant'] = lite ? 'lite' : 'full';
    if (heroImageUrl) headers['X-TMN-OG-Hero-Url'] = toDebugUrlSummary(heroImageUrl);
    if (providerLogoUrl) headers['X-TMN-OG-Logo-Url'] = toDebugUrlSummary(providerLogoUrl);
    headers['X-TMN-OG-Error'] = debugLabel;
  }

  return renderImageResponse(
    new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#05060a',
          color: '#f8fafc'
        }}
      >
        <div
          style={{
            width: 1120,
            height: 550,
            borderRadius: 24,
            border: `1px solid ${palette.border}`,
            backgroundColor: '#0b1020',
            position: 'relative',
            overflow: 'hidden',
            padding: '40px 48px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {heroImageSrc ? (
            <div
              style={{
                position: 'absolute',
                top: -24,
                bottom: -24,
                right: -32,
                width: '60%',
                opacity: 0.65,
                display: 'flex'
              }}
            >
              <img
                src={heroImageSrc}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'right center'
                }}
              />
            </div>
          ) : null}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              backgroundImage:
                'linear-gradient(90deg, rgba(8, 12, 26, 0.98) 0%, rgba(8, 12, 26, 0.88) 48%, rgba(8, 12, 26, 0.55) 70%, rgba(8, 12, 26, 0.18) 100%)'
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: 52
              }}
            >
              {providerLogoSrc ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 14px',
                    borderRadius: 16,
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    backgroundColor: 'rgba(7, 9, 19, 0.72)',
                    boxShadow: '0 0 18px rgba(34, 211, 238, 0.12)',
                    width: 250,
                    height: 56
                  }}
                >
                  <img src={providerLogoSrc} alt="" style={{ height: 40, width: 220, objectFit: 'contain' }} />
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    fontSize: 11,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#cbd5e1',
                    fontWeight: 700,
                    maxWidth: 260
                  }}
                >
                  {truncateText(provider, 22).toUpperCase()}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  fontSize: 12,
                  letterSpacing: '0.28em',
                  textTransform: 'uppercase',
                  color: palette.accent,
                  fontWeight: 700
                }}
              >
                {statusText}
              </div>
            </div>

            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: 44,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  color: '#f5f7ff',
                  lineHeight: 1.1,
                  maxWidth: 760
                }}
              >
                {title}
              </div>
              {secondaryLine ? (
                <div
                  style={{
                    display: 'flex',
                    fontSize: 15,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                    fontWeight: 600,
                    maxWidth: 720
                  }}
                >
                  {secondaryLine}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'flex',
                  fontSize: 12,
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase',
                  color: '#94a3b8',
                  fontWeight: 600
                }}
              >
                NET
              </div>
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, color: '#f8fafc', maxWidth: 640 }}>
                {netLabel}
              </div>
            </div>
          </div>
          {debug ? (
            <div
              style={{
                position: 'absolute',
                bottom: 18,
                left: 20,
                zIndex: 2,
                display: 'flex',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(148, 163, 184, 0.3)',
                backgroundColor: 'rgba(15, 23, 42, 0.65)',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#e2e8f0'
              }}
            >
              {`fallback: ${debugLabel} • hero ${heroImageSrc ? 'ok' : 'missing'} • logo ${providerLogoSrc ? 'ok' : providerLogoUrl ? 'fetch-failed' : 'missing'}`}
            </div>
          ) : null}
        </div>
      </div>
    ),
      {
        width: size.width,
        height: size.height,
        headers
      }
    ),
    ifNoneMatch
  );
}

function toDebugUrlSummary(url: string, maxLength = 180) {
  try {
    const parsed = new URL(url);
    const summary = `${parsed.hostname}${parsed.pathname}`;
    return summary.length > maxLength ? `${summary.slice(0, maxLength - 3)}...` : summary;
  } catch {
    const trimmed = url.trim();
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
  }
}

function resolveStatusMeta(launch: LaunchShareRow | null): StatusMeta {
  const statusCombined = `${launch?.status_abbrev ?? ''} ${launch?.status_name ?? ''}`.toLowerCase();
  const isScrubbed = statusCombined.includes('scrub');
  const isHold = statusCombined.includes('hold');
  const isGo = statusCombined.includes('go');
  const isSuccess = statusCombined.includes('success') || statusCombined.includes('successful');
  const isFailure = statusCombined.includes('fail') || statusCombined.includes('anomaly') || statusCombined.includes('partial');

  const netMs = parseNetMs(launch?.net);
  const isDateOnly = launch?.net ? isDateOnlyNet(launch.net, (launch.net_precision as any) || undefined) : true;
  const isPast = netMs != null && !isDateOnly && netMs < Date.now();

  let tone: Tone = 'neutral';
  if (isSuccess || isGo) tone = 'success';
  if (isFailure || isScrubbed || isHold) tone = 'danger';

  const statusLabel = launch?.status_abbrev || launch?.status_name || (isDateOnly ? 'Awaiting Net' : 'Status Pending');

  return {
    label: truncateText(statusLabel.toUpperCase(), 22),
    tone,
    isPast,
    isScrubbed,
    timelineFillPct: computeTimelineFillPct(netMs, isDateOnly, isPast)
  };
}

function computeTimelineFillPct(netMs: number | null, isDateOnly: boolean, isPast: boolean) {
  if (isPast) return 100;
  if (isDateOnly) return 85;
  if (netMs == null) return 40;
  const diffSeconds = Math.max(0, Math.floor((netMs - Date.now()) / 1000));
  const horizonSeconds = 24 * 60 * 60;
  return Math.min(100, Math.max(4, (diffSeconds / horizonSeconds) * 100));
}

function parseNetMs(net: string | null | undefined) {
  if (!net) return null;
  const date = new Date(net);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function formatDetailLine(launch: LaunchShareRow | null) {
  if (!launch) return '';
  const padParts = [launch.pad_short_code, launch.pad_state_code].filter(Boolean) as string[];
  const parts = padParts.length > 0 ? padParts : [launch.vehicle].filter(Boolean);
  if (parts.length === 0) return '';
  return truncateText(parts.join(' | '), 56);
}

function formatNetLabel(launch: LaunchShareRow | null) {
  if (!launch?.net) return 'TBD';
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return 'TBD';
  const timezone = launch.pad_timezone || 'America/New_York';

  if (isDateOnlyNet(launch.net, (launch.net_precision as any) || undefined)) {
    const day = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: timezone
    }).format(date);
    return `${day} | Time TBD`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short'
  }).format(date);
}

function truncateText(value: string, maxLength: number) {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sanitizeOgImageUrl(url: string | null) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const stripped = trimmed.split('?')[0]?.toLowerCase() || '';
  if (stripped.endsWith('.svg')) return null;
  return trimmed;
}

type FetchedImage = {
  src: string;
  bytes: number;
  contentType: string;
};

async function fetchImageAsDataUrl(url: string, debug: boolean): Promise<FetchedImage | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': BOT_USER_AGENT
      },
      cache: 'no-store'
    });
    if (!response.ok) {
      logDebug(debug, 'image fetch failed', { url, status: response.status });
      return null;
    }
    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
    if (!contentType.startsWith('image/') || contentType.includes('svg')) {
      logDebug(debug, 'image content-type unsupported', { url, contentType });
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      logDebug(debug, 'image fetch empty', { url });
      return null;
    }
    const base64 = arrayBufferToBase64(buffer);
    return {
      src: `data:${contentType};base64,${base64}`,
      bytes: buffer.byteLength,
      contentType
    };
  } catch (error) {
    logDebug(debug, 'image fetch error', { url, error: (error as Error)?.message || 'unknown' });
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  if (typeof btoa === 'undefined') {
    throw new Error('Base64 encoder unavailable');
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isDebugEnabled(searchParams?: OgSearchParams) {
  const value = searchParams?.debug;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const shareValue = searchParams?.share;
  const shareValues = Array.isArray(shareValue) ? shareValue : shareValue ? [shareValue] : [];
  return [...values, ...shareValues].some((entry) => ['1', 'true', 'yes', 'debug'].includes(entry.trim().toLowerCase()));
}

function isLiteEnabled(searchParams?: OgSearchParams) {
  const value = searchParams?.lite;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.some((entry) => ['1', 'true', 'yes', 'lite'].includes(entry.trim().toLowerCase()));
}

function sanitizeSearchParams(searchParams?: OgSearchParams) {
  if (!searchParams) return undefined;
  const safe: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (!value) {
      safe[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value.slice(0, 3);
      continue;
    }
    safe[key] = value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  return safe;
}

function logDebug(enabled: boolean, message: string, payload?: Record<string, unknown>) {
  if (!enabled) return;
  if (payload) {
    console.info(`[og-image] ${message}`, payload);
    return;
  }
  console.info(`[og-image] ${message}`);
}

function resolveHeroImageUrl(launch: LaunchShareRow | null) {
  if (!launch) return null;
  return launch.rocket_image_url || launch.image_url || launch.image_thumbnail_url || null;
}

function getTonePalette(tone: Tone) {
  switch (tone) {
    case 'success':
      return {
        accent: '#34d399',
        border: 'rgba(52, 211, 153, 0.5)',
        ring: 'rgba(52, 211, 153, 0.14)',
        glow: 'rgba(52, 211, 153, 0.18)'
      };
    case 'danger':
      return {
        accent: '#fb7185',
        border: 'rgba(251, 113, 133, 0.55)',
        ring: 'rgba(251, 113, 133, 0.14)',
        glow: 'rgba(251, 113, 133, 0.18)'
      };
    case 'warning':
      return {
        accent: '#fbbf24',
        border: 'rgba(251, 191, 36, 0.5)',
        ring: 'rgba(251, 191, 36, 0.18)',
        glow: 'rgba(251, 191, 36, 0.2)'
      };
    default:
      return {
        accent: '#e2e8f0',
        border: 'rgba(255, 255, 255, 0.12)',
        ring: 'rgba(234, 240, 255, 0.04)',
        glow: 'rgba(234, 240, 255, 0.04)'
      };
  }
}

async function fetchLaunch(id: string, debug = false): Promise<LaunchShareRow | null> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) {
    logDebug(debug, 'supabase env missing', { urlPresent: Boolean(url), anonPresent: Boolean(anon) });
    return null;
  }
  if (url.includes('your-supabase-url.supabase.co') || url.includes('<project-ref>')) {
    logDebug(debug, 'supabase url placeholder', { url });
    return null;
  }
  if (anon === 'SUPABASE_ANON_KEY' || anon === 'anon_placeholder' || anon === 'public_anon_key') {
    logDebug(debug, 'supabase anon placeholder');
    return null;
  }

  const params = new URLSearchParams({
    select:
      'launch_id,name,provider,vehicle,rocket_image_url,image_thumbnail_url,image_url,provider_logo_url,provider_image_url,rocket_manufacturer_logo_url,rocket_manufacturer_image_url,pad_short_code,pad_state_code,pad_timezone,net,net_precision,status_abbrev,status_name',
    launch_id: `eq.${id}`,
    limit: '1'
  });

  try {
    const response = await fetch(`${url}/rest/v1/launches_public_cache?${params.toString()}`, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      logDebug(debug, 'supabase fetch failed', { status: response.status });
      return null;
    }
    const data = (await response.json()) as LaunchShareRow[];
    const row = data?.[0] ?? null;
    if (!row) logDebug(debug, 'supabase no launch row');
    return row;
  } catch {
    logDebug(debug, 'supabase fetch threw');
    return null;
  }
}
