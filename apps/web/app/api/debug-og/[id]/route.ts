export const runtime = 'edge';

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const isProd = process.env.NODE_ENV === 'production';
  const debugToken = (process.env.DEBUG_OG_TOKEN || '').trim();
  if (isProd) {
    if (!debugToken) {
      return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const provided = (req.headers.get('x-debug-token') || '').trim();
    if (!provided || !timingSafeEqual(provided, debugToken)) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

  const debug: Record<string, unknown> = {
    id: params.id,
    hasUrl: Boolean(url),
    hasAnon: Boolean(anon && anon.length > 10),
    urlPrefix: url.slice(0, 40),
  };

  if (!url || !anon) {
    return Response.json({ ...debug, error: 'Missing env vars' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const queryUrl = `${url}/rest/v1/launches_public_cache?launch_id=eq.${params.id}&select=name,provider,vehicle&limit=1`;
    const response = await fetch(queryUrl, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` }
    });

    debug.fetchStatus = response.status;
    debug.fetchOk = response.ok;

    if (!response.ok) {
      debug.error = (await response.text()).slice(0, 500);
      return Response.json(debug, { headers: { 'Cache-Control': 'no-store' } });
    }

    const data = await response.json();
    debug.data = data;
    debug.hasData = Array.isArray(data) && data.length > 0;

    return Response.json(debug, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    debug.error = String(error);
    return Response.json(debug, { headers: { 'Cache-Control': 'no-store' } });
  }
}
