import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsaspendingAwardIdentityKey,
  classifyUsaspendingAwardForScope,
  normalizeProgramScope,
  readProgramScopes,
  type ProgramScope,
  type ProgramUsaspendingAuditTier,
  type ProgramUsaspendingReviewStatus,
  type UsaSpendingRecipientSnapshot
} from '@/lib/usaspending/hubAudit';

config({ path: '.env.local' });
config();

type ProcurementAwardRow = {
  id: string;
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  source_document_id: string | null;
  program_scope: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ReviewRow = {
  award_identity_key: string;
  usaspending_award_id: string | null;
  program_scope: ProgramScope;
  auto_tier: ProgramUsaspendingAuditTier;
  final_tier: ProgramUsaspendingAuditTier | null;
  review_status: ProgramUsaspendingReviewStatus;
  reason_codes: string[] | null;
  signal_snapshot: Record<string, unknown> | null;
  live_source_snapshot: Record<string, unknown> | null;
  audit_version: string | null;
  review_notes: string | null;
  updated_at: string | null;
};

type StoryLinkRow = {
  primary_usaspending_award_id: string | null;
};

type BlueOriginContractRow = {
  contract_key: string | null;
  title: string | null;
  customer: string | null;
  awarded_on: string | null;
};

type AuditRecord = {
  awardIdentityKey: string;
  usaspendingAwardId: string | null;
  programScope: ProgramScope;
  rawProgramScope: ProgramScope | null;
  declaredScopes: ProgramScope[];
  currentScopeClaimed: boolean;
  title: string | null;
  recipient: string | null;
  awardedOn: string | null;
  obligatedAmount: number | null;
  missionKey: string | null;
  tier: ProgramUsaspendingAuditTier;
  reasonCodes: string[];
  signals: string[];
  score: number;
  canonicalRecipientMatch: boolean;
  storyLinked: boolean;
  sourceUrl: string | null;
  liveRecipientName: string | null;
  liveParentRecipientName: string | null;
  existingAutoTier: ProgramUsaspendingAuditTier | null;
  existingFinalTier: ProgramUsaspendingAuditTier | null;
  existingReviewStatus: ProgramUsaspendingReviewStatus | null;
  existingReviewNotes: string | null;
  updatedAt: string | null;
};

type Args = {
  mode: 'report' | 'write';
  scope: 'all' | ProgramScope;
  liveVerify: 'none' | 'flagged' | 'all';
  output: string;
};

const AUDIT_VERSION = 'usaspending-hub-audit-v1';
const RAW_BATCH_SIZE = 1000;
const REVIEW_BATCH_SIZE = 500;
const LIVE_VERIFY_CONCURRENCY = 4;

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'report' },
    scope: { type: 'string', default: 'all' },
    'live-verify': { type: 'string', default: 'flagged' },
    output: { type: 'string', default: 'tmp/usaspending-hub-audit' }
  }
});

void main(parseArgsOrThrow(values)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(args: Args) {
  const supabase = createAdminClient();
  const [rows, reviews, storyLinkedAwardIds, blueOriginContracts] =
    await Promise.all([
      fetchAllProcurementRows(supabase),
      fetchExistingReviews(supabase, args.scope),
      fetchStoryLinkedAwardIds(supabase),
      fetchBlueOriginUsaspendingContracts(supabase)
    ]);

  const reviewByKey = new Map<string, ReviewRow>();
  for (const row of reviews) {
    reviewByKey.set(buildScopeReviewKey(row.award_identity_key, row.program_scope), row);
  }

  const rawRecords: AuditRecord[] = [];
  for (const row of rows) {
    const rawProgramScope = normalizeProgramScope(row.program_scope);
    const declaredScopes = readProgramScopes(row.metadata || {}, rawProgramScope);
    const scopes = args.scope === 'all' ? declaredScopes : declaredScopes.filter((value) => value === args.scope);
    if (scopes.length < 1) continue;

    const awardIdentityKey = buildUsaspendingAwardIdentityKey({
      awardId: row.usaspending_award_id,
      title: row.award_title,
      recipient: row.recipient,
      awardedOn: row.awarded_on,
      metadata: row.metadata || {}
    });
    const storyLinked =
      Boolean(row.usaspending_award_id) &&
      storyLinkedAwardIds.has(String(row.usaspending_award_id));

    for (const scope of scopes) {
      rawRecords.push(
        buildAuditRecord({
          row,
          scope,
          declaredScopes,
          rawProgramScope,
          awardIdentityKey,
          storyLinked,
          existing: reviewByKey.get(buildScopeReviewKey(awardIdentityKey, scope)) || null
        })
      );
    }
  }

  const records = await enrichWithLiveVerification(dedupeAuditRecords(rawRecords), args.liveVerify);
  const summary = summarizeAudit(records, blueOriginContracts);

  const outJson = path.resolve(`${args.output}.json`);
  const outCsv = path.resolve(`${args.output}.csv`);
  ensureDir(path.dirname(outJson));
  ensureDir(path.dirname(outCsv));

  const payload = {
    generatedAt: new Date().toISOString(),
    auditVersion: AUDIT_VERSION,
    scope: args.scope,
    liveVerify: args.liveVerify,
    summary,
    records
  };

  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outCsv, serializeCsv(records.filter((record) => record.tier !== 'exact')), 'utf8');

  if (args.mode === 'write') {
    await upsertReviews(supabase, records, reviewByKey);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.mode,
        scope: args.scope,
        outJson,
        outCsv,
        summary
      },
      null,
      2
    )
  );
}

function parseArgsOrThrow(raw: Record<string, string | boolean | undefined>): Args {
  const mode = raw.mode === 'write' ? 'write' : raw.mode === 'report' ? 'report' : null;
  const scope =
    raw.scope === 'all' || normalizeProgramScope(raw.scope) ? (raw.scope === 'all' ? 'all' : normalizeProgramScope(raw.scope)!) : null;
  const liveVerify =
    raw['live-verify'] === 'none' || raw['live-verify'] === 'flagged' || raw['live-verify'] === 'all'
      ? raw['live-verify']
      : null;
  const output = typeof raw.output === 'string' && raw.output.trim().length > 0 ? raw.output.trim() : null;

  if (!mode || !scope || !liveVerify || !output) {
    throw new Error('Invalid args. Expected --mode=report|write --scope=all|artemis|blue-origin|spacex --live-verify=none|flagged|all --output=tmp/path');
  }

  return { mode, scope, liveVerify, output };
}

function createAdminClient() {
  const url = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function fetchAllProcurementRows(supabase: SupabaseClient) {
  const rows: ProcurementAwardRow[] = [];
  let from = 0;

  while (true) {
    const to = from + RAW_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from('artemis_procurement_awards')
      .select(
        'id,usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,program_scope,metadata,updated_at'
      )
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;
    const chunk = (data || []) as ProcurementAwardRow[];
    if (chunk.length < 1) break;
    rows.push(...chunk);
    if (chunk.length < RAW_BATCH_SIZE) break;
    from += chunk.length;
  }

  return rows;
}

async function fetchExistingReviews(
  supabase: SupabaseClient,
  scope: 'all' | ProgramScope
) {
  const rows: ReviewRow[] = [];
  let from = 0;

  while (true) {
    const to = from + RAW_BATCH_SIZE - 1;
    let query = supabase
      .from('program_usaspending_scope_reviews')
      .select(
        'award_identity_key,usaspending_award_id,program_scope,auto_tier,final_tier,review_status,reason_codes,signal_snapshot,live_source_snapshot,audit_version,review_notes,updated_at'
      )
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('award_identity_key', { ascending: true })
      .order('program_scope', { ascending: true })
      .range(from, to);
    if (scope !== 'all') query = query.eq('program_scope', scope);

    const { data, error } = await query;
    if (error) {
      if (String(error.message || '').toLowerCase().includes('program_usaspending_scope_reviews')) {
        return [] as ReviewRow[];
      }
      throw error;
    }

    const chunk = (data || []) as ReviewRow[];
    if (chunk.length < 1) break;
    rows.push(...chunk);
    if (chunk.length < RAW_BATCH_SIZE) break;
    from += chunk.length;
  }

  return rows;
}

async function fetchStoryLinkedAwardIds(supabase: SupabaseClient) {
  const ids = new Set<string>();
  let from = 0;

  while (true) {
    const to = from + RAW_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from('program_contract_story_links')
      .select('primary_usaspending_award_id')
      .eq('program_scope', 'artemis')
      .not('primary_usaspending_award_id', 'is', null)
      .range(from, to);

    if (error) {
      if (String(error.message || '').toLowerCase().includes('program_contract_story_links')) {
        return ids;
      }
      throw error;
    }

    const chunk = (data || []) as StoryLinkRow[];
    if (chunk.length < 1) break;
    for (const row of chunk) {
      if (typeof row.primary_usaspending_award_id === 'string' && row.primary_usaspending_award_id.trim()) {
        ids.add(row.primary_usaspending_award_id.trim());
      }
    }
    if (chunk.length < RAW_BATCH_SIZE) break;
    from += chunk.length;
  }

  return ids;
}

async function fetchBlueOriginUsaspendingContracts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('blue_origin_contracts')
    .select('contract_key,title,customer,awarded_on')
    .like('contract_key', 'USASPENDING-%')
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(5000);

  if (error) {
    if (String(error.message || '').toLowerCase().includes('blue_origin_contracts')) {
      return [] as BlueOriginContractRow[];
    }
    throw error;
  }

  return (data || []) as BlueOriginContractRow[];
}

function buildAuditRecord(input: {
  row: ProcurementAwardRow;
  scope: ProgramScope;
  declaredScopes: ProgramScope[];
  rawProgramScope: ProgramScope | null;
  awardIdentityKey: string;
  storyLinked: boolean;
  existing: ReviewRow | null;
}): AuditRecord {
  const metadata = input.row.metadata || {};
  const classification = classifyUsaspendingAwardForScope(
    {
      awardId: input.row.usaspending_award_id,
      title: input.row.award_title,
      recipient: input.row.recipient,
      awardedOn: input.row.awarded_on,
      metadata,
      storyLinked: input.scope === 'artemis' ? input.storyLinked : false
    },
    input.scope
  );

  return {
    awardIdentityKey: input.awardIdentityKey,
    usaspendingAwardId: input.row.usaspending_award_id,
    programScope: input.scope,
    rawProgramScope: input.rawProgramScope,
    declaredScopes: input.declaredScopes,
    currentScopeClaimed: input.declaredScopes.includes(input.scope),
    title: input.row.award_title,
    recipient: input.row.recipient,
    awardedOn: normalizeDate(input.row.awarded_on),
    obligatedAmount: finiteNumberOrNull(input.row.obligated_amount),
    missionKey: input.row.mission_key,
    tier: classification.tier,
    reasonCodes: classification.reasonCodes,
    signals: classification.signals,
    score: classification.score,
    canonicalRecipientMatch: classification.canonicalRecipientMatch,
    storyLinked: input.scope === 'artemis' ? input.storyLinked : false,
    sourceUrl: resolveSourceUrl(metadata, input.row.usaspending_award_id),
    liveRecipientName: null,
    liveParentRecipientName: null,
    existingAutoTier: input.existing?.auto_tier || null,
    existingFinalTier: input.existing?.final_tier || null,
    existingReviewStatus: input.existing?.review_status || null,
    existingReviewNotes: input.existing?.review_notes || null,
    updatedAt: input.row.updated_at
  };
}

async function enrichWithLiveVerification(records: AuditRecord[], mode: Args['liveVerify']) {
  if (mode === 'none') return records;

  const out = [...records];
  const cache = new Map<string, UsaSpendingRecipientSnapshot | null>();
  const indexes = out
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => shouldLiveVerify(record, mode));

  for (let start = 0; start < indexes.length; start += LIVE_VERIFY_CONCURRENCY) {
    const chunk = indexes.slice(start, start + LIVE_VERIFY_CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async ({ record }) => {
        const awardId = record.usaspendingAwardId;
        if (!awardId) return null;
        if (!cache.has(awardId)) {
          cache.set(awardId, await fetchLiveRecipientSnapshot(awardId));
        }
        return cache.get(awardId) || null;
      })
    );

    chunk.forEach(({ index, record }, chunkIndex) => {
      const liveRecipient = resolved[chunkIndex];
      if (!liveRecipient) return;
      const reclassified = classifyUsaspendingAwardForScope(
        {
          awardId: record.usaspendingAwardId,
          title: record.title,
          recipient: record.recipient,
          awardedOn: record.awardedOn,
          metadata: {},
          liveRecipient,
          storyLinked: record.storyLinked
        },
        record.programScope
      );
      out[index] = {
        ...record,
        tier: reclassified.tier,
        reasonCodes: reclassified.reasonCodes,
        signals: reclassified.signals,
        score: reclassified.score,
        canonicalRecipientMatch: reclassified.canonicalRecipientMatch,
        liveRecipientName: liveRecipient.recipientName || null,
        liveParentRecipientName: liveRecipient.parentRecipientName || null
      };
    });
  }

  return out;
}

function shouldLiveVerify(record: AuditRecord, mode: Args['liveVerify']) {
  if (!record.usaspendingAwardId) return false;
  if (record.programScope === 'artemis') return mode === 'all';
  if (mode === 'all') return true;
  return record.tier !== 'exact';
}

async function fetchLiveRecipientSnapshot(awardId: string) {
  try {
    const response = await fetch(`https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(awardId)}/`, {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      recipient?: {
        recipient_name?: string | null;
        parent_recipient_name?: string | null;
        recipient_uei?: string | null;
        parent_recipient_uei?: string | null;
      };
    };
    return {
      recipientName: sanitizeNullableString(payload.recipient?.recipient_name),
      parentRecipientName: sanitizeNullableString(payload.recipient?.parent_recipient_name),
      recipientUei: sanitizeNullableString(payload.recipient?.recipient_uei),
      parentRecipientUei: sanitizeNullableString(payload.recipient?.parent_recipient_uei)
    } satisfies UsaSpendingRecipientSnapshot;
  } catch {
    return null;
  }
}

function summarizeAudit(records: AuditRecord[], blueOriginContracts: BlueOriginContractRow[]) {
  const byScope = {
    artemis: summarizeScope(records, 'artemis'),
    'blue-origin': summarizeScope(records, 'blue-origin'),
    spacex: summarizeScope(records, 'spacex')
  };

  const blueOriginAwardIds = new Set(
    blueOriginContracts
      .map((row) => parseBlueOriginAwardId(row.contract_key))
      .filter((value): value is string => Boolean(value))
  );
  const mismatchedBlueOriginVisible = records.filter(
    (record) =>
      record.programScope === 'blue-origin' &&
      record.usaspendingAwardId &&
      blueOriginAwardIds.has(record.usaspendingAwardId) &&
      record.tier !== 'exact'
  );

  return {
    totalRecords: records.length,
    byScope,
    blueOriginVisible: {
      totalUsaspendingRows: blueOriginAwardIds.size,
      flagged: mismatchedBlueOriginVisible.length,
      samples: mismatchedBlueOriginVisible.slice(0, 10).map(toSummarySample)
    }
  };
}

function summarizeScope(records: AuditRecord[], scope: ProgramScope) {
  const scoped = records.filter((record) => record.programScope === scope);
  return {
    total: scoped.length,
    exact: scoped.filter((record) => record.tier === 'exact').length,
    candidate: scoped.filter((record) => record.tier === 'candidate').length,
    excluded: scoped.filter((record) => record.tier === 'excluded').length,
    samples: {
      candidate: scoped.filter((record) => record.tier === 'candidate').slice(0, 10).map(toSummarySample),
      excluded: scoped.filter((record) => record.tier === 'excluded').slice(0, 10).map(toSummarySample)
    }
  };
}

function toSummarySample(record: AuditRecord) {
  return {
    awardId: record.usaspendingAwardId,
    title: record.title,
    recipient: record.recipient,
    awardedOn: record.awardedOn,
    tier: record.tier,
    reasonCodes: record.reasonCodes
  };
}

async function upsertReviews(
  supabase: SupabaseClient,
  records: AuditRecord[],
  existingReviews: Map<string, ReviewRow>
) {
  const now = new Date().toISOString();
  const rows = records.map((record) => {
    const existing = existingReviews.get(buildScopeReviewKey(record.awardIdentityKey, record.programScope));
    return {
      award_identity_key: record.awardIdentityKey,
      usaspending_award_id: record.usaspendingAwardId,
      program_scope: record.programScope,
      auto_tier: record.tier,
      final_tier: existing?.final_tier || null,
      review_status: existing?.review_status || 'unreviewed',
      reason_codes: record.reasonCodes,
      signal_snapshot: {
        score: record.score,
        signals: record.signals,
        reasonCodes: record.reasonCodes,
        canonicalRecipientMatch: record.canonicalRecipientMatch,
        storyLinked: record.storyLinked,
        declaredScopes: record.declaredScopes
      },
      live_source_snapshot:
        record.liveRecipientName || record.liveParentRecipientName
          ? {
              recipientName: record.liveRecipientName,
              parentRecipientName: record.liveParentRecipientName
            }
          : {},
      audit_version: AUDIT_VERSION,
      review_notes: existing?.review_notes || null,
      updated_at: now
    };
  });

  for (const chunk of chunkArray(rows, REVIEW_BATCH_SIZE)) {
    const { error } = await supabase
      .from('program_usaspending_scope_reviews')
      .upsert(chunk, { onConflict: 'award_identity_key,program_scope' });
    if (error) throw error;
  }
}

function dedupeAuditRecords(records: AuditRecord[]) {
  const map = new Map<string, AuditRecord>();

  for (const record of records) {
    const key = buildScopeReviewKey(record.awardIdentityKey, record.programScope);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
      continue;
    }

    map.set(key, mergeAuditRecords(existing, record));
  }

  return [...map.values()];
}

function mergeAuditRecords(left: AuditRecord, right: AuditRecord): AuditRecord {
  const preferred = compareAuditRecordPriority(left, right) >= 0 ? left : right;
  const secondary = preferred === left ? right : left;

  return {
    ...secondary,
    ...preferred,
    declaredScopes: uniqueStrings([...left.declaredScopes, ...right.declaredScopes]) as ProgramScope[],
    reasonCodes: uniqueStrings([...left.reasonCodes, ...right.reasonCodes]),
    signals: uniqueStrings([...left.signals, ...right.signals]),
    canonicalRecipientMatch: left.canonicalRecipientMatch || right.canonicalRecipientMatch,
    storyLinked: left.storyLinked || right.storyLinked
  };
}

function compareAuditRecordPriority(left: AuditRecord, right: AuditRecord) {
  const tierDelta = auditTierPriority(left.tier) - auditTierPriority(right.tier);
  if (tierDelta !== 0) return tierDelta;

  const leftUpdated = Date.parse(left.updatedAt || '');
  const rightUpdated = Date.parse(right.updatedAt || '');
  if (Number.isFinite(leftUpdated) && Number.isFinite(rightUpdated) && leftUpdated !== rightUpdated) {
    return leftUpdated - rightUpdated;
  }

  if (left.score !== right.score) return left.score - right.score;
  return left.signals.length - right.signals.length;
}

function auditTierPriority(tier: ProgramUsaspendingAuditTier) {
  if (tier === 'exact') return 3;
  if (tier === 'candidate') return 2;
  return 1;
}

function serializeCsv(records: AuditRecord[]) {
  const headers = [
    'program_scope',
    'tier',
    'award_identity_key',
    'usaspending_award_id',
    'awarded_on',
    'recipient',
    'title',
    'reason_codes',
    'signals',
    'canonical_recipient_match',
    'story_linked',
    'live_recipient_name',
    'live_parent_recipient_name',
    'existing_final_tier',
    'existing_review_status'
  ];
  const lines = [headers.join(',')];

  for (const record of records) {
    lines.push(
      [
        record.programScope,
        record.tier,
        record.awardIdentityKey,
        record.usaspendingAwardId || '',
        record.awardedOn || '',
        record.recipient || '',
        record.title || '',
        record.reasonCodes.join('|'),
        record.signals.join('|'),
        record.canonicalRecipientMatch ? 'true' : 'false',
        record.storyLinked ? 'true' : 'false',
        record.liveRecipientName || '',
        record.liveParentRecipientName || '',
        record.existingFinalTier || '',
        record.existingReviewStatus || ''
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

function parseBlueOriginAwardId(contractKey: string | null) {
  if (!contractKey || !contractKey.startsWith('USASPENDING-')) return null;
  return contractKey.slice('USASPENDING-'.length).trim() || null;
}

function buildScopeReviewKey(awardIdentityKey: string, scope: ProgramScope) {
  return `${awardIdentityKey}|${scope}`;
}

function resolveSourceUrl(metadata: Record<string, unknown> | null | undefined, awardId: string | null) {
  const direct =
    sanitizeNullableString(metadata?.awardPageUrl) ||
    sanitizeNullableString(metadata?.sourceUrl) ||
    sanitizeNullableString(metadata?.awardApiUrl) ||
    null;
  if (direct) return direct;
  return awardId ? `https://www.usaspending.gov/award/${awardId}` : null;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value.slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sanitizeEnvValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function sanitizeNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function csvEscape(value: string) {
  const normalized = value.replace(/"/g, '""');
  return `"${normalized}"`;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function chunkArray<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
