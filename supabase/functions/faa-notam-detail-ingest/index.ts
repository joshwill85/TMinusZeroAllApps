import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import {
  FAA_USER_AGENT,
  buildNotamSourceUrl,
  normalizeNonEmptyString,
  parseDateWindowFromText,
  parseNotamId
} from '../_shared/faa.ts';

const DEFAULTS = {
  enabled: true,
  limit: 80,
  refreshHours: 6,
  notamTextUrl: 'https://tfr.faa.gov/tfrapi/getNotamText',
  webTextUrl: 'https://tfr.faa.gov/tfrapi/getWebText'
};

type TfrRecordRow = {
  id: string;
  notam_id: string | null;
  mod_at: string | null;
  updated_at: string | null;
  status: string | null;
};

type ExistingDetailRow = {
  notam_id: string;
  fetched_at: string | null;
};

type Candidate = {
  recordId: string;
  notamId: string;
  modAt: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'faa_notam_detail_ingest');

  const stats: Record<string, unknown> = {
    recordsScanned: 0,
    uniqueNotamIds: 0,
    queueSize: 0,
    skippedRecentlyFetched: 0,
    fetched: 0,
    inserted: 0,
    duplicatePayloads: 0,
    emptyPayloads: 0,
    parseWindowFound: 0,
    errors: [] as Array<{ step: string; notamId?: string; error: string }>
  };

  try {
    const settings = await getSettings(supabase, [
      'faa_notam_detail_job_enabled',
      'faa_notam_detail_limit',
      'faa_notam_detail_refresh_hours',
      'faa_tfr_notam_text_url',
      'faa_tfr_web_text_url'
    ]);

    const enabled = readBooleanSetting(settings.faa_notam_detail_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const limit = clampInt(readNumberSetting(settings.faa_notam_detail_limit, DEFAULTS.limit), 10, 600);
    const refreshHours = clampInt(readNumberSetting(settings.faa_notam_detail_refresh_hours, DEFAULTS.refreshHours), 1, 168);
    const notamTextUrl =
      readStringSetting(settings.faa_tfr_notam_text_url, DEFAULTS.notamTextUrl).trim() || DEFAULTS.notamTextUrl;
    const webTextUrl = readStringSetting(settings.faa_tfr_web_text_url, DEFAULTS.webTextUrl).trim() || DEFAULTS.webTextUrl;

    const { data: records, error: recordsError } = await supabase
      .from('faa_tfr_records')
      .select('id, notam_id, mod_at, updated_at, status')
      .eq('status', 'active')
      .not('notam_id', 'is', null)
      .order('mod_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(Math.max(limit * 5, 200));

    if (recordsError) throw recordsError;

    const recordRows = (records || []) as TfrRecordRow[];
    stats.recordsScanned = recordRows.length;

    const candidatesByNotam = new Map<string, Candidate>();
    for (const row of recordRows) {
      const notamId = parseNotamId(row.notam_id);
      if (!notamId) continue;

      const existing = candidatesByNotam.get(notamId);
      const rowModAt = normalizeNonEmptyString(row.mod_at) || normalizeNonEmptyString(row.updated_at);
      if (!existing) {
        candidatesByNotam.set(notamId, {
          recordId: row.id,
          notamId,
          modAt: rowModAt
        });
        continue;
      }

      const existingMs = existing.modAt ? Date.parse(existing.modAt) : NaN;
      const incomingMs = rowModAt ? Date.parse(rowModAt) : NaN;
      if (!Number.isFinite(existingMs) || (Number.isFinite(incomingMs) && incomingMs > existingMs)) {
        candidatesByNotam.set(notamId, {
          recordId: row.id,
          notamId,
          modAt: rowModAt
        });
      }
    }

    const candidateIds = Array.from(candidatesByNotam.keys());
    stats.uniqueNotamIds = candidateIds.length;

    let latestDetailByNotam = new Map<string, ExistingDetailRow>();
    if (candidateIds.length > 0) {
      const { data: details, error: detailsError } = await supabase
        .from('faa_notam_details')
        .select('notam_id, fetched_at')
        .in('notam_id', candidateIds)
        .order('fetched_at', { ascending: false });
      if (detailsError) throw detailsError;

      const rows = (details || []) as ExistingDetailRow[];
      latestDetailByNotam = new Map<string, ExistingDetailRow>();
      for (const row of rows) {
        const notamId = parseNotamId(row.notam_id);
        if (!notamId || latestDetailByNotam.has(notamId)) continue;
        latestDetailByNotam.set(notamId, row);
      }
    }

    const queue: Candidate[] = [];
    const nowMs = Date.now();
    for (const candidate of candidatesByNotam.values()) {
      const latest = latestDetailByNotam.get(candidate.notamId);
      if (latest?.fetched_at) {
        const fetchedMs = Date.parse(latest.fetched_at);
        if (Number.isFinite(fetchedMs)) {
          const ageHours = (nowMs - fetchedMs) / (60 * 60 * 1000);
          if (ageHours < refreshHours) {
            const candidateModMs = candidate.modAt ? Date.parse(candidate.modAt) : NaN;
            if (!Number.isFinite(candidateModMs) || candidateModMs <= fetchedMs) {
              stats.skippedRecentlyFetched = Number(stats.skippedRecentlyFetched || 0) + 1;
              continue;
            }
          }
        }
      }

      queue.push(candidate);
      if (queue.length >= limit) break;
    }

    stats.queueSize = queue.length;

    for (const candidate of queue) {
      try {
        const [notamPayload, webPayload] = await Promise.all([
          fetchJson(`${notamTextUrl}?notamId=${encodeURIComponent(candidate.notamId)}`),
          fetchJson(`${webTextUrl}?notamId=${encodeURIComponent(candidate.notamId)}`)
        ]);

        stats.fetched = Number(stats.fetched || 0) + 1;

        const notamText = extractTextPayload(notamPayload);
        const webText = extractTextPayload(webPayload);
        if (!notamText && !webText) {
          stats.emptyPayloads = Number(stats.emptyPayloads || 0) + 1;
          continue;
        }

        const contentHash = await sha256Hex(
          `${candidate.notamId}\n---\n${normalizeNonEmptyString(notamText) || ''}\n---\n${normalizeNonEmptyString(webText) || ''}`
        );

        const parseWindow = parseDateWindowFromText(stripHtmlToText(`${webText || ''}\n${notamText || ''}`));
        if (parseWindow.validStart || parseWindow.validEnd) {
          stats.parseWindowFound = Number(stats.parseWindowFound || 0) + 1;
        }

        const nowIso = new Date().toISOString();
        const { data: insertedRows, error: insertError } = await supabase
          .from('faa_notam_details')
          .upsert(
            {
              notam_id: candidate.notamId,
              faa_tfr_record_id: candidate.recordId,
              source: 'faa_tfr',
              source_url: buildNotamSourceUrl(candidate.notamId),
              web_text: normalizeNonEmptyString(webText),
              notam_text: normalizeNonEmptyString(notamText),
              parsed: {
                dateWindow: parseWindow,
                fetchedAt: nowIso
              },
              raw: {
                webPayload,
                notamPayload
              },
              content_hash: contentHash,
              parse_version: 'v1',
              fetched_at: nowIso,
              updated_at: nowIso
            },
            {
              onConflict: 'notam_id,content_hash',
              ignoreDuplicates: true
            }
          )
          .select('id');

        if (insertError) throw insertError;

        const insertedCount = (insertedRows || []).length;
        stats.inserted = Number(stats.inserted || 0) + insertedCount;
        if (insertedCount === 0) {
          stats.duplicatePayloads = Number(stats.duplicatePayloads || 0) + 1;
        }
      } catch (err) {
        (stats.errors as Array<any>).push({
          step: 'fetch_or_insert',
          notamId: candidate.notamId,
          error: stringifyError(err)
        });
      }
    }

    await upsertSetting(supabase, 'faa_notam_detail_last_success_at', new Date().toISOString());
    await upsertSetting(supabase, 'faa_notam_detail_last_error', '');

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');

    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await upsertSetting(supabase, 'faa_notam_detail_last_error', message);
    await finishIngestionRun(supabase, runId, false, stats, message);

    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

function extractTextPayload(payload: unknown): string | null {
  const out = normalizeTextNode(payload);
  return normalizeNonEmptyString(out);
}

function normalizeTextNode(node: unknown): string {
  if (typeof node === 'string') {
    return node.trim();
  }

  if (Array.isArray(node)) {
    return node
      .map((entry) => normalizeTextNode(entry))
      .filter((entry) => entry.length > 0)
      .join('\n\n')
      .trim();
  }

  if (!node || typeof node !== 'object') {
    return '';
  }

  const obj = node as Record<string, unknown>;
  const directKeys = ['text', 'notamText', 'webText', 'value', 'content', 'message'];
  for (const key of directKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const nestedKeys = ['data', 'results', 'items', 'rows', 'payload'];
  for (const key of nestedKeys) {
    const value = obj[key];
    const normalized = normalizeTextNode(value);
    if (normalized) return normalized;
  }

  const flattened = Object.values(obj)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  if (flattened) return flattened;

  try {
    return JSON.stringify(obj);
  } catch {
    return '';
  }
}

function stripHtmlToText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': FAA_USER_AGENT,
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`fetch_${response.status}_${url}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

async function sha256Hex(value: string) {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function upsertSetting(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}
