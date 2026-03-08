'use client';

import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';

type AboutPortraitProps = {
  src: string;
  alt: string;
  className?: string;
};

export function AboutPortrait({ src, alt, className }: AboutPortraitProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [photoState, setPhotoState] = useState<'pending' | 'valid' | 'invalid'>('pending');

  const handlePhotoLoaded = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    try {
      const canvas = document.createElement('canvas');
      const size = 16;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setPhotoState('valid');
        return;
      }

      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        max = Math.max(max, data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
        if (max > 6) break;
      }

      setPhotoState(max > 6 ? 'valid' : 'invalid');
    } catch {
      setPhotoState('valid');
    }
  }, []);

  const showPhoto = photoState === 'valid';

  return (
    <div className={clsx('relative aspect-[4/3] w-full', className)}>
      <div
        className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.22),rgba(124,92,255,0.16),rgba(0,0,0,0.92))]"
        aria-hidden="true"
      >
        <div
          className={clsx(
            'flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-white/5 text-3xl font-semibold text-text1 transition-opacity duration-300',
            showPhoto ? 'opacity-0' : 'opacity-100'
          )}
        >
          J
        </div>
      </div>

      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={clsx('absolute inset-0 h-full w-full object-contain object-center transition-opacity duration-300', showPhoto ? 'opacity-100' : 'opacity-0')}
        loading="eager"
        fetchPriority="high"
        onLoad={handlePhotoLoaded}
        onError={() => setPhotoState('invalid')}
      />
    </div>
  );
}
