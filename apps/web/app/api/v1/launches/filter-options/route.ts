import { GET as getLegacyFilterOptions } from '@/app/api/filters/route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const incomingUrl = new URL(request.url);
  const legacyUrl = new URL('/api/filters', incomingUrl);
  legacyUrl.search = incomingUrl.search;

  const forwardedHeaders = new Headers();
  const authorization = request.headers.get('authorization');
  const cookie = request.headers.get('cookie');

  if (authorization) forwardedHeaders.set('authorization', authorization);
  if (cookie) forwardedHeaders.set('cookie', cookie);

  return getLegacyFilterOptions(
    new Request(legacyUrl, {
      method: 'GET',
      headers: forwardedHeaders
    })
  );
}
