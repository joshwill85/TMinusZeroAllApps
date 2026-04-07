'use client';

import { useBlockThirdPartyEmbedsPreference } from '@/lib/privacy/embedPreference';

type ThirdPartyVideoEmbedProps = {
  src: string;
  title: string;
  externalUrl: string;
  previewImageUrl?: string | null;
  previewAlt?: string;
  hostLabel?: string | null;
  blocked?: boolean;
};

export function ThirdPartyVideoEmbed({
  src,
  title,
  externalUrl,
  previewImageUrl,
  previewAlt = '',
  hostLabel,
  blocked = false
}: ThirdPartyVideoEmbedProps) {
  const providerLabel = hostLabel?.trim() || 'third-party';
  const embedsBlocked = useBlockThirdPartyEmbedsPreference() || blocked;

  if (!embedsBlocked) {
    return (
      <div
        className="overflow-hidden rounded-xl border border-stroke bg-black/50"
        style={{ aspectRatio: '16 / 9' }}
      >
        <iframe
          src={src}
          title={title}
          className="h-full w-full"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stroke bg-surface-0">
      <div className="border-b border-stroke">
        <div className="relative bg-black/50" style={{ aspectRatio: '16 / 9' }}>
          {previewImageUrl ? (
            <img
              src={previewImageUrl}
              alt={previewAlt}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.35),_transparent_70%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-text1">Embedded video</div>
          <p className="text-sm text-text3">
            Third-party video embeds from {providerLabel} are disabled in your Privacy Choices settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/legal/privacy-choices"
            className="btn rounded-lg px-4 py-2 text-sm"
          >
            Update preferences
          </a>
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary rounded-lg px-4 py-2 text-sm"
          >
            Open stream
          </a>
        </div>
      </div>
    </div>
  );
}
