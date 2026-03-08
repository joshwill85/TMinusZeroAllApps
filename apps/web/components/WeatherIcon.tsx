'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';

type WeatherGlyph =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'wind'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'sleet'
  | 'thunder'
  | 'hurricane'
  | 'tornado'
  | 'unknown';

export function WeatherIcon({
  nwsIconUrl,
  shortForecast,
  className,
  title,
  ariaLabel
}: {
  nwsIconUrl?: string | null;
  shortForecast?: string | null;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const glyph = inferWeatherGlyph({ iconUrl: nwsIconUrl, shortForecast });
  const toneClass = glyphToneClass(glyph);
  const Icon = glyphIcon(glyph);

  return (
    <Icon
      className={clsx(toneClass, className)}
      title={title}
      ariaLabel={ariaLabel}
      decorative={!ariaLabel}
    />
  );
}

function glyphToneClass(glyph: WeatherGlyph) {
  switch (glyph) {
    case 'clear-day':
      return 'text-warning';
    case 'clear-night':
      return 'text-secondary';
    case 'partly-cloudy-day':
    case 'partly-cloudy-night':
      return 'text-primary';
    case 'rain':
    case 'sleet':
      return 'text-info';
    case 'snow':
      return 'text-text1';
    case 'thunder':
    case 'hurricane':
    case 'tornado':
      return 'text-danger';
    case 'fog':
      return 'text-text3';
    case 'wind':
    case 'cloudy':
    case 'unknown':
    default:
      return 'text-text2';
  }
}

function glyphIcon(glyph: WeatherGlyph) {
  switch (glyph) {
    case 'clear-day':
      return SunIcon;
    case 'clear-night':
      return MoonIcon;
    case 'partly-cloudy-day':
      return CloudSunIcon;
    case 'partly-cloudy-night':
      return CloudMoonIcon;
    case 'rain':
      return CloudRainIcon;
    case 'snow':
      return CloudSnowIcon;
    case 'sleet':
      return CloudSleetIcon;
    case 'thunder':
      return CloudLightningIcon;
    case 'fog':
      return CloudFogIcon;
    case 'wind':
      return WindIcon;
    case 'hurricane':
      return HurricaneIcon;
    case 'tornado':
      return TornadoIcon;
    case 'cloudy':
    case 'unknown':
    default:
      return CloudIcon;
  }
}

function inferWeatherGlyph({
  iconUrl,
  shortForecast
}: {
  iconUrl?: string | null;
  shortForecast?: string | null;
}): WeatherGlyph {
  const parsed = parseNwsIconUrl(iconUrl);
  if (parsed.code) return nwsCodeToGlyph(parsed.code, parsed.isNight);
  if (shortForecast) return forecastTextToGlyph(shortForecast);
  return 'unknown';
}

function forecastTextToGlyph(text: string): WeatherGlyph {
  const v = text.trim().toLowerCase();
  if (!v) return 'unknown';

  if (v.includes('tornado')) return 'tornado';
  if (v.includes('hurricane') || v.includes('tropical storm')) return 'hurricane';
  if (v.includes('thunder')) return 'thunder';

  if (v.includes('snow') || v.includes('blizzard')) return 'snow';
  if (v.includes('sleet') || v.includes('freezing rain')) return 'sleet';
  if (v.includes('rain') || v.includes('shower')) return 'rain';

  if (v.includes('fog') || v.includes('haze') || v.includes('smoke') || v.includes('dust')) return 'fog';
  if (v.includes('wind')) return 'wind';

  if (v.includes('clear') || v.includes('sunny')) return 'clear-day';
  if (v.includes('cloud')) return 'cloudy';
  return 'unknown';
}

function parseNwsIconUrl(iconUrl: string | null | undefined): { code: string | null; isNight: boolean | null } {
  if (!iconUrl) return { code: null, isNight: null };
  const raw = String(iconUrl).trim();
  if (!raw) return { code: null, isNight: null };

  const normalized = raw.toLowerCase();
  const isNight = normalized.includes('/night/') ? true : normalized.includes('/day/') ? false : null;

  const withoutQuery = raw.split('?')[0] ?? raw;
  const pathname = safeUrlPathname(withoutQuery);
  const segments = pathname.split('/').filter(Boolean);

  let codeSegment: string | null = null;
  const dayIndex = segments.findIndex((seg) => seg === 'day' || seg === 'night');
  if (dayIndex >= 0 && segments[dayIndex + 1]) {
    codeSegment = segments[dayIndex + 1] ?? null;
  } else {
    codeSegment = segments.length ? segments[segments.length - 1] : null;
  }

  const code = codeSegment ? codeSegment.split(',')[0]?.trim() || null : null;
  return { code, isNight };
}

function safeUrlPathname(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    const idx = value.indexOf('://');
    if (idx >= 0) {
      const slash = value.indexOf('/', idx + 3);
      if (slash >= 0) return value.slice(slash);
    }
    return value;
  }
}

function nwsCodeToGlyph(codeRaw: string, urlIsNight: boolean | null): WeatherGlyph {
  let code = codeRaw.trim().toLowerCase();
  if (!code) return 'unknown';

  let isNight = urlIsNight ?? false;

  const stripNightPrefix = (value: string) => {
    if (!value.startsWith('n')) return value;
    const rest = value.slice(1);
    if (['skc', 'few', 'sct', 'bkn', 'ovc'].includes(rest)) {
      isNight = true;
      return rest;
    }
    return value;
  };

  code = stripNightPrefix(code);
  if (code.startsWith('wind_')) return 'wind';

  if (code.includes('tornado') || code === 'fc') return 'tornado';
  if (code.includes('hurricane') || code.includes('tropical_storm')) return 'hurricane';

  if (code.includes('tsra')) return 'thunder';

  if (code.includes('blizzard') || code.includes('snow')) return 'snow';
  if (code.includes('sleet') || code === 'fzra') return 'sleet';
  if (code.includes('rain') || code.includes('shower')) return 'rain';

  if (code.includes('fog') || code.includes('haze') || code.includes('smoke') || code.includes('dust') || code.includes('sand'))
    return 'fog';

  if (code === 'skc') return isNight ? 'clear-night' : 'clear-day';
  if (code === 'few' || code === 'sct') return isNight ? 'partly-cloudy-night' : 'partly-cloudy-day';
  if (code === 'bkn' || code === 'ovc') return 'cloudy';

  return 'unknown';
}

type IconProps = {
  className?: string;
  title?: string;
  ariaLabel?: string;
  decorative?: boolean;
};

function IconSvg({
  className,
  title,
  ariaLabel,
  decorative,
  children
}: IconProps & {
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : ariaLabel}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

const STROKE = 1.7;

function SunIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth={STROKE} />
      <path
        d="M12 2.5v2.3M12 19.2v2.3M4.5 12H2.2M21.8 12h-2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function MoonIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconSvg>
  );
}

function CloudIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 18.6h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 18.6z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconSvg>
  );
}

function CloudSunIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M6.1 10.2a4.1 4.1 0 1 1 7-2.8"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M9.6 3.3v1.6M5.7 5.1l1.1 1.1M3.9 9h1.6M13.4 5.1l-1.1 1.1"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M7.2 18.6h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 18.6z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconSvg>
  );
}

function CloudMoonIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M13.6 7.1a4.8 4.8 0 0 1 4.8 4.8"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M14.8 3.4a4.8 4.8 0 0 0 4.7 6.3 6.5 6.5 0 0 1-5.9 2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M7.2 18.6h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 18.6z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconSvg>
  );
}

function CloudRainIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 16.5h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 16.5z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M9 18.4l-1.1 2.3M13 18.4l-1.1 2.3M17 18.4l-1.1 2.3"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function CloudSnowIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 16.5h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 16.5z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M9 19.2l2 2M11 19.2l-2 2M13 19.2l2 2M15 19.2l-2 2M17 19.2l2 2M19 19.2l-2 2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function CloudSleetIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 16.5h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 16.5z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M9 18.5l-1.1 2.2M13 18.5l-1.1 2.2M17 18.5l-1.1 2.2"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <circle cx="9.2" cy="20.8" r="0.9" fill="currentColor" />
      <circle cx="13.2" cy="20.8" r="0.9" fill="currentColor" />
      <circle cx="17.2" cy="20.8" r="0.9" fill="currentColor" />
    </IconSvg>
  );
}

function CloudLightningIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 16.2h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 16.2z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M12.6 17.2 10 21.5h3l-1.1 2.5 4-5.8h-3l1.2-1.9z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </IconSvg>
  );
}

function CloudFogIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M7.2 14.9h9.9a4 4 0 0 0 .5-7.9 5.4 5.4 0 0 0-10.5-1.2A3.7 3.7 0 0 0 7.2 14.9z"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M6.2 17.4h11.6M7.8 20h8.4"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function WindIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M3 8.8h9.6a2.8 2.8 0 1 0-2.8-2.8"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M3 13.1h13.2a2.6 2.6 0 1 1-2.6 2.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M3 17.4h6.3"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function TornadoIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M5 6h14M6.5 10h11M8 14h8M9.5 18h5"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M11.5 21.2h1"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </IconSvg>
  );
}

function HurricaneIcon(props: IconProps) {
  return (
    <IconSvg {...props}>
      <path
        d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <path
        d="M12 8.2a3.8 3.8 0 1 0 3.8 3.8"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </IconSvg>
  );
}
