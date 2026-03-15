'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { RecoveryRedirect } from '@/components/RecoveryRedirect';
import { PrivacySignals } from '@/components/PrivacySignals';
import { SiteChrome } from '@/components/SiteChrome';
import { Starfield } from '@/components/Starfield';
import { Footer } from '@/components/Footer';
import { ToastProvider } from '@/components/ToastProvider';
import { WebQueryProvider } from '@/components/WebQueryProvider';

export function RootFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isEmbed = pathname ? pathname.startsWith('/embed') : false;
  const isCameraGuide = pathname ? /^\/launches\/[^/]+\/ar(?:\/|$)/.test(pathname) : false;

  return (
    <WebQueryProvider>
      <ToastProvider>
        {!isEmbed && (
          <>
            <RecoveryRedirect />
            <PrivacySignals />
            <div className="fixed inset-0 -z-10 grid-bg opacity-40" aria-hidden />
            <div className="fixed inset-0 -z-20 bg-gradient-to-b from-[#070913] via-[#05060a] to-[#03040a]" aria-hidden />
            <Starfield />
            <SiteChrome />
          </>
        )}
        <main id="main" tabIndex={-1} className={clsx('relative outline-none', !isEmbed && 'md:pl-[60px]')}>
          {children}
        </main>
        {!isEmbed && !isCameraGuide && (
          <div className="hidden md:block md:pl-[60px]">
            <Footer />
          </div>
        )}
      </ToastProvider>
    </WebQueryProvider>
  );
}
