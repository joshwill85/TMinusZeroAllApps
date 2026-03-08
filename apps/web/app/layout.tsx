import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { getGoogleSiteVerification, getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { BRAND_TECHNICAL_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import { JsonLd } from '@/components/JsonLd';
import { RootFrame } from '@/components/RootFrame';
import './globals.css';

const sans = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const siteUrl = getSiteUrl();
const siteMeta = buildSiteMeta();
const googleSiteVerification = getGoogleSiteVerification();

export const metadata: Metadata = {
  title: SITE_META.title,
  description: SITE_META.description,
  keywords: SITE_META.keywords,
  metadataBase: new URL(siteUrl),
  openGraph: {
    siteName: SITE_META.siteName,
    type: 'website',
    images: [
      {
        url: siteMeta.ogImage,
        width: 1200,
        height: 630,
        alt: SITE_META.ogImageAlt,
        type: 'image/jpeg'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    images: [
      {
        url: siteMeta.ogImage,
        alt: SITE_META.ogImageAlt
      }
    ]
  },
  icons: {
    icon: [
      { url: '/rocket.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' }
    ],
    shortcut: '/favicon-32x32.png',
    apple: '/apple-touch-icon.png'
  },
  ...(googleSiteVerification
    ? {
        verification: {
          google: googleSiteVerification
        }
      }
    : {})
};

export const viewport: Viewport = {
  themeColor: '#05060A'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': organizationId,
      name: SITE_META.siteName,
      alternateName: BRAND_TECHNICAL_NAME,
      url: siteUrl,
      logo: `${siteUrl}/apple-touch-icon.png`,
      email: SUPPORT_EMAIL
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': websiteId,
      name: SITE_META.siteName,
      url: siteUrl,
      publisher: { '@id': organizationId }
    }
  ];

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text1 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:border focus:border-stroke focus:bg-surface-1 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-text1 focus:shadow-glow focus:outline-none"
        >
          Skip to main content
        </a>
        <JsonLd data={structuredData} />
        <RootFrame>{children}</RootFrame>
      </body>
    </html>
  );
}
