import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { DATA_ATTRIBUTION_AUDIT_DATE, PUBLIC_DATA_ATTRIBUTIONS } from '@/lib/constants/dataAttribution';

export const metadata: Metadata = {
  title: `Data & Attribution | ${BRAND_NAME}`,
  description: `Data sources, attribution, and usage notes for ${BRAND_NAME}.`,
  alternates: { canonical: '/legal/data' }
};

export default function DataUsePage() {
  const coreSources = PUBLIC_DATA_ATTRIBUTIONS.filter((entry) => entry.section === 'Core feed sources');
  const featureSources = PUBLIC_DATA_ATTRIBUTIONS.filter((entry) => entry.section === 'Feature-specific sources');

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-text2 md:px-6">
      <h1 className="text-3xl font-semibold text-text1">Data & Attribution</h1>
      <p className="mt-3 text-text3">Last updated: {DATA_ATTRIBUTION_AUDIT_DATE}</p>

      <section className="mt-6 space-y-3">
        <p>
          This page reflects the current source inventory used by {BRAND_NAME}. Sources are grouped into core feed providers and feature-specific
          providers.
        </p>
        <p>We do not imply endorsement by any government agency, provider, or publisher.</p>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-text1">Core feed sources</h2>
        <ul className="space-y-3">
          {coreSources.map((entry) => (
            <li key={entry.key} className="rounded-xl border border-stroke bg-surface-1 p-3">
              <p className="text-text1">{entry.sourceLabel}</p>
              <p className="mt-1 text-text2">{entry.usage}</p>
              <p className="mt-1 text-xs text-text3">{entry.attributionNote}</p>
              <a className="mt-1 inline-block text-xs text-primary hover:underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                Source policy / docs
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-text1">Feature-specific sources</h2>
        <ul className="space-y-3">
          {featureSources.map((entry) => (
            <li key={entry.key} className="rounded-xl border border-stroke bg-surface-1 p-3">
              <p className="text-text1">{entry.sourceLabel}</p>
              <p className="mt-1 text-text2">{entry.usage}</p>
              <p className="mt-1 text-xs text-text3">{entry.attributionNote}</p>
              <a className="mt-1 inline-block text-xs text-primary hover:underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                Source policy / docs
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text3">
          Feature-specific sources may appear only on eligible launches, mission pages, satellites, or trajectory surfaces.
        </p>
      </section>
    </div>
  );
}
