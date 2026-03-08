import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from './settings.ts';

export type EdgeJobTriggerResult = {
  attempted: boolean;
  triggered: boolean;
  reason: string | null;
  status: number | null;
};

export type EdgeJobTriggerCoalesceOptions = {
  lockName?: string;
  ttlSeconds?: number;
  settingKey?: string;
  defaultTtlSeconds?: number;
};

export const TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE: EdgeJobTriggerCoalesceOptions = {
  lockName: 'trajectory_products_followup_trigger',
  settingKey: 'trajectory_products_followup_cooldown_seconds',
  defaultTtlSeconds: 90
};

export async function triggerEdgeJob({
  supabase,
  jobSlug,
  body,
  coalesce
}: {
  supabase: SupabaseClient;
  jobSlug: string;
  body?: Record<string, unknown>;
  coalesce?: EdgeJobTriggerCoalesceOptions;
}): Promise<EdgeJobTriggerResult> {
  const settingKeys = ['jobs_enabled', 'jobs_base_url', 'jobs_auth_token', 'jobs_apikey'];
  if (coalesce?.settingKey) settingKeys.push(coalesce.settingKey);
  const settings = await getSettings(supabase, settingKeys);

  const jobsEnabled = readBooleanSetting(settings.jobs_enabled, true);
  if (!jobsEnabled) {
    return { attempted: false, triggered: false, reason: 'jobs_disabled', status: null };
  }

  const jobToken = readStringSetting(settings.jobs_auth_token, '').trim();
  if (!jobToken) {
    return { attempted: false, triggered: false, reason: 'jobs_auth_token_missing', status: null };
  }

  const apiKey =
    readStringSetting(settings.jobs_apikey, '').trim() ||
    String(Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!apiKey) {
    return { attempted: false, triggered: false, reason: 'jobs_apikey_missing', status: null };
  }

  const baseUrl =
    readStringSetting(settings.jobs_base_url, '').trim() ||
    [String(Deno.env.get('SUPABASE_URL') || '').trim(), 'functions', 'v1'].filter(Boolean).join('/');
  if (!baseUrl) {
    return { attempted: false, triggered: false, reason: 'jobs_base_url_missing', status: null };
  }

  let acquiredLock:
    | {
        lockId: string;
        lockName: string;
      }
    | null = null;

  if (coalesce) {
    const fallbackTtlSeconds = clampTriggerTtlSeconds(coalesce.defaultTtlSeconds ?? coalesce.ttlSeconds ?? 90);
    const ttlSeconds = clampTriggerTtlSeconds(
      coalesce.settingKey ? readNumberSetting(settings[coalesce.settingKey], fallbackTtlSeconds) : fallbackTtlSeconds
    );
    const lockName = coalesce.lockName?.trim() || `edge_job_trigger:${jobSlug}`;
    const lockId = crypto.randomUUID();
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_job_lock', {
      lock_name_in: lockName,
      ttl_seconds_in: ttlSeconds,
      locked_by_in: lockId
    });
    if (!lockError && !lockAcquired) {
      return {
        attempted: false,
        triggered: false,
        reason: 'coalesced',
        status: null
      };
    }
    if (!lockError && lockAcquired) {
      acquiredLock = { lockId, lockName };
    }
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/${jobSlug}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'x-job-token': jobToken,
        apikey: apiKey
      },
      body: JSON.stringify(body ?? {})
    });

    if (!response.ok) {
      if (acquiredLock) {
        await releaseTriggerLock(supabase, acquiredLock).catch(() => undefined);
      }
      return {
        attempted: true,
        triggered: false,
        reason: `http_${response.status}`,
        status: response.status
      };
    }

    return {
      attempted: true,
      triggered: true,
      reason: null,
      status: response.status
    };
  } catch (error) {
    if (acquiredLock) {
      await releaseTriggerLock(supabase, acquiredLock).catch(() => undefined);
    }
    throw error;
  }
}

function clampTriggerTtlSeconds(value: number) {
  if (!Number.isFinite(value)) return 90;
  return Math.max(15, Math.min(3600, Math.trunc(value)));
}

async function releaseTriggerLock(
  supabase: SupabaseClient,
  lock: {
    lockId: string;
    lockName: string;
  }
) {
  await supabase.rpc('release_job_lock', {
    lock_name_in: lock.lockName,
    locked_by_in: lock.lockId
  });
}
