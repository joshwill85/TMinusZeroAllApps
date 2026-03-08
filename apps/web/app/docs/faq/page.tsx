import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { JsonLd } from '@/components/JsonLd';
import { resolveDocsFaqEntries } from '@/lib/content/faq/resolvers';

export const metadata: Metadata = {
  title: `FAQ | ${BRAND_NAME}`,
  description: `Answers to common questions about ${BRAND_NAME}, refresh cadence, and alerts.`,
  alternates: { canonical: '/docs/faq' }
};

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
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 md:px-6">
      <JsonLd data={faqJsonLd} />
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Docs</p>
        <h1 className="text-3xl font-semibold text-text1">FAQ</h1>
      </div>
      <div className="space-y-3">
        {faqs.map((item) => (
          <details key={item.question} className="rounded-xl border border-stroke bg-surface-1 p-4">
            <summary className="cursor-pointer text-base font-semibold text-text1">{item.question}</summary>
            <p className="pt-2 text-sm text-text2">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
