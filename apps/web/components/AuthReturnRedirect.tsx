'use client';

import { useEffect } from 'react';
import { buildAuthCallbackHref } from '@tminuszero/navigation';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';

function hasAuthTokensInHash(hash: string) {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  return Boolean(params.get('access_token') && params.get('refresh_token'));
}

function hasAuthErrorInHash(hash: string) {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  return Boolean(params.get('error') || params.get('error_description'));
}

export function AuthReturnRedirect() {
  const searchParams = useSafeSearchParams();
  const searchParamString = searchParams.toString();

  useEffect(() => {
    const hash = window.location.hash || '';
    if (!hash) return;
    if (!hasAuthTokensInHash(hash) && !hasAuthErrorInHash(hash)) return;

    const current = new URL(window.location.href);
    const callback = new URL(buildAuthCallbackHref(), current.origin);
    callback.search = current.search;
    callback.hash = current.hash;
    window.location.replace(callback.toString());
  }, [searchParamString]);

  return null;
}
