'use client';

import { useCallback, useEffect, useState } from 'react';

export function useLocalStorageBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setLoaded(true);
        return;
      }
      const normalized = raw.trim().toLowerCase();
      if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
        setValue(true);
      } else if (normalized === '0' || normalized === 'false' || normalized === 'no') {
        setValue(false);
      }
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, [key]);

  const setPersistedValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (value: boolean) => boolean)(prev) : next;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(key, resolved ? '1' : '0');
          } catch {
            // ignore
          }
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, setPersistedValue, loaded] as const;
}

