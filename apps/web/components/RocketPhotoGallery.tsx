'use client';

import { useEffect, useState } from 'react';
import { ImageCreditLine } from '@/components/ImageCreditLine';

type LaunchPhoto = {
  label: string;
  url: string;
  credit?: string;
  license?: string;
  licenseUrl?: string;
  singleUse?: boolean;
};

type RocketPhotoGalleryProps = {
  photos: LaunchPhoto[];
  launchName: string;
};

export function RocketPhotoGallery({ photos, launchName }: RocketPhotoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePhoto = activeIndex != null ? photos[activeIndex] : null;

  useEffect(() => {
    if (!activePhoto) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveIndex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePhoto]);

  if (photos.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
        {photos.map((photo, index) => {
          const label = photo.label || 'Photo';
          return (
            <div key={photo.url} className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.08em] text-text3">{label}</div>
              <button
                type="button"
                className="group block w-full overflow-hidden rounded-lg border border-stroke bg-black/20 text-left"
                onClick={() => setActiveIndex(index)}
                aria-label={`Open ${label.toLowerCase()} photo`}
              >
                <img
                  src={photo.url}
                  alt={`${launchName} ${label.toLowerCase()} photo`}
                  className="h-24 w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                  loading="lazy"
                  decoding="async"
                />
              </button>
              <ImageCreditLine
                credit={photo.credit}
                license={photo.license}
                licenseUrl={photo.licenseUrl}
                singleUse={photo.singleUse}
              />
            </div>
          );
        })}
      </div>

      {activePhoto && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(0,0,0,0.75)] backdrop-blur-sm"
            onClick={() => setActiveIndex(null)}
            aria-label="Close photo"
          />
          <div
            className="relative z-10 w-full max-w-5xl"
            role="dialog"
            aria-modal="true"
            aria-label={`${activePhoto.label} photo`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.1em] text-text3">{activePhoto.label}</div>
                <div className="text-sm text-text2">{launchName}</div>
              </div>
              <button type="button" className="text-sm text-text3 hover:text-text1" onClick={() => setActiveIndex(null)}>
                Close
              </button>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-stroke bg-black/80">
              <img
                src={activePhoto.url}
                alt={`${launchName} ${activePhoto.label.toLowerCase()} photo`}
                className="h-full w-full max-h-[80vh] object-contain"
                loading="lazy"
                decoding="async"
              />
            </div>
            <ImageCreditLine
              credit={activePhoto.credit}
              license={activePhoto.license}
              licenseUrl={activePhoto.licenseUrl}
              singleUse={activePhoto.singleUse}
            />
          </div>
        </div>
      )}
    </div>
  );
}
