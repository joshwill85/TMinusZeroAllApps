import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { resolveDocsFaqEntries } from '@/lib/content/faq/resolvers';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';

const FAQ_TITLE = `${BRAND_NAME} FAQ | Launch Alerts, Data Refresh & App Help`;
const FAQ_DESCRIPTION = `Answers to common questions about ${BRAND_NAME}, launch-data refresh cadence, alerts, and app behavior.`;

export const metadata: Metadata = buildPageMetadata({
  title: FAQ_TITLE,
  description: FAQ_DESCRIPTION,
  canonical: '/docs/faq'
});

const faqs = resolveDocsFaqEntries();

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer
    }
  }))
};

export default function FAQPage() {
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'FAQ', item: '/docs/faq' }
    ]),
    buildWebPageJsonLd({
      canonical: '/docs/faq',
      name: 'T-Minus Zero FAQ',
      description: FAQ_DESCRIPTION
    }),
    faqJsonLd
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 md:px-6">
      <JsonLd data={jsonLd} />
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Docs</p>
        <h1 className="text-3xl font-semibold text-text1">FAQ</h1>
      </div>
      <div className="space-y-3">
        {faqs.map((item) => (
          <details
            key={item.question}
            className="rounded-xl border border-stroke bg-surface-1 p-4"
          >
            <summary className="cursor-pointer text-base font-semibold text-text1">
              {item.question}
            </summary>
            <p className="pt-2 text-sm text-text2">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
