'use client';

import { useSearchParams } from 'next/navigation';

const EMPTY_SEARCH_PARAMS = new URLSearchParams();

// Next's compat navigation types widen useSearchParams() to nullable during build.
// Fall back to an empty query bag so client components keep stable, read-only semantics.
export function useSafeSearchParams() {
  return useSearchParams() ?? EMPTY_SEARCH_PARAMS;
}
