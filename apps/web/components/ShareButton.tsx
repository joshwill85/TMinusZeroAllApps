'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';

type ShareButtonProps = {
  url: string;
  title: string;
  text?: string;
  variant?: 'icon' | 'button';
  className?: string;
};

export function ShareButton({ url, title, text, variant = 'icon', className }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const baseShareUrl = useMemo(() => resolveUrl(url), [url]);

  const handleShare = async () => {
    const shareUrl = appendShareToken(baseShareUrl);
    const payload = { title, text, url: shareUrl };
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    if (canShare) {
      try {
        await navigator.share(payload);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={handleShare}
        className={clsx('btn-secondary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm', className)}
        aria-label="Share launch"
      >
        <ShareIcon className="h-4 w-4" />
        {copied ? 'Link copied' : 'Share'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={clsx(
        'btn-secondary flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary',
        className
      )}
      title={copied ? 'Link copied' : 'Share launch'}
      aria-label="Share launch"
    >
      {copied ? <span className="text-sm">✓</span> : <ShareIcon className="h-4 w-4" />}
    </button>
  );
}

function resolveUrl(url: string) {
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!origin) return trimmed;
  if (trimmed.startsWith('/')) return `${origin}${trimmed}`;
  return `${origin}/${trimmed}`;
}

function appendShareToken(url: string) {
  if (url.includes('share=')) return url;
  const token = Date.now().toString(36);
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}share=${token}`;
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 3v12m0-12l-3 3m3-3l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 10v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
