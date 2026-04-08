import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getGoogleMapsStaticApiKey, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { buildGoogleMapsStaticSatelliteUrl } from '@/lib/utils/googleMaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PadCoordinateRow = {
  pad_latitude?: number | null;
  pad_longitude?: number | null;
};

function parseCoordinateParam(value: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPadCoordinatesFromRequest(request: Request): PadCoordinateRow | null {
  const requestUrl = new URL(request.url);
  const latitude = parseCoordinateParam(requestUrl.searchParams.get('latitude'));
  const longitude = parseCoordinateParam(requestUrl.searchParams.get('longitude'));
  if (latitude == null || longitude == null) return null;
  return {
    pad_latitude: latitude,
    pad_longitude: longitude
  };
}

async function loadPadCoordinates(id: string): Promise<PadCoordinateRow | null> {
  const supabase = createSupabaseServerClient();
  const { data: cachedRow } = await supabase
    .from('launches_public_cache')
    .select('pad_latitude,pad_longitude')
    .eq('launch_id', id)
    .maybeSingle();

  if (cachedRow) return cachedRow satisfies PadCoordinateRow;

  if (!isSupabaseAdminConfigured()) return null;

  const admin = createSupabaseAdminClient();
  const { data: liveRow } = await admin
    .from('launches')
    .select('pad_latitude,pad_longitude')
    .eq('id', id)
    .eq('hidden', false)
    .maybeSingle();

  return liveRow satisfies PadCoordinateRow | null;
}

function notFound() {
  return new Response(null, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

async function readUpstreamErrorDetail(response: Response) {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 240) || null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const googleMapsStaticApiKey = getGoogleMapsStaticApiKey();
  if (!googleMapsStaticApiKey) return notFound();

  const requestCoordinates = readPadCoordinatesFromRequest(request);
  if (!requestCoordinates && !isSupabaseConfigured()) {
    return new Response(null, {
      status: 503,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }

  const pad = requestCoordinates ?? (await loadPadCoordinates(params.id));
  if (!pad) return notFound();

  const targetUrl = buildGoogleMapsStaticSatelliteUrl(
    {
      latitude: pad.pad_latitude,
      longitude: pad.pad_longitude
    },
    googleMapsStaticApiKey,
    {
      zoom: 18,
      width: 640,
      height: 360,
      scale: 2
    }
  );

  if (!targetUrl) return notFound();

  const upstream = await fetch(targetUrl, {
    headers: {
      Accept: 'image/*'
    }
  });

  if (!upstream.ok || !upstream.body) {
    const detail = upstream.ok ? null : await readUpstreamErrorDetail(upstream);
    console.warn('pad satellite preview upstream failed', {
      launchId: params.id,
      status: upstream.status,
      hasBody: Boolean(upstream.body),
      detail
    });
    return new Response(null, {
      status: 502,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', (upstream.headers.get('content-type') || 'image/jpeg').split(';')[0].trim());
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);
  headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  headers.set('X-Robots-Tag', 'noindex, noimageindex');

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
