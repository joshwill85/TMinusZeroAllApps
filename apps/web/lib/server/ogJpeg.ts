let sharpImportPromise: Promise<((input: Buffer) => { jpeg: (options: { quality: number; mozjpeg: boolean }) => { toBuffer: () => Promise<Buffer> } }) | null> | null =
  null;
let didWarnAboutMissingSharp = false;

async function loadSharp() {
  if (!sharpImportPromise) {
    sharpImportPromise = import('sharp')
      .then((module) => module.default)
      .catch((error) => {
        if (!didWarnAboutMissingSharp) {
          didWarnAboutMissingSharp = true;
          console.warn('sharp unavailable for OG JPEG conversion; serving PNG fallback', error);
        }
        return null;
      });
  }
  return sharpImportPromise;
}

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function renderOgJpegOrPngFallback(buffer: Buffer) {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      body: toArrayBuffer(buffer),
      contentType: 'image/png',
      format: 'png-fallback' as const
    };
  }

  const jpeg = await sharp(buffer).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return {
    body: toArrayBuffer(jpeg),
    contentType: 'image/jpeg',
    format: 'jpeg' as const
  };
}
