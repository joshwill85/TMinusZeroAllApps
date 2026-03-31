import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Roadmap | ${BRAND_NAME}`,
  description: `Planned phases for ${BRAND_NAME}: data plumbing, native push, billing, and ops.`,
  alternates: { canonical: '/docs/roadmap' }
};

const phases = [
  { title: 'Phase 0 - Foundations', status: 'Done', detail: 'Scaffold Next.js app, theming, mock data, legal pages.' },
  { title: 'Phase 1 - Data plumbing', status: 'Done', detail: 'Supabase schema, LL2 ingestion with rate limiting, public cache derivation.' },
  { title: 'Phase 2 - Native push', status: 'In progress', detail: 'Keep push alerts aligned across mobile clients and shared APIs.' },
  { title: 'Phase 3 - Admin + Ops', status: 'Planned', detail: 'Admin UI, system settings management, logs/outbox views.' }
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Roadmap</p>
      <h1 className="text-3xl font-semibold text-text1">Implementation Phases</h1>
      <div className="mt-4 space-y-3">
        {phases.map((phase) => (
          <div key={phase.title} className="rounded-xl border border-stroke bg-surface-1 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text1">{phase.title}</h3>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs text-text3">{phase.status}</span>
            </div>
            <p className="mt-2 text-sm text-text2">{phase.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
