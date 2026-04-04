'use client';

import { useMemo } from 'react';
import { ThirdPartyEmbedGate } from '@/components/ThirdPartyEmbedGate';
import { useBlockThirdPartyEmbedsPreference } from '@/lib/privacy/embedPreference';

export type XTweetEmbedProps = {
  tweetId: string;
  tweetUrl?: string;
  className?: string;
  theme?: 'dark' | 'light';
  dnt?: boolean;
  conversation?: 'none' | 'all';
  lang?: string;
  align?: 'left' | 'center' | 'right';
};

export function XTweetEmbed({
  tweetId,
  tweetUrl,
  className,
  theme = 'dark',
  dnt = true,
  conversation = 'none',
  lang,
  align
}: XTweetEmbedProps) {
  const safeId = useMemo(() => (tweetId || '').trim(), [tweetId]);
  const safeUrl = useMemo(
    () => (tweetUrl || '').trim() || (safeId ? `https://x.com/i/web/status/${safeId}` : ''),
    [safeId, tweetUrl]
  );
  const embedsBlocked = useBlockThirdPartyEmbedsPreference();
  const iframeSrc = useMemo(() => {
    if (!safeId) return '';
    const params = new URLSearchParams();
    params.set('id', safeId);
    params.set('theme', theme);
    params.set('dnt', dnt ? 'true' : 'false');
    if (conversation && conversation !== 'all') params.set('conversation', conversation);
    if (lang) params.set('lang', lang);
    if (align) params.set('align', align);
    return `https://platform.twitter.com/embed/Tweet.html?${params.toString()}`;
  }, [align, conversation, dnt, lang, safeId, theme]);
  const alignmentClass = useMemo(() => {
    if (align === 'left') return 'justify-start';
    if (align === 'right') return 'justify-end';
    return 'justify-center';
  }, [align]);

  if (!safeId) return null;

  return (
    <ThirdPartyEmbedGate
      className={className}
      title="Embedded X post"
      description="This X post loads content from X only after you choose to load it."
      loadLabel="Load X post"
      externalUrl={safeUrl}
      externalLabel="Open on X"
      blocked={embedsBlocked}
      blockedMessage={
        <>
          Embedded posts from X are disabled in your Privacy Choices settings.{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Update preferences
          </a>{' '}
          or open the post on X instead.
        </>
      }
    >
      <div className={`flex ${alignmentClass}`}>
        <iframe
          title={`X post ${safeId}`}
          src={iframeSrc}
          className="h-[560px] w-full max-w-[550px] rounded-xl border-0 bg-transparent"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        />
      </div>
    </ThirdPartyEmbedGate>
  );
}
