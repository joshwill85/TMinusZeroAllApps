'use client';

import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { getPublicSocialLinks } from '@/lib/env/public';
import { FacebookIcon, XIcon } from '@/components/SocialIcons';

export function CommLinkHeader() {
  const [hidden, setHidden] = useState(false);
  const lastYRef = useRef(0);
  const tickingRef = useRef(false);
  const { facebookUrl, xUrl } = getPublicSocialLinks();

  useEffect(() => {
    lastYRef.current = window.scrollY || 0;

    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        const delta = y - lastYRef.current;

        if (y < 12) {
          setHidden(false);
        } else if (delta > 10) {
          setHidden(true);
        } else if (delta < -10) {
          setHidden(false);
        }

        lastYRef.current = y;
        tickingRef.current = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      data-nosnippet
      className={clsx(
        'fixed inset-x-0 z-40 md:hidden',
        'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
        hidden ? '-translate-y-24 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
      )}
    >
      <div className="mx-auto w-full max-w-[560px] px-4 pt-1">
        <div className="flex h-9 items-center justify-between rounded-full border border-stroke bg-[rgba(7,9,19,0.72)] px-4 shadow-glow backdrop-blur-xl">
          <div className="flex w-full items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2" aria-label={`${BRAND_NAME} home`}>
              <Image src="/rocket.svg" alt="" width={22} height={22} className="h-[22px] w-[22px]" priority />
              <span className="text-[12px] font-semibold text-text1">{BRAND_NAME}</span>
            </Link>
            <div className="flex items-center justify-end gap-2">
              {xUrl && (
                <a
                  href={xUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-text2 transition hover:border-primary hover:text-text1"
                  aria-label="X"
                  title="X"
                >
                  <XIcon className="h-4 w-4" />
                </a>
              )}
              {facebookUrl && (
                <a
                  href={facebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-text2 transition hover:border-primary hover:text-text1"
                  aria-label="Facebook"
                  title="Facebook"
                >
                  <FacebookIcon className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
