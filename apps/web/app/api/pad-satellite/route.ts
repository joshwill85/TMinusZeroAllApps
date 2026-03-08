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
  const launchId = requestUrl.searchParams.get('launchId')?.trim();
  if (!launchId) return empty(400);

  const targetUrl = new URL(`/api/launches/${encodeURIComponent(launchId)}/pad-satellite`, requestUrl.origin);
  return new Response(null, {
    status: 307,
    headers: {
      Location: targetUrl.toString(),
      'Cache-Control': 'no-store'
    }
  });
}
