export type LaunchRegion = 'us' | 'non-us' | 'all';

export const US_PAD_COUNTRY_CODES = ['USA', 'US'] as const;

export function parseLaunchRegion(value: string | null): LaunchRegion {
  if (value === 'all') return 'all';
  if (value === 'non-us') return 'non-us';
  return 'us';
}
