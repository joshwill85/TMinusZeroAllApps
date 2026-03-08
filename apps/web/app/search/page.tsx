import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import SearchPageClient from './SearchPageClient';

export const metadata: Metadata = {
  title: `Search | ${BRAND_NAME}`,
  description: `Internal site search for ${BRAND_NAME}.`,
  alternates: { canonical: '/search' },
  robots: {
    index: false,
    follow: true
  }
};

export default function SearchPage() {
  return <SearchPageClient />;
}
