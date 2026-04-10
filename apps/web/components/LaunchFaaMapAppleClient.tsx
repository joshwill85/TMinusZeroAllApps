'use client';

import { useEffect, useRef, useState } from 'react';
import type { LaunchFaaAirspaceMapV1 } from '@tminuszero/contracts';

type Props = {
  authorizationToken: string;
  data: LaunchFaaAirspaceMapV1;
  padMapsHref: string | null;
  openMapsLabel?: string;
};

type AppleMapKitWindow = Window & {
  mapkit?: any;
  __tmzAppleMapKitLoadingPromise?: Promise<any>;
  __tmzAppleMapKitInit?: () => void;
};

type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | {
        type: 'Polygon';
        coordinates: number[][][];
      }
    | {
        type: 'Point';
        coordinates: [number, number];
      };
};

export function LaunchFaaMapAppleClient({
  authorizationToken,
  data,
  padMapsHref,
  openMapsLabel = 'Open in Apple Maps'
}: Props) {
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

    void loadAppleMapKit(authorizationToken).then((mapkit) => {
      if (cancelled || !previewRef.current) return;
      cleanup = mountAppleMap(previewRef.current, mapkit, data, false);
      if (cancelled) cleanup?.();
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [authorizationToken, data]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void loadAppleMapKit(authorizationToken).then((mapkit) => {
      if (cancelled || !modalRef.current) return;
      cleanup = mountAppleMap(modalRef.current, mapkit, data, true);
      if (cancelled) cleanup?.();
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [authorizationToken, data, fullscreenOpen]);

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
          <div>
            <div className="text-xs uppercase tracking-[0.08em] text-text3">Launch zone map</div>
            <p className="mt-1 text-sm text-text2">
              Apple satellite view with launch-day FAA polygons and the launch pad fit into the same frame.
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
          <div ref={previewRef} className="pointer-events-none h-[260px] w-full" />
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
                  Launch-day advisory polygons are shown here on Apple Maps whenever FAA geometry is available.
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

async function loadAppleMapKit(authorizationToken: string) {
  const currentWindow = window as AppleMapKitWindow;
  if (currentWindow.mapkit?.loadedLibraries?.length) {
    return currentWindow.mapkit;
  }

  if (!currentWindow.__tmzAppleMapKitLoadingPromise) {
    currentWindow.__tmzAppleMapKitLoadingPromise = new Promise((resolve, reject) => {
      const callbackName = '__tmzAppleMapKitInit';
      currentWindow.__tmzAppleMapKitInit = () => {
        delete currentWindow.__tmzAppleMapKitInit;
        resolve(currentWindow.mapkit);
      };

      const existingScript = document.querySelector<HTMLScriptElement>('script[data-tmz-apple-mapkit="1"]');
      if (existingScript) {
        existingScript.addEventListener(
          'error',
          () => {
            delete currentWindow.__tmzAppleMapKitInit;
            currentWindow.__tmzAppleMapKitLoadingPromise = undefined;
            reject(new Error('apple_mapkit_script_failed'));
          },
          { once: true }
        );
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.tmzAppleMapkit = '1';
      script.setAttribute('data-callback', callbackName);
      script.setAttribute('data-libraries', 'map,annotations,overlays,geojson');
      script.setAttribute('data-token', authorizationToken);
      script.onerror = () => {
        delete currentWindow.__tmzAppleMapKitInit;
        currentWindow.__tmzAppleMapKitLoadingPromise = undefined;
        reject(new Error('apple_mapkit_script_failed'));
      };
      document.head.appendChild(script);
    });
  }

  return currentWindow.__tmzAppleMapKitLoadingPromise as Promise<any>;
}

function mountAppleMap(container: HTMLDivElement, mapkit: any, data: LaunchFaaAirspaceMapV1, interactive: boolean) {
  const map = new mapkit.Map(container, {
    mapType: 'satellite'
  });

  const geoJsonUrl = createGeoJsonUrl(data);
  let cleanedUp = false;

  mapkit.importGeoJSON(geoJsonUrl, {
    itemForFeature: (item: any, geojson: GeoJsonFeature) => {
      if (geojson.geometry.type === 'Point') {
        item.color = '#ff6b35';
        item.glyphText = 'P';
        item.title = String(geojson.properties.title || 'Launch pad');
        item.subtitle = String(geojson.properties.subtitle || '');
      }

      return item;
    },
    styleForOverlay: () =>
      new mapkit.Style({
        fillColor: '#ef4444',
        fillOpacity: 0.16,
        lineWidth: interactive ? 2 : 1.5,
        strokeColor: '#ef4444',
        strokeOpacity: 0.88
      }),
    geoJSONDidComplete: (items: any[]) => {
      if (cleanedUp) return;
      map.showItems(items, {
        padding: new mapkit.Padding(interactive ? 72 : 48, interactive ? 72 : 48, interactive ? 72 : 48, interactive ? 72 : 48)
      });
    }
  });

  return () => {
    cleanedUp = true;
    URL.revokeObjectURL(geoJsonUrl);
    if (typeof map.destroy === 'function') {
      map.destroy();
    } else {
      container.innerHTML = '';
    }
  };
}

function createGeoJsonUrl(data: LaunchFaaAirspaceMapV1) {
  const featureCollection = {
    type: 'FeatureCollection' as const,
    features: buildGeoJsonFeatures(data)
  };
  const blob = new Blob([JSON.stringify(featureCollection)], {
    type: 'application/geo+json'
  });
  return URL.createObjectURL(blob);
}

function buildGeoJsonFeatures(data: LaunchFaaAirspaceMapV1): GeoJsonFeature[] {
  const features: GeoJsonFeature[] = [];

  for (const advisory of data.advisories) {
    for (const polygon of advisory.polygons) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'faa_polygon',
          advisoryTitle: advisory.title,
          advisoryId: advisory.matchId
        },
        geometry: {
          type: 'Polygon',
          coordinates: [polygon.outerRing, ...polygon.holes].map((ring) => closeRingCoordinates(ring))
        }
      });
    }
  }

  if (data.pad.latitude != null && data.pad.longitude != null) {
    features.push({
      type: 'Feature',
      properties: {
        kind: 'launch_pad',
        title: data.pad.label || 'Launch pad',
        subtitle: data.pad.locationName || data.pad.shortCode || ''
      },
      geometry: {
        type: 'Point',
        coordinates: [data.pad.longitude, data.pad.latitude]
      }
    });
  }

  return features;
}

function closeRingCoordinates(ring: Array<{ latitude: number; longitude: number }>) {
  const coordinates = ring.map((point) => [point.longitude, point.latitude]);
  if (coordinates.length === 0) return coordinates;

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([first[0], first[1]]);
  }

  return coordinates;
}
