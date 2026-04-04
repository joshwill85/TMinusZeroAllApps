'use client';

import Script from 'next/script';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThirdPartyEmbedGate } from '@/components/ThirdPartyEmbedGate';
import { useBlockThirdPartyEmbedsPreference } from '@/lib/privacy/embedPreference';

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        createTimeline?: (
          source: { sourceType: 'profile'; screenName: string },
          element: HTMLElement,
          options?: Record<string, unknown>
        ) => Promise<HTMLElement>;
        createTweet?: (
          tweetId: string,
          element: HTMLElement,
          options?: Record<string, unknown>
        ) => Promise<HTMLElement>;
        load?: (element?: HTMLElement) => void;
      };
    };
  }
}

export type XTimelineEmbedProps = {
  handle: string;
  className?: string;
  height?: number;
  width?: number | string;
  theme?: 'dark' | 'light';
  chrome?: string;
  tweetLimit?: number;
  lang?: string;
  linkColor?: string;
  borderColor?: string;
  dnt?: boolean;
  ariaPolite?: 'polite' | 'assertive' | 'rude';
};

function getCssColorVar(name: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  return null;
}

export function XTimelineEmbed({
  handle,
  className,
  height = 600,
  width = '100%',
  theme = 'dark',
  chrome,
  tweetLimit,
  lang,
  linkColor,
  borderColor,
  dnt = true,
  ariaPolite
}: XTimelineEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [resolvedLinkColor, setResolvedLinkColor] = useState<string | null>(null);
  const [resolvedBorderColor, setResolvedBorderColor] = useState<string | null>(null);

  const screenName = useMemo(() => handle.replace(/^@/, '').trim(), [handle]);
  const embedsBlocked = useBlockThirdPartyEmbedsPreference();
  const effectiveLinkColor = linkColor ?? resolvedLinkColor ?? undefined;
  const effectiveBorderColor = borderColor ?? resolvedBorderColor ?? undefined;

  useEffect(() => {
    if (window.twttr?.widgets) setReady(true);
  }, []);

  useEffect(() => {
    setResolvedLinkColor(getCssColorVar('--primary'));
    setResolvedBorderColor(getCssColorVar('--stroke'));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const options: Record<string, unknown> = {
      height,
      width,
      theme,
      dnt
    };

    const normalizedChrome = chrome?.trim();
    if (normalizedChrome) options.chrome = normalizedChrome;
    if (tweetLimit != null) options.tweetLimit = tweetLimit;
    if (lang) options.lang = lang;
    if (effectiveLinkColor) options.linkColor = effectiveLinkColor;
    if (effectiveBorderColor) options.borderColor = effectiveBorderColor;
    if (ariaPolite) options.ariaPolite = ariaPolite;

    const widgets = window.twttr?.widgets;
    if (widgets?.createTimeline) {
      widgets.createTimeline({ sourceType: 'profile', screenName }, container, options).catch((error) => {
        console.error('x timeline embed error', error);
      });
      return;
    }

    if (widgets?.load) {
      const href = `https://x.com/${encodeURIComponent(screenName)}`;
      const anchor = document.createElement('a');
      anchor.className = 'twitter-timeline';
      anchor.href = href;
      anchor.textContent = `@${screenName} on X`;
      anchor.setAttribute('data-height', String(height));
      anchor.setAttribute('data-width', String(width));
      anchor.setAttribute('data-theme', theme);
      if (normalizedChrome) anchor.setAttribute('data-chrome', normalizedChrome);
      if (tweetLimit != null) anchor.setAttribute('data-tweet-limit', String(tweetLimit));
      if (lang) anchor.setAttribute('data-lang', lang);
      if (effectiveLinkColor) anchor.setAttribute('data-link-color', effectiveLinkColor);
      if (effectiveBorderColor) anchor.setAttribute('data-border-color', effectiveBorderColor);
      if (dnt) anchor.setAttribute('data-dnt', 'true');
      if (ariaPolite) anchor.setAttribute('data-aria-polite', ariaPolite);
      container.appendChild(anchor);
      widgets.load(container);
    }
  }, [
    ariaPolite,
    chrome,
    dnt,
    effectiveBorderColor,
    effectiveLinkColor,
    height,
    lang,
    ready,
    screenName,
    theme,
    tweetLimit,
    width
  ]);

  if (!screenName) return null;

  return (
    <ThirdPartyEmbedGate
      className={className}
      title={`Embedded X timeline for @${screenName}`}
      description="This X timeline loads content from X only after you choose to load it."
      loadLabel="Load X timeline"
      externalUrl={`https://x.com/${encodeURIComponent(screenName)}`}
      externalLabel="Open on X"
      blocked={embedsBlocked}
      blockedMessage={
        <>
          Embedded posts from X are disabled in your Privacy Choices settings.{' '}
          <a className="text-primary hover:underline" href="/legal/privacy-choices">
            Update preferences
          </a>{' '}
          or open the timeline on X instead.
        </>
      }
    >
      <div ref={containerRef} />
      <Script
        id="x-widgets"
        src="https://platform.twitter.com/widgets.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
    </ThirdPartyEmbedGate>
  );
}
