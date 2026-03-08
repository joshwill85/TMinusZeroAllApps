export const runtime = 'edge';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug');
  const og = url.searchParams.get('og') || url.searchParams.get('v') || 'v';
  const versionSegment = encodeURIComponent(og);
  const target = new URL(`/launches/${params.id}/opengraph-image/${versionSegment}/jpeg`, url.origin);
  if (debug) target.searchParams.set('debug', debug);
  return Response.redirect(target, 302);
}
