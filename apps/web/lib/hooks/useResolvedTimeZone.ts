'use client';

import { useEffect, useState } from 'react';

function normalizeTimeZone(value?: string | null) {
  const nextValue = String(value || '').trim();
  return nextValue || null;
}

export function useResolvedTimeZone(fallbackTimeZone?: string | null) {
  const [timeZone, setTimeZone] = useState(() => normalizeTimeZone(fallbackTimeZone) ?? 'UTC');

  useEffect(() => {
    const detectedTimeZone = normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (detectedTimeZone) {
      setTimeZone(detectedTimeZone);
    }
  }, []);

  return timeZone;
}
