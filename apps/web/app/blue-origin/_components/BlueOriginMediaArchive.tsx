'use client';

import { useState } from 'react';
import { BlueOriginLocalTime } from '@/app/blue-origin/_components/BlueOriginLocalTime';
import { resolveMediaPreview } from '@/lib/utils/blueOriginDossier';

type MediaItem = {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string | null;
  title: string;
  subtitle?: string;
  publishedAt?: string | null;
};

export function BlueOriginMediaArchive({ 
  items 
}: { 
  items: MediaItem[] 
}) {
  const [failedImageIds, setFailedImageIds] = useState<Record<string, true>>({});

  const markImageFailed = (id: string) => {
    setFailedImageIds((previous) => {
      if (previous[id]) return previous;
      return { ...previous, [id]: true };
    });
  };

  return (
    <div className="grid gap-6">
      <header className="flex items-center justify-between border-b border-stroke pb-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-text1">Program Media Evidence</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-text3">
          {items.length} Tracked Assets
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const preview = resolveMediaPreview({
            type: item.type,
            url: item.url,
            thumbnailUrl: item.thumbnailUrl
          });
          const hasImageLoadError = preview.kind === 'image' && failedImageIds[item.id];

          return (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="group relative overflow-hidden rounded-xl border border-stroke bg-surface-1 shadow-sm transition-all hover:border-primary/40 hover:shadow-xl"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
                {preview.kind === 'image' ? (
                  hasImageLoadError ? (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-surface-2 to-surface-1 px-4 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-text3">
                        Media Asset
                      </span>
                      <span className="mt-1 text-xs text-text2">Media source image unavailable</span>
                    </div>
                  ) : (
                    <img
                      src={preview.imageUrl}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      onError={() => markImageFailed(item.id)}
                    />
                  )
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-surface-2 to-surface-1 px-4 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-text3">
                      {preview.kind === 'video-placeholder' ? 'Video Source' : 'Image Source'}
                    </span>
                    <span className="mt-1 text-xs text-text2">Preview unavailable</span>
                  </div>
                )}

                {item.type === 'video' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-sm transition-transform group-hover:scale-110">
                      <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 p-3">
                <span className="text-[9px] font-bold uppercase tracking-widest text-primary/80">
                  {item.type} Asset
                </span>
                <h4 className="line-clamp-2 text-xs font-bold text-text1">
                  {item.title}
                </h4>
                {item.subtitle ? (
                  <p className="line-clamp-2 text-[10px] text-text3">{item.subtitle}</p>
                ) : item.publishedAt ? (
                  <BlueOriginLocalTime
                    value={item.publishedAt}
                    variant="dateTime"
                    className="text-[10px] text-text3"
                  />
                ) : null}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
