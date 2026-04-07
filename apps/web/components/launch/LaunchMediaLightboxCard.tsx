'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

type LaunchMediaLightboxCardProps = {
  imageUrl: string;
  alt: string;
  href?: string | null;
  className?: string;
  imageClassName?: string;
  buttonLabel?: string;
};

export function LaunchMediaLightboxCard({
  imageUrl,
  alt,
  href,
  className,
  imageClassName,
  buttonLabel
}: LaunchMediaLightboxCardProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={buttonLabel || `Open ${alt}`}
        className={clsx(
          'group block w-full overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] text-left transition hover:border-primary',
          className
        )}
      >
        <img
          src={imageUrl}
          alt={alt}
          className={clsx('h-40 w-full cursor-zoom-in object-cover transition duration-300 group-hover:scale-[1.02]', imageClassName)}
          loading="lazy"
          decoding="async"
        />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4">
          <button type="button" className="absolute inset-0" onClick={() => setOpen(false)} aria-label="Close image viewer" />
          <div className="relative z-10 flex h-full w-full max-w-6xl items-center justify-center">
            <div className="absolute right-0 top-0 z-10 flex gap-3 p-2">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/20 bg-black/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-black/70"
                >
                  Open source
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/20 bg-black/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-black/70"
              >
                Close
              </button>
            </div>

            <img
              src={imageUrl}
              alt={alt}
              className="max-h-full max-w-full rounded-2xl object-contain"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
