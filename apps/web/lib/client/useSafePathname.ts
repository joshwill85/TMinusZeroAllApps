'use client';

import { usePathname } from 'next/navigation';

// Next's compat navigation types widen usePathname() to nullable during build.
// Treat the missing case as the empty path so client route checks stay safe.
export function useSafePathname() {
  return usePathname() ?? '';
}
