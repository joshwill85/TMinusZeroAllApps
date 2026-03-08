'use client';

import { useEffect } from 'react';

export function RecoveryRedirect() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/auth/reset-password')) return;

    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchType = searchParams.get('type');
    const hashType = hashParams.get('type');

    if (searchType !== 'recovery' && hashType !== 'recovery') return;

    const target = `/auth/reset-password${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);

  return null;
}
