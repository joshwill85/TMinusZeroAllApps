import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { JEP_FAQ_ITEMS } from '@/lib/content/jepFaq';
import {
  JELLYFISH_ALIAS_LABELS,
  JELLYFISH_ALIAS_NOTE,
  JELLYFISH_GUIDE_INTRO,
  JELLYFISH_GUIDE_LAST_UPDATED,
  JELLYFISH_GUIDE_SECTIONS,
  JELLYFISH_GUIDE_TITLE,
  JELLYFISH_GUIDE_TOC,
  JELLYFISH_GUIDE_WORD_COUNT,
  JELLYFISH_QUICK_ANSWER,
  JELLYFISH_QUICK_VIBE
} from '@/lib/content/jellyfishGuide';
import { getSiteUrl } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

export const revalidate = 60 * 60;

export async function generateMetadata(): Promise<Metadata> {
  const siteMeta = buildSiteMeta();
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const canonical = '/jellyfish-effect';
  const pageUrl = `${siteUrl}${canonical}`;
  const description =
    'What the rocket jellyfish effect is, why it happens, and how to plan your viewing with JEP.';

  return {
    title: `${JELLYFISH_GUIDE_TITLE} | ${BRAND_NAME}`,
    description,
    alternates: { canonical },
    keywords: [
      'rocket jellyfish effect',
      'space jellyfish',
      'rocket jellyfish',
      'twilight plume',
      'JEP',
      'jellyfish exposure potential'
    ],
    openGraph: {
      title: `${JELLYFISH_GUIDE_TITLE} | ${BRAND_NAME}`,
      description,
      url: pageUrl,
      type: 'article',
      siteName: SITE_META.siteName,
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
      title: `${JELLYFISH_GUIDE_TITLE} | ${BRAND_NAME}`,
      description,
      images: [{ url: siteMeta.ogImage, alt: SITE_META.ogImageAlt }]
    }
  };
}

export default function JellyfishEffectPage() {
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const pageUrl = `${siteUrl}/jellyfish-effect`;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Jellyfish Effect Guide',
        item: pageUrl
      }
    ]
  };

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${pageUrl}#article`,
    headline: JELLYFISH_GUIDE_TITLE,
    description:
      'What the rocket jellyfish effect is, why it happens, and how to plan your viewing with JEP.',
    datePublished: JELLYFISH_GUIDE_LAST_UPDATED,
    dateModified: JELLYFISH_GUIDE_LAST_UPDATED,
    author: { '@type': 'Organization', name: SITE_META.siteName },
    publisher: { '@type': 'Organization', name: SITE_META.siteName },
    mainEntityOfPage: pageUrl,
    wordCount: JELLYFISH_GUIDE_WORD_COUNT,
    about: [
      { '@type': 'Thing', name: 'rocket jellyfish effect' },
      { '@type': 'Thing', name: 'twilight plume' },
      { '@type': 'Thing', name: 'Jellyfish Exposure Potential (JEP)' }
    ]
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: JEP_FAQ_ITEMS.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: entry.answer
      }
    }))
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8 md:py-16">
      <JsonLd data={[breadcrumbJsonLd, articleJsonLd, faqJsonLd]} />

      {/* Hero */}
      <header className="mb-12">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-text3">
          Rocket Visibility Guide
        </p>
        <h1 className="mb-6 text-3xl font-semibold leading-tight text-text1 md:text-4xl">
          {JELLYFISH_GUIDE_TITLE}
        </h1>
        <p className="text-base leading-relaxed text-text2 md:text-lg">
          {JELLYFISH_GUIDE_INTRO}
        </p>
      </header>

      {/* Quick context */}
      <div className="mb-12 border-l-2 border-text3/30 pl-5">
        <p className="text-sm leading-relaxed text-text2">
          <span className="font-medium text-text1">The short version:</span>{' '}
          {JELLYFISH_QUICK_VIBE}
        </p>
      </div>

      {/* Also known as */}
      <div className="mb-12">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-text3">
          Also called
        </p>
        <div className="flex flex-wrap gap-2">
          {JELLYFISH_ALIAS_LABELS.map((label) => (
            <span
              key={label}
              className="rounded-full border border-stroke bg-surface-1 px-3 py-1 text-xs text-text2"
            >
              {label}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-text3">{JELLYFISH_ALIAS_NOTE}</p>
      </div>

      {/* Quick Answer */}
      <section className="mb-16 rounded-xl bg-surface-1 p-6">
        <h2 className="mb-3 text-lg font-semibold text-text1">Quick Answer</h2>
        <p className="text-sm leading-relaxed text-text2">{JELLYFISH_QUICK_ANSWER}</p>
      </section>

      {/* Table of Contents */}
      <nav aria-label="Table of contents" className="mb-16">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-text3">
          In this guide
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {JELLYFISH_GUIDE_TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-lg border border-stroke/50 px-4 py-2.5 text-sm text-text2 transition-colors hover:border-stroke hover:bg-surface-1 hover:text-text1"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <article className="space-y-16">
        {JELLYFISH_GUIDE_SECTIONS.map((section, index) => (
          <section key={section.id} id={section.id} className="scroll-mt-8">
            <h2 className="mb-4 text-xl font-semibold text-text1 md:text-2xl">
              {section.title}
            </h2>
            <div className="space-y-4">
              {section.paragraphs.map((paragraph, pIndex) => (
                <p
                  key={`${section.id}-p-${pIndex}`}
                  className="text-sm leading-relaxed text-text2 md:text-base md:leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </div>
            {section.bullets && section.bullets.length > 0 && (
              <ul className="mt-6 space-y-3">
                {section.bullets.map((item, bIndex) => (
                  <li
                    key={`${section.id}-b-${bIndex}`}
                    className="flex gap-3 text-sm text-text2 md:text-base"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-text3" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )}
            {index < JELLYFISH_GUIDE_SECTIONS.length - 1 && (
              <div className="mt-12 border-b border-stroke/30" />
            )}
          </section>
        ))}
      </article>

      {/* FAQ */}
      <section id="faq" className="mt-20 scroll-mt-8">
        <h2 className="mb-8 text-2xl font-semibold text-text1">
          Frequently Asked Questions
        </h2>
        <dl className="space-y-6">
          {JEP_FAQ_ITEMS.map((entry, index) => (
            <div
              key={entry.question}
              className="border-b border-stroke/30 pb-6 last:border-0"
            >
              <dt className="mb-2 text-sm font-medium text-text1 md:text-base">
                {entry.question}
              </dt>
              <dd className="text-sm leading-relaxed text-text2 md:text-base md:leading-relaxed">
                {entry.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Footer links */}
      <footer className="mt-16 flex flex-wrap items-center gap-3 border-t border-stroke/30 pt-8">
        <Link
          href="/launch-providers"
          className="rounded-full border border-stroke px-4 py-2 text-xs font-medium uppercase tracking-widest text-text3 transition-colors hover:border-text2 hover:text-text1"
        >
          Launch Providers
        </Link>
        <Link
          href="/#schedule"
          className="rounded-full border border-stroke px-4 py-2 text-xs font-medium uppercase tracking-widest text-text3 transition-colors hover:border-text2 hover:text-text1"
        >
          Launch Schedule
        </Link>
      </footer>
    </div>
  );
}
