import OpengraphImage from '../../opengraph-image';
import { shouldServeLiteOg } from '@/lib/server/og';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { id: string; version: string };

function toSearchParams(url: URL) {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing) {
      params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      continue;
    }
    params[key] = value;
  }
  return params;
}

export async function GET(request: Request, { params }: { params: Params }) {
  const url = new URL(request.url);
  const userAgent = request.headers.get('user-agent');
  const liteParam = url.searchParams.get('lite');
  const isLiteParam = liteParam && ['1', 'true', 'yes', 'lite'].includes(liteParam.trim().toLowerCase());
  const shouldLite = shouldServeLiteOg(userAgent);
  if (shouldLite && !isLiteParam) {
    const redirectUrl = new URL(url);
    redirectUrl.searchParams.set('lite', '1');
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.toString(),
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, noimageindex'
      }
    });
  }

  const searchParams = toSearchParams(url);
  if (isLiteParam || shouldLite) searchParams.lite = '1';
  if (!searchParams.og) searchParams.og = params.version;
  const response = await OpengraphImage({ params: { id: params.id }, searchParams, requestHeaders: request.headers });
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, noimageindex');
  return new Response(response.body, { status: response.status, headers });
}
