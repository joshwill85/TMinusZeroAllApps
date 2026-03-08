'use client';

import { useEffect } from 'react';

export function ShareLaunchRedirect({ target }: { target: string }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.location.replace(target);
  }, [target]);

  return null;
}
