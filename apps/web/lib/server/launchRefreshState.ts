import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildLaunchRefreshChannelTopic,
  buildLaunchRefreshStateKey,
  isLaunchRefreshStateScope,
  type LaunchRefreshStateScope
} from '@tminuszero/domain';

type LaunchRefreshStateRow = {
  cache_key?: string | null;
  scope?: string | null;
  launch_id?: string | null;
  updated_at?: string | null;
  revision?: number | null;
};

type LaunchRefreshStateQueryError = {
  code?: string | null;
  message?: string | null;
};

export type LaunchRefreshStateSeed = {
  cacheKey: string;
  scope: LaunchRefreshStateScope;
  launchId: string | null;
  updatedAt: string | null;
  revision: number;
};

export async function loadLaunchRefreshStateSeed(
  client: SupabaseClient<any, any, any>,
  scope: LaunchRefreshStateScope,
  options: { launchId?: string | null; fallbackUpdatedAt?: string | null } = {}
): Promise<LaunchRefreshStateSeed> {
  const cacheKey = buildLaunchRefreshStateKey(scope, options.launchId);
  const fallbackLaunchId = normalizeText(options.launchId) ?? null;
  const fallbackUpdatedAt = normalizeText(options.fallbackUpdatedAt) ?? null;
  const { data, error } = await client
    .from('launch_refresh_state')
    .select('cache_key, scope, launch_id, updated_at, revision')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (error) {
    if (isMissingLaunchRefreshStateRelationError(error)) {
      console.warn('launch refresh state unavailable, using fallback seed', { cacheKey, scope, error });
      return {
        cacheKey,
        scope,
        launchId: fallbackLaunchId,
        updatedAt: fallbackUpdatedAt,
        revision: 0
      };
    }
    console.error('launch refresh state lookup failed', { cacheKey, scope, error });
    throw error;
  }

  const row = (data || null) as LaunchRefreshStateRow | null;
  const resolvedScope = row?.scope && isLaunchRefreshStateScope(row.scope) ? row.scope : scope;
  const revision = normalizeRevision(row?.revision);

  return {
    cacheKey,
    scope: resolvedScope,
    launchId: normalizeText(row?.launch_id) ?? fallbackLaunchId,
    updatedAt: normalizeText(row?.updated_at) ?? fallbackUpdatedAt,
    revision
  };
}

export function getLaunchRefreshChannelTopic(scope: LaunchRefreshStateScope, launchId?: string | null) {
  return buildLaunchRefreshChannelTopic(buildLaunchRefreshStateKey(scope, launchId));
}

function normalizeRevision(value: number | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.trunc(numeric);
}

function normalizeText(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function isMissingLaunchRefreshStateRelationError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code, message } = error as LaunchRefreshStateQueryError;
  if (code === 'PGRST205' || code === '42P01') {
    return true;
  }

  const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';
  return normalizedMessage.includes('launch_refresh_state') && normalizedMessage.includes('schema cache');
}
