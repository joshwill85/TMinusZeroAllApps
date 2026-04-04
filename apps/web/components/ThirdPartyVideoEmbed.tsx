'use client';

import { ThirdPartyEmbedGate } from '@/components/ThirdPartyEmbedGate';

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

  return (
    <ThirdPartyEmbedGate
      title="Embedded video"
      description={`This ${providerLabel} video only loads after you choose to play it.`}
      loadLabel="Load video"
      externalUrl={externalUrl}
      externalLabel="Open stream"
      blocked={blocked}
      blockedMessage={
        <>
          Third-party video embeds are disabled in your Privacy Choices settings.{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Update preferences
          </a>{' '}
          or use the stream link instead.
        </>
      }
      preview={
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
      }
    >
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
    </ThirdPartyEmbedGate>
  );
}
