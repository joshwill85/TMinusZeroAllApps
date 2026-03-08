'use client';

import { getPublicSocialLinks } from '@/lib/env/public';
import { FacebookIcon, XIcon } from '@/components/SocialIcons';

const iconButtonClass =
  'flex h-10 w-10 items-center justify-center rounded-full border border-stroke bg-[rgba(7,9,19,0.72)] text-text2 shadow-glow backdrop-blur-xl transition hover:border-primary hover:text-text1';

export function MobileSocialSidebar() {
  const { facebookUrl, xUrl } = getPublicSocialLinks();
  if (!facebookUrl && !xUrl) return null;

  return (
    <nav
      aria-label="Social links"
      className="fixed right-3 top-1/2 z-40 -translate-y-1/2 md:hidden"
      data-nosnippet
    >
      <div className="flex flex-col gap-2">
        {xUrl && (
          <a href={xUrl} target="_blank" rel="noreferrer" className={iconButtonClass} aria-label="X" title="X">
            <XIcon className="h-5 w-5" />
          </a>
        )}
        {facebookUrl && (
          <a
            href={facebookUrl}
            target="_blank"
            rel="noreferrer"
            className={iconButtonClass}
            aria-label="Facebook"
            title="Facebook"
          >
            <FacebookIcon className="h-5 w-5" />
          </a>
        )}
      </div>
    </nav>
  );
}
