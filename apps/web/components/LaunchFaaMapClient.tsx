'use client';

import { useEffect, useRef, useState } from 'react';
import type { LaunchFaaAirspaceMapV1 } from '@tminuszero/contracts';

type Props = {
  apiKey: string;
  data: LaunchFaaAirspaceMapV1;
  padMapsHref: string | null;
  openMapsLabel?: string;
};

type GoogleMapWindow = Window & {
  google?: any;
  __tmzGoogleMapsLoadingPromise?: Promise<any>;
};

export function LaunchFaaMapClient({ apiKey, data, padMapsHref, openMapsLabel = 'Open in Google Maps' }: Props) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  useEffect(() => {
    if (!fullscreenOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenOpen]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void loadGoogleMapsApi(apiKey).then((googleMaps) => {
      if (cancelled || !previewRef.current) return;
      cleanup = mountGoogleMap(previewRef.current, googleMaps, data, false);
      if (cancelled) cleanup?.();
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [apiKey, data]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void loadGoogleMapsApi(apiKey).then((googleMaps) => {
      if (cancelled || !modalRef.current) return;
      cleanup = mountGoogleMap(modalRef.current, googleMaps, data, true);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [apiKey, data, fullscreenOpen]);

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
          <div>
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Launch zone map</div>
            <p className="mt-1 text-sm text-text2">
              Satellite view with launch-day FAA polygons and the launch pad fit into the same frame.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFullscreenOpen(true)}
              className="rounded-full border border-stroke px-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-primary"
            >
              Full screen
            </button>
            {padMapsHref ? (
              <a
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-primary transition hover:border-primary hover:bg-primary/15"
                href={padMapsHref}
                target="_blank"
                rel="noreferrer"
              >
                {openMapsLabel}
              </a>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFullscreenOpen(true)}
          className="block w-full border-y border-stroke bg-surface-0 text-left transition hover:opacity-95"
          aria-label="Open FAA launch zone map full screen"
        >
          <div ref={previewRef} className="h-[260px] w-full" />
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-text3">
          <span>
            {data.advisoryCount} launch-day zone{data.advisoryCount === 1 ? '' : 's'}
          </span>
          <span>{data.pad.label || data.pad.locationName || 'Launch pad'}</span>
        </div>
      </div>

      {fullscreenOpen ? (
        <div className="fixed inset-0 z-[110] bg-[rgba(5,6,10,0.88)] p-4 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-stroke bg-surface-1 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stroke px-4 py-4">
              <div>
                <div className="text-xs uppercase tracking-[0.08em] text-text3">Launch zone map</div>
                <h3 className="mt-1 text-lg font-semibold text-text1">FAA advisory geometry</h3>
                <p className="mt-1 text-sm text-text3">
                  Launch-day advisory polygons are shown here whenever FAA geometry is available.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {padMapsHref ? (
                  <a
                    className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-primary transition hover:border-primary hover:bg-primary/15"
                    href={padMapsHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {openMapsLabel}
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setFullscreenOpen(false)}
                  className="rounded-full border border-stroke px-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-primary"
                >
                  Close
                </button>
              </div>
            </div>
            <div ref={modalRef} className="min-h-0 flex-1" />
          </div>
        </div>
      ) : null}
    </>
  );
}

async function loadGoogleMapsApi(apiKey: string) {
  const currentWindow = window as GoogleMapWindow;
  if (currentWindow.google?.maps) {
    return currentWindow.google.maps;
  }

  if (!currentWindow.__tmzGoogleMapsLoadingPromise) {
    currentWindow.__tmzGoogleMapsLoadingPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-tmz-google-maps="1"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(currentWindow.google?.maps));
        existingScript.addEventListener('error', () => reject(new Error('google_maps_script_failed')));
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=quarterly`;
      script.async = true;
      script.defer = true;
      script.dataset.tmzGoogleMaps = '1';
      script.onload = () => resolve(currentWindow.google?.maps);
      script.onerror = () => reject(new Error('google_maps_script_failed'));
      document.head.appendChild(script);
    });
  }

  return currentWindow.__tmzGoogleMapsLoadingPromise;
}

function mountGoogleMap(container: HTMLDivElement, googleMaps: any, data: LaunchFaaAirspaceMapV1, interactive: boolean) {
  const map = new googleMaps.Map(container, {
    mapTypeId: 'satellite',
    disableDefaultUI: !interactive,
    gestureHandling: interactive ? 'greedy' : 'none',
    clickableIcons: false,
    keyboardShortcuts: interactive,
    fullscreenControl: false,
    streetViewControl: false,
    mapTypeControl: false
  });

  const overlays: Array<{ setMap: (map: any | null) => void }> = [];

  if (data.pad.latitude != null && data.pad.longitude != null) {
    overlays.push(
      new googleMaps.Marker({
        map,
        position: {
          lat: data.pad.latitude,
          lng: data.pad.longitude
        },
        title: data.pad.label || 'Launch pad'
      })
    );
  }

  for (const advisory of data.advisories) {
    for (const polygon of advisory.polygons) {
      overlays.push(
        new googleMaps.Polygon({
          map,
          paths: [polygon.outerRing, ...polygon.holes].map((ring) =>
            ring.map((point) => ({
              lat: point.latitude,
              lng: point.longitude
            }))
          ),
          strokeColor: '#ef4444',
          strokeOpacity: 0.88,
          strokeWeight: interactive ? 2 : 1.5,
          fillColor: '#ef4444',
          fillOpacity: 0.16
        })
      );
    }
  }

  if (data.bounds) {
    const bounds = new googleMaps.LatLngBounds(
      { lat: data.bounds.minLatitude, lng: data.bounds.minLongitude },
      { lat: data.bounds.maxLatitude, lng: data.bounds.maxLongitude }
    );
    if (
      data.bounds.minLatitude === data.bounds.maxLatitude &&
      data.bounds.minLongitude === data.bounds.maxLongitude
    ) {
      map.setCenter({ lat: data.bounds.minLatitude, lng: data.bounds.minLongitude });
      map.setZoom(17);
    } else {
      map.fitBounds(bounds, interactive ? 72 : 48);
    }
  } else if (data.pad.latitude != null && data.pad.longitude != null) {
    map.setCenter({ lat: data.pad.latitude, lng: data.pad.longitude });
    map.setZoom(17);
  }

  return () => {
    for (const overlay of overlays) {
      overlay.setMap(null);
    }
  };
}
