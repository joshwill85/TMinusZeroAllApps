'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type AdminResourceStatus = 'loading' | 'ready' | 'error' | 'unauthorized';

type UseAdminResourceOptions<T> = {
  initialData: T;
  parse?: (json: unknown) => T;
};

export function useAdminResource<T>(url: string, options: UseAdminResourceOptions<T>) {
  const { initialData, parse } = options;
  const [data, setData] = useState<T>(initialData);
  const [status, setStatus] = useState<AdminResourceStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      const res = await fetch(url, { cache: 'no-store', signal });
      if (res.status === 401 || res.status === 403) {
        setStatus('unauthorized');
        setError('Admin access required. Sign in with an admin account to continue.');
        return false;
      }
      const json = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        const message =
          json && typeof json === 'object' && 'error' in json && typeof (json as any).error === 'string'
            ? String((json as any).error)
            : 'Failed to load admin data.';
        setStatus('error');
        setError(message);
        return false;
      }
      setData(parse ? parse(json) : (json as T));
      setStatus('ready');
      setLastRefreshedAt(new Date().toISOString());
      return true;
    },
    [parse, url]
  );

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return fetchOnce(controller.signal);
  }, [fetchOnce]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    void fetchOnce(controller.signal);
    return () => controller.abort();
  }, [fetchOnce]);

  return useMemo(
    () => ({ data, setData, status, error, setError, refresh, lastRefreshedAt }),
    [data, error, lastRefreshedAt, refresh, status]
  );
}

