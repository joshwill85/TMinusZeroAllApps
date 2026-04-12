'use client';

import { useState } from 'react';

type PadSatellitePreviewImageProps = {
  src: string | null;
  alt: string;
  padName: string;
  providerLabel: string;
};

export function PadSatellitePreviewImage({ src, alt, padName, providerLabel }: PadSatellitePreviewImageProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;
  const previewUnavailable = !src || imageFailed;

  return (
    <div className="relative h-56 w-full overflow-hidden bg-[radial-gradient(circle_at_20%_20%,_rgba(34,197,94,0.22),_transparent_34%),radial-gradient(circle_at_80%_18%,_rgba(59,130,246,0.25),_transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(12,18,34,0.98))]">
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.82),rgba(2,6,23,0.18))]" />
      <div className="relative flex h-full items-end p-4">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">
            {previewUnavailable ? 'Satellite preview unavailable' : 'Satellite preview'}
          </div>
          <div className="mt-1 text-base font-semibold text-text1">{padName}</div>
          <div className="mt-1 text-sm text-text2">
            {previewUnavailable
              ? `Static preview unavailable right now. Tap to open the pad in ${providerLabel}.`
              : `Tap to open the pad in ${providerLabel}.`}
          </div>
        </div>
      </div>
      {showImage ? (
        <img
          src={src || undefined}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : null}
    </div>
  );
}
