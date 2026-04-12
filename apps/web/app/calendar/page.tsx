import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { buildPageMetadata } from '@/lib/server/seo';
import { CalendarPageClient } from './CalendarPageClient';

export const metadata: Metadata = buildPageMetadata({
  title: `Launch Calendar | ${BRAND_NAME}`,
  description:
    'Signed-in monthly launch calendar with countdown browsing, launch links, and Premium export tools.',
  canonical: '/calendar',
  robots: { index: false, follow: false },
  includeSocial: false
});

export default function CalendarPage() {
  return <CalendarPageClient />;
}
