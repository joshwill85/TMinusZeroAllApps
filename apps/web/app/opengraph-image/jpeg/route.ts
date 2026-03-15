import OpengraphImage from '../generator';
import { renderOgJpegOrPngFallback } from '@/lib/server/ogJpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const png = await OpengraphImage();
  if (!png.ok) {
    const headers = new Headers(png.headers);
    headers.set('X-Robots-Tag', 'noindex, noimageindex');
    return new Response(png.body, { status: png.status, headers });
  }
  const contentType = png.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    const headers = new Headers(png.headers);
    headers.set('X-Robots-Tag', 'noindex, noimageindex');
    return new Response(png.body, { status: png.status, headers });
  }

  const buffer = Buffer.from(await png.arrayBuffer());
  const rendered = await renderOgJpegOrPngFallback(buffer);

  const headers = new Headers(png.headers);
  headers.set('Content-Type', rendered.contentType);
  headers.set('Content-Length', String(rendered.body.byteLength));
  headers.set('X-TMN-OG-Format', rendered.format);
  headers.set('X-Robots-Tag', 'noindex, noimageindex');

  return new Response(rendered.body, { status: 200, headers });
}
