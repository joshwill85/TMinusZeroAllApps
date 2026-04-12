import type { Metadata } from 'next';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildBreadcrumbJsonLd,
  buildPageMetadata,
  buildWebPageJsonLd
} from '@/lib/server/seo';

const ROADMAP_TITLE = `${BRAND_NAME} Roadmap | Launch Data, Alerts & Reliability`;
const ROADMAP_DESCRIPTION = `Planned phases for ${BRAND_NAME}, including launch data plumbing, native alerts, billing, and reliability work.`;

export const metadata: Metadata = buildPageMetadata({
  title: ROADMAP_TITLE,
  description: ROADMAP_DESCRIPTION,
  canonical: '/docs/roadmap'
});

const phases = [
  {
    title: 'Phase 0 - Foundations',
    status: 'Done',
    detail: 'Scaffold Next.js app, theming, mock data, legal pages.'
  },
  {
    title: 'Phase 1 - Data plumbing',
    status: 'Done',
    detail:
      'Supabase schema, LL2 ingestion with rate limiting, public cache derivation.'
  },
  {
    title: 'Phase 2 - Native push',
    status: 'In progress',
    detail: 'Keep push alerts aligned across mobile clients and shared APIs.'
  },
  {
    title: 'Phase 3 - Reliability',
    status: 'Planned',
    detail: 'Background jobs, release hardening, and operational visibility.'
  }
];

export default function RoadmapPage() {
  const jsonLd = [
    buildBreadcrumbJsonLd([
      { name: 'Home', item: '/' },
      { name: 'Docs: Roadmap', item: '/docs/roadmap' }
    ]),
    buildWebPageJsonLd({
      canonical: '/docs/roadmap',
      name: 'T-Minus Zero Roadmap',
      description: ROADMAP_DESCRIPTION
    })
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <JsonLd data={jsonLd} />
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Roadmap</p>
      <h1 className="text-3xl font-semibold text-text1">
        Implementation Phases
      </h1>
      <div className="mt-4 space-y-3">
        {phases.map((phase) => (
          <div
            key={phase.title}
            className="rounded-xl border border-stroke bg-surface-1 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text1">
                {phase.title}
              </h3>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs text-text3">
                {phase.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-text2">{phase.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
