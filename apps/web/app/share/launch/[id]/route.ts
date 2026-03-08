import { GET as launchFastGet } from '../../launch-fast/[id]/route';

export const runtime = 'edge';

function isDebugEnabled(request: Request) {
  const requestUrl = new URL(request.url);
  const debug = requestUrl.searchParams.get('debug') || '';
  const share = requestUrl.searchParams.get('share') || '';
  return [debug, share].some((value) => ['1', 'true', 'yes', 'debug'].includes(value.trim().toLowerCase()));
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (isDebugEnabled(request)) {
    const requestUrl = new URL(request.url);
    const debugUrl = new URL(`/share/launch-debug/${encodeURIComponent(params.id)}${requestUrl.search}`, requestUrl);
    return Response.redirect(debugUrl, 307);
  }

  return launchFastGet(request, { params });
}
