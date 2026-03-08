import sharp from 'sharp';
import OpengraphImage from '../generator';

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
  const jpeg = await sharp(buffer).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const body = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer;

  const headers = new Headers(png.headers);
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Content-Length', String(body.byteLength));
  headers.set('X-TMN-OG-Format', 'jpeg');
  headers.set('X-Robots-Tag', 'noindex, noimageindex');

  return new Response(body, { status: 200, headers });
}
