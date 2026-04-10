import {
  buildAppleMapsSatelliteUrl,
  buildGoogleMapsSatelliteUrl,
  isGoogleMapsUrl
} from '@/lib/utils/googleMaps';
import type { LaunchFaaMapRenderMode } from '@/lib/maps/providerTypes';

type PadTarget = {
  latitude?: number | null;
  longitude?: number | null;
  label?: string | null;
};

export type WebLaunchMapPolicy = {
  isSafari: boolean;
  allowGoogleStaticPadPreview: boolean;
  faaMapMode: LaunchFaaMapRenderMode;
  padMapsHref: string | null;
  padMapsProviderLabel: string;
  padMapsLinkLabel: string;
  faaUnavailableMessage: string;
};

function normalizeUrl(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export function isSafariUserAgent(userAgent: string | null | undefined) {
  const normalized = String(userAgent || '');
  if (!/safari/i.test(normalized)) {
    return false;
  }

  return !/(chrome|chromium|crios|edg|edgios|opr|fxios|firefox|samsungbrowser|android)/i.test(normalized);
}

export function resolveWebLaunchMapPolicy({
  userAgent,
  pad,
  fallbackPadMapUrl,
  hasGoogleStaticApiKey,
  hasGoogleWebApiKey,
  hasAppleMapsWebConfig
}: {
  userAgent: string | null | undefined;
  pad: PadTarget;
  fallbackPadMapUrl?: string | null;
  hasGoogleStaticApiKey: boolean;
  hasGoogleWebApiKey: boolean;
  hasAppleMapsWebConfig: boolean;
}): WebLaunchMapPolicy {
  const isSafari = isSafariUserAgent(userAgent);
  const applePadHref = buildAppleMapsSatelliteUrl(pad, { zoom: 18 });
  const googlePadHref = buildGoogleMapsSatelliteUrl(pad, { zoom: 18 });
  const normalizedFallbackPadMapUrl = normalizeUrl(fallbackPadMapUrl);
  const safariSafeFallbackUrl = normalizedFallbackPadMapUrl && !isGoogleMapsUrl(normalizedFallbackPadMapUrl) ? normalizedFallbackPadMapUrl : null;

  const padMapsHref = isSafari
    ? applePadHref || safariSafeFallbackUrl || null
    : googlePadHref || normalizedFallbackPadMapUrl || applePadHref || null;

  const padMapsProviderLabel = isSafari
    ? applePadHref
      ? 'Apple Maps'
      : safariSafeFallbackUrl
        ? 'Map provider'
        : 'Apple Maps'
    : googlePadHref
      ? 'Google Maps'
      : normalizedFallbackPadMapUrl
        ? 'Map provider'
        : applePadHref
          ? 'Apple Maps'
          : 'Map provider';

  const faaMapMode: LaunchFaaMapRenderMode = isSafari
    ? hasAppleMapsWebConfig
      ? 'apple'
      : 'fallback'
    : hasGoogleWebApiKey
      ? 'google'
      : 'fallback';

  return {
    isSafari,
    allowGoogleStaticPadPreview: !isSafari && hasGoogleStaticApiKey && Boolean(googlePadHref),
    faaMapMode,
    padMapsHref,
    padMapsProviderLabel,
    padMapsLinkLabel:
      padMapsProviderLabel === 'Map provider' ? 'Pad map' : padMapsProviderLabel === 'Apple Maps' ? 'Open in Apple Maps' : 'Open in Google Maps',
    faaUnavailableMessage: faaMapMode === 'apple'
      ? 'FAA launch-day geometry is available for this launch, but the Apple Maps renderer is temporarily unavailable on this surface.'
      : isSafari
        ? 'FAA launch-day geometry is available, but the Safari Apple Maps renderer is not configured in this environment.'
        : 'FAA launch-day geometry is available for this launch, but the interactive map is not configured in this environment.'
  };
}
