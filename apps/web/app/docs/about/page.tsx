import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';

const DOCS_ABOUT_TITLE = `What Is ${BRAND_NAME}? | Launch Tracker Overview`;
const DOCS_ABOUT_DESCRIPTION = `Overview of ${BRAND_NAME}, what it covers, and how the web and mobile launch-tracking surfaces fit together.`;

export const metadata: Metadata = buildPageMetadata({
  title: DOCS_ABOUT_TITLE,
  description: DOCS_ABOUT_DESCRIPTION,
  canonical: '/docs/about'
});

export default function AboutPage() {
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'Docs: About', item: '/docs/about' }
    ]),
    buildWebPageJsonLd({
      canonical: '/docs/about',
      name: 'About T-Minus Zero Docs',
      description: DOCS_ABOUT_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <JsonLd data={jsonLd} />
      <p className="text-xs uppercase tracking-[0.1em] text-text3">About</p>
      <h1 className="text-3xl font-semibold text-text1">Why T-Minus Zero?</h1>
      <p className="mt-3 text-sm text-text2">
        Built for launch fans and operators who want a fast, trustworthy signal
        on what is happening across launches and related reference data. The
        native mobile app is now the place for push alerts and device-level
        notification management.
      </p>
    </div>
  );
}
