import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import {
  DATA_ATTRIBUTION_AUDIT_DATE,
  PUBLIC_DATA_ATTRIBUTIONS
} from '@/lib/constants/dataAttribution';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';

const DATA_TITLE = `${BRAND_NAME} Data Sources & Attribution | Launch Data Providers`;
const DATA_DESCRIPTION = `Source inventory, attribution notes, and usage details for launch, catalog, and feature-specific data on ${BRAND_NAME}.`;

export const metadata: Metadata = buildPageMetadata({
  title: DATA_TITLE,
  description: DATA_DESCRIPTION,
  canonical: '/legal/data'
});

export default function DataUsePage() {
  const coreSources = PUBLIC_DATA_ATTRIBUTIONS.filter(
    (entry) => entry.section === 'Core feed sources'
  );
  const featureSources = PUBLIC_DATA_ATTRIBUTIONS.filter(
    (entry) => entry.section === 'Feature-specific sources'
  );
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'Data & Attribution', item: '/legal/data' }
    ]),
    buildWebPageJsonLd({
      canonical: '/legal/data',
      name: 'T-Minus Zero Data Sources and Attribution',
      description: DATA_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <JsonLd data={jsonLd} />
      <h1 className="text-3xl font-semibold text-text1">Data & Attribution</h1>
      <p className="mt-3 text-text3">
        Last updated: {DATA_ATTRIBUTION_AUDIT_DATE}
      </p>

      <section className="mt-6 space-y-3">
        <p>
          This page reflects the current source inventory used by {BRAND_NAME}.
          Sources are grouped into core feed providers and feature-specific
          providers.
        </p>
        <p>
          We do not imply endorsement by any government agency, provider, or
          publisher.
        </p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-text1">Core feed sources</h2>
        <ul className="space-y-3">
          {coreSources.map((entry) => (
            <li
              key={entry.key}
              className="rounded-xl border border-stroke bg-surface-1 p-3"
            >
              <p className="text-text1">{entry.sourceLabel}</p>
              <p className="mt-1 text-text2">{entry.usage}</p>
              <p className="mt-1 text-xs text-text3">{entry.attributionNote}</p>
              <a
                className="mt-1 inline-block text-xs text-primary hover:underline"
                href={entry.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source policy / docs
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-text1">
          Feature-specific sources
        </h2>
        <ul className="space-y-3">
          {featureSources.map((entry) => (
            <li
              key={entry.key}
              className="rounded-xl border border-stroke bg-surface-1 p-3"
            >
              <p className="text-text1">{entry.sourceLabel}</p>
              <p className="mt-1 text-text2">{entry.usage}</p>
              <p className="mt-1 text-xs text-text3">{entry.attributionNote}</p>
              <a
                className="mt-1 inline-block text-xs text-primary hover:underline"
                href={entry.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source policy / docs
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text3">
          Feature-specific sources may appear only on eligible launches, mission
          pages, satellites, or trajectory surfaces.
        </p>
      </section>
    </div>
  );
}
