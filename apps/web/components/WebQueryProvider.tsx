'use client';

import { type ReactNode, useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createSharedQueryClient } from '@tminuszero/query';
import { getBrowserClient } from '@/lib/api/supabase';
import {
  applyGuestViewerState,
  invalidateViewerScopedQueries,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/lib/api/queries';

function BootstrapPrefetcher() {
  useViewerSessionQuery();
  useViewerEntitlementsQuery();
  return null;
}

function AuthStateBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      applyGuestViewerState(queryClient);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) {
        applyGuestViewerState(queryClient);
        return;
      }

      invalidateViewerScopedQueries(queryClient);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}

export function WebQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createSharedQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthStateBridge />
      <BootstrapPrefetcher />
      {children}
    </QueryClientProvider>
  );
}
