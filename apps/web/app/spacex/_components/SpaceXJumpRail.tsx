'use client';

import { ProgramHubRail } from '@/components/program-hubs/ProgramHubRail';

export type SpaceXHubSectionId =
  | 'mission'
  | 'recovery'
  | 'hardware'
  | 'media'
  | 'flights'
  | 'contracts'
  | 'finance'
  | 'faq';

const SECTIONS: Array<{ id: SpaceXHubSectionId; label: string }> = [
  { id: 'mission', label: '01 MISSION' },
  { id: 'recovery', label: '02 RECOVERY' },
  { id: 'hardware', label: '03 HARDWARE' },
  { id: 'media', label: '04 MEDIA' },
  { id: 'flights', label: '05 FLIGHTS' },
  { id: 'contracts', label: '06 CONTRACTS' },
  { id: 'finance', label: '07 FINANCE' },
  { id: 'faq', label: '08 FAQ' }
];

export function SpaceXJumpRail({
  counts,
  variant = 'both'
}: {
  counts: Record<SpaceXHubSectionId, number>;
  variant?: 'desktop' | 'mobile' | 'both';
}) {
  return (
    <ProgramHubRail
      theme="spacex"
      variant={variant}
      label="Navigation"
      sections={SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        shortLabel: section.label.replace(/^\d+\s+/, ''),
        count: counts[section.id]
      }))}
    />
  );
}
