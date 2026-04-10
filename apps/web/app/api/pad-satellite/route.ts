import { respondWithPadSatellitePreviewByLaunchId, respondWithPadSatellitePreviewByLl2PadId } from '@/lib/server/padSatellitePreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function empty(status: number, cacheControl = 'no-store') {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': cacheControl
    }
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ll2PadIdRaw = requestUrl.searchParams.get('ll2PadId')?.trim();
  if (ll2PadIdRaw) {
    const ll2PadId = Number(ll2PadIdRaw);
    if (!Number.isInteger(ll2PadId) || ll2PadId <= 0) {
      return empty(400);
    }
    return respondWithPadSatellitePreviewByLl2PadId(ll2PadId);
  }

  const launchId = requestUrl.searchParams.get('launchId')?.trim();
  if (!launchId) return empty(400);
  return respondWithPadSatellitePreviewByLaunchId(launchId);
}
