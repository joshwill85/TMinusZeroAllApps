import { ImageResponse } from 'next/og';
import { cache } from 'react';
import { BRAND_TECHNICAL_NAME } from '@/lib/brand';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND_TECHNICAL_NAME} orbit arc with a minimalist rocket`;

const cacheControl = 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=604800, immutable, no-transform';
const cacheControlFallback = 'no-store, no-cache, must-revalidate';
const fontCache = new Map<string, Promise<ArrayBuffer>>();

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

export default async function OpengraphImage() {
  try {
    return await buildOgImage();
  } catch (error) {
    console.error('site og image render failed', error);
    try {
      const debugLabel = buildErrorLabel(error);
      return await buildFallbackOgImage(debugLabel);
    } catch (fallbackError) {
      console.error('site og image fallback failed', fallbackError);
      return new Response('OG image failed to render', { status: 500 });
    }
  }
}

async function buildOgImage() {
  const fonts = await loadFonts();
  const hasFonts = fonts.length > 0;
  const rootFont = hasFonts ? { fontFamily: 'Space Grotesk' } : {};
  const monoFont = hasFonts ? { fontFamily: 'JetBrains Mono' } : {};
  const horizonPath = 'M -120 610 C 240 540, 960 540, 1320 610';
  const planetPath = `${horizonPath} L 1320 760 L -120 760 Z`;
  const stars = [
    { cx: 72, cy: 64, r: 1.6, o: 0.62 },
    { cx: 112, cy: 92, r: 1.2, o: 0.55 },
    { cx: 168, cy: 70, r: 1.1, o: 0.48 },
    { cx: 220, cy: 110, r: 1.8, o: 0.6 },
    { cx: 268, cy: 76, r: 1.0, o: 0.46 },
    { cx: 196, cy: 142, r: 1.3, o: 0.5 },
    { cx: 86, cy: 148, r: 1.4, o: 0.42 },
    { cx: 140, cy: 170, r: 1.0, o: 0.38 },
    { cx: 1028, cy: 62, r: 1.4, o: 0.56 },
    { cx: 1086, cy: 94, r: 1.1, o: 0.5 },
    { cx: 1134, cy: 72, r: 1.8, o: 0.62 },
    { cx: 1168, cy: 118, r: 1.2, o: 0.44 },
    { cx: 1044, cy: 130, r: 1.0, o: 0.36 },
    { cx: 1108, cy: 150, r: 1.5, o: 0.5 },
    { cx: 1184, cy: 78, r: 1.0, o: 0.32 },
    { cx: 970, cy: 92, r: 1.2, o: 0.34 }
  ];

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
            backgroundColor: '#000000',
            ...rootFont
          }}
        >
          <svg
            width={size.width}
            height={size.height}
            viewBox="0 0 1200 630"
            style={{ position: 'absolute', inset: 0 }}
          >
            <defs>
              <linearGradient id="horizonGradient" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#7c5cff" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <radialGradient id="sunriseGradient" cx="600" cy="690" r="520" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="18%" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="38%" stopColor="#ffffff" stopOpacity="0.18" />
                <stop offset="62%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              <filter id="sunriseBlur" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="24" />
              </filter>
              <filter id="horizonBloom" x="-40%" y="-80%" width="180%" height="240%">
                <feGaussianBlur stdDeviation="22" />
              </filter>
              <filter id="horizonGlow" x="-40%" y="-80%" width="180%" height="240%">
                <feGaussianBlur stdDeviation="10" />
              </filter>
            </defs>
            {stars.map((star, index) => (
              <circle key={index} cx={star.cx} cy={star.cy} r={star.r} fill="#ffffff" opacity={star.o} />
            ))}
            <circle cx="600" cy="690" r="520" fill="url(#sunriseGradient)" filter="url(#sunriseBlur)" />
            <path
              d={horizonPath}
              stroke="url(#horizonGradient)"
              strokeWidth="120"
              fill="none"
              strokeLinecap="round"
              opacity="0.12"
              filter="url(#horizonBloom)"
            />
            <path
              d={horizonPath}
              stroke="url(#horizonGradient)"
              strokeWidth="72"
              fill="none"
              strokeLinecap="round"
              opacity="0.22"
              filter="url(#horizonGlow)"
            />
            <path d={planetPath} fill="#000000" />
            <path d={horizonPath} stroke="url(#horizonGradient)" strokeWidth="18" fill="none" strokeLinecap="round" />
            <path
              d={horizonPath}
              stroke="#ffffff"
              strokeOpacity="0.12"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              transform: 'translateY(-18px)'
            }}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 108,
                  fontWeight: 600,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  color: '#ffffff',
                  opacity: 0.22,
                  filter: 'blur(2px)'
                }}
              >
                {BRAND_TECHNICAL_NAME}
              </div>
              <div
                style={{
                  fontSize: 108,
                  fontWeight: 600,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  color: 'transparent',
                  backgroundImage:
                    'linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 52%, rgba(255,255,255,0.26) 82%, rgba(255,255,255,0) 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text'
                }}
              >
                {BRAND_TECHNICAL_NAME}
              </div>
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: '0.12em',
                color: '#22d3ee',
                textShadow: '0 0 26px rgba(34, 211, 238, 0.32)',
                ...monoFont
              }}
            >
              Don&apos;t miss the lift-off.
            </div>
          </div>
        </div>
      ),
      {
        ...size,
        headers: { 'Cache-Control': cacheControl, 'X-TMN-OG-Source': 'main' },
        fonts: hasFonts ? fonts : undefined
      }
    )
  );
}

async function buildFallbackOgImage(debugLabel: string) {
  return renderImageResponse(
    new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#05060a',
            color: '#eaf0ff'
          }}
        >
          <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: '-0.02em' }}>{BRAND_TECHNICAL_NAME}</div>
          <div style={{ marginTop: 16, fontSize: 26, letterSpacing: '0.02em', color: '#b9c6e8' }}>
            Don&apos;t miss the lift-off.
          </div>
        </div>
      ),
      {
        ...size,
        headers: {
          'Cache-Control': cacheControlFallback,
          'X-TMN-OG-Source': 'fallback',
          'X-TMN-OG-Error': debugLabel
        }
      }
    )
  );
}

function buildErrorLabel(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  return message.slice(0, 200);
}

async function renderImageResponse(response: ImageResponse) {
  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('OG image rendered empty');
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Length', String(buffer.byteLength));
  return new Response(buffer, { status: response.status, headers });
}
