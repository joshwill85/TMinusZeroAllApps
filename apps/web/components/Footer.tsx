'use client';

import Image from 'next/image';
import { buildPreferencesHref } from '@tminuszero/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { getPublicSocialLinks } from '@/lib/env/public';
import { FacebookIcon, XIcon } from '@/components/SocialIcons';

export function Footer() {
  const { facebookUrl, xUrl } = getPublicSocialLinks();
  const preferencesHref = buildPreferencesHref();

  return (
    <footer className="mt-12 border-t border-stroke bg-[rgba(5,6,10,0.9)] px-4 py-8 text-sm text-text3 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3 text-text2">
          <Image src="/rocket.svg" alt={`${BRAND_NAME} logo`} width={24} height={24} className="mt-0.5 h-6 w-6" />
          <div>
            <div className="text-sm font-semibold text-text1">{BRAND_NAME}</div>
            <div>Primary launch schedule data: The Space Devs - Launch Library 2</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a className="hover:text-text1" href="/support">
            Support
          </a>
          <a className="hover:text-text1" href="/legal/terms">
            Terms
          </a>
          <a className="hover:text-text1" href="/legal/privacy">
            Privacy
          </a>
          <a className="hover:text-text1" href="/legal/privacy-choices">
            Privacy Choices
          </a>
          <a className="hover:text-text1" href="/legal/data">
            Data Use
          </a>
          <a className="hover:text-text1" href="/about">
            About
          </a>
          <a className="hover:text-text1" href="/docs/faq">
            FAQ
          </a>
          <a className="hover:text-text1" href={preferencesHref}>
            Notifications
          </a>
          <a className="hover:text-text1" href="/artemis">
            Artemis
          </a>
          <a className="hover:text-text1" href="/spacex">
            SpaceX
          </a>
          <a className="hover:text-text1" href="/jellyfish-effect">
            Jellyfish Guide
          </a>
          <a className="hover:text-text1" href="/blue-origin">
            Blue Origin
          </a>
          {(facebookUrl || xUrl) && (
            <div className="flex items-center gap-2">
              {xUrl && (
                <a
                  href={xUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-text2 transition hover:border-primary hover:text-text1"
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
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-text2 transition hover:border-primary hover:text-text1"
                  aria-label="Facebook"
                  title="Facebook"
                >
                  <FacebookIcon className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
