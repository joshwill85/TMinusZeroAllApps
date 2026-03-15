import type { Metadata } from 'next';
import { CalendarPageClient } from './CalendarPageClient';

export const metadata: Metadata = {
  title: 'Launch Calendar',
  description: 'Signed-in launch calendar with month-by-month browsing, launch detail links, and Premium export options.'
};

export default function CalendarPage() {
  return <CalendarPageClient />;
}
