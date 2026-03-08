'use client';

import { useCallback, useEffect, useState } from 'react';

export function useDismissed(key: string, ttlMs: number) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      if (Date.now() - parsed < ttlMs) {
        setDismissed(true);
      }
    } catch {
      return;
    }
  }, [key, ttlMs]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, String(Date.now()));
      } catch {
        // ignore
      }
    }
    setDismissed(true);
  }, [key]);

  const reset = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    setDismissed(false);
  }, [key]);

  return { dismissed, dismiss, reset };
}

