export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL('/opengraph-image/jpeg', url.origin);
  target.search = url.search;
  const response = await fetch(target.toString(), { cache: 'no-store' });
  return new Response(response.body, { status: response.status, headers: response.headers });
}
