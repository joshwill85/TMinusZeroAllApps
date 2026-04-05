'use client';

import { ProgramHubRail } from '@/components/program-hubs/ProgramHubRail';

const SECTIONS = [
  { id: 'manifest', label: '01 MANIFEST', count: null },
  { id: 'hardware', label: '02 HARDWARE', count: null },
  { id: 'procurement', label: '03 PROCUREMENT', count: null },
  { id: 'timeline', label: '04 TIMELINE', count: null },
  { id: 'media', label: '05 MEDIA', count: null }
];

export function BlueOriginJumpRail({ 
  counts,
  variant = 'both'
}: { 
  counts?: { [key: string]: number | null };
  variant?: 'desktop' | 'mobile' | 'both';
}) {
  return (
    <ProgramHubRail
      theme="blue-origin"
      variant={variant}
      label="Navigation"
      sections={SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        shortLabel: section.label.replace(/^\d+\s+/, ''),
        count: counts?.[section.id] ?? null
      }))}
    />
  );
}
