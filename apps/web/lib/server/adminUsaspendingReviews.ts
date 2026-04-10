import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import {
  ADMIN_USASPENDING_REVIEW_TIERS,
  ADMIN_USASPENDING_SCOPES,
  createEmptyAdminUsaspendingReviewCounts,
  type AdminUsaspendingAwardFamily,
  type AdminUsaspendingReviewCounts,
  type AdminUsaspendingReviewRow,
  type AdminUsaspendingReviewTier,
  type AdminUsaspendingReviewsResponse,
  type AdminUsaspendingScope
} from '@/lib/types/adminUsaspending';
import {
  normalizeProgramScope,
  type ProgramScope,
  type ProgramUsaspendingAuditTier,
  type ProgramUsaspendingReviewStatus
} from '@/lib/usaspending/hubAudit';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type AuditedAwardReviewRow = {
  award_identity_key: string | null;
  program_scope: string | null;
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  metadata: Record<string, unknown> | null;
  auto_tier: string | null;
  final_tier: string | null;
  scope_tier: string | null;
  review_status: string | null;
  reason_codes: string[] | null;
  signal_snapshot: Record<string, unknown> | null;
  live_source_snapshot: Record<string, unknown> | null;
  audit_version: string | null;
  review_notes?: string | null;
  updated_at: string | null;
};

type ReviewNotesRow = {
  award_identity_key: string | null;
  review_notes: string | null;
};

type PromoteReviewRow = {
  award_identity_key: string;
  program_scope: string;
  final_tier: string | null;
  review_status: string | null;
  updated_at: string | null;
};

const LIST_SELECT = [
  'award_identity_key',
  'program_scope',
  'usaspending_award_id',
  'award_title',
  'recipient',
  'obligated_amount',
  'awarded_on',
  'mission_key',
  'metadata',
  'auto_tier',
  'final_tier',
  'scope_tier',
  'review_status',
  'reason_codes',
  'signal_snapshot',
  'live_source_snapshot',
  'audit_version',
  'updated_at'
].join(',');

const COUNT_SELECT = 'award_identity_key';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

export async function listAdminUsaspendingReviews(
  admin: SupabaseAdminClient,
  input: {
    scope: AdminUsaspendingScope;
    tier: AdminUsaspendingReviewTier;
    offset?: number;
    limit?: number;
    query?: string;
  }
): Promise<AdminUsaspendingReviewsResponse> {
  const scope = input.scope;
  const tier = input.tier;
  const offset = clampInt(input.offset, 0, 0, 100_000);
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const query = sanitizeReviewQuery(input.query);

  const countsPromise = fetchAdminUsaspendingReviewCounts(admin);

  let request = admin
    .from('program_usaspending_audited_awards')
    .select(LIST_SELECT, { count: 'exact' })
    .eq('program_scope', scope)
    .eq('scope_tier', tier)
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('usaspending_award_id', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (query) {
    const pattern = buildIlikePattern(query);
    request = request.or(
      [
        `usaspending_award_id.ilike.${pattern}`,
        `award_title.ilike.${pattern}`,
        `recipient.ilike.${pattern}`,
        `mission_key.ilike.${pattern}`
      ].join(',')
    );
  }

  const [{ data, error, count }, counts] = await Promise.all([request, countsPromise]);

  if (error) throw error;

  const rows = readAuditedAwardRows(data);
  const reviewNotesByAwardIdentityKey = await fetchReviewNotes(admin, {
    scope,
    awardIdentityKeys: rows
      .map((row) => asString(row.award_identity_key))
      .filter((value): value is string => Boolean(value))
  });

  return {
    scope,
    tier,
    total: count ?? 0,
    offset,
    limit,
    query,
    counts,
    items: rows.map((row) =>
      mapAuditedAwardReviewRow({
        ...row,
        review_notes: reviewNotesByAwardIdentityKey.get(asString(row.award_identity_key) || '') ?? null
      })
    )
  };
}

export async function promoteAdminUsaspendingReview(
  admin: SupabaseAdminClient,
  input: {
    awardIdentityKey: string;
    programScope: AdminUsaspendingScope;
  }
) {
  const updatedAt = new Date().toISOString();
  const { data, error } = await admin
    .from('program_usaspending_scope_reviews')
    .update({
      final_tier: 'exact',
      review_status: 'confirmed',
      updated_at: updatedAt
    })
    .eq('award_identity_key', input.awardIdentityKey)
    .eq('program_scope', input.programScope)
    .select('award_identity_key,program_scope,final_tier,review_status,updated_at')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as PromoteReviewRow;
  return {
    awardIdentityKey: row.award_identity_key,
    programScope: input.programScope,
    finalTier: 'exact' as const,
    reviewStatus: 'confirmed' as const,
    updatedAt: asString(row.updated_at) || updatedAt
  };
}

async function fetchAdminUsaspendingReviewCounts(admin: SupabaseAdminClient): Promise<AdminUsaspendingReviewCounts> {
  const counts = createEmptyAdminUsaspendingReviewCounts();

  const queries = ADMIN_USASPENDING_SCOPES.flatMap((scope) =>
    ADMIN_USASPENDING_REVIEW_TIERS.map(async (tier) => {
      const { count, error } = await admin
        .from('program_usaspending_audited_awards')
        .select(COUNT_SELECT, { count: 'exact', head: true })
        .eq('program_scope', scope)
        .eq('scope_tier', tier);

      if (error) throw error;
      counts[scope][tier] = count ?? 0;
    })
  );

  await Promise.all(queries);
  return counts;
}

async function fetchReviewNotes(
  admin: SupabaseAdminClient,
  {
    scope,
    awardIdentityKeys
  }: {
    scope: AdminUsaspendingScope;
    awardIdentityKeys: string[];
  }
) {
  const normalizedAwardIdentityKeys = Array.from(new Set(awardIdentityKeys.map((value) => value.trim()).filter(Boolean)));
  if (!normalizedAwardIdentityKeys.length) {
    return new Map<string, string | null>();
  }

  const { data, error } = await admin
    .from('program_usaspending_scope_reviews')
    .select('award_identity_key,review_notes')
    .eq('program_scope', scope)
    .in('award_identity_key', normalizedAwardIdentityKeys);

  if (error) throw error;

  return new Map(
    ((Array.isArray(data) ? data : []) as ReviewNotesRow[])
      .map((row) => [asString(row.award_identity_key) || '', asString(row.review_notes)] as const)
      .filter(([awardIdentityKey]) => Boolean(awardIdentityKey))
  );
}

function mapAuditedAwardReviewRow(row: AuditedAwardReviewRow): AdminUsaspendingReviewRow {
  const metadata = asRecord(row.metadata);
  const signalSnapshot = asRecord(row.signal_snapshot);
  const liveSourceSnapshot = asRecord(row.live_source_snapshot);
  const programScope = normalizeProgramScope(row.program_scope) || 'blue-origin';
  const declaredScopes = readDeclaredScopes(signalSnapshot);
  const score = asFiniteNumber(signalSnapshot?.score);

  return {
    awardIdentityKey: asString(row.award_identity_key) || '',
    programScope,
    awardId: asString(row.usaspending_award_id),
    title: asString(row.award_title),
    recipient: asString(row.recipient),
    obligatedAmount: asFiniteNumber(row.obligated_amount),
    awardedOn: normalizeDate(asString(row.awarded_on)),
    missionKey: asString(row.mission_key),
    awardFamily: resolveAwardFamily(metadata),
    sourceUrl: resolveUsaspendingAwardSourceUrl({
      awardId: asString(row.usaspending_award_id),
      awardPageUrl: asString(metadata.awardPageUrl),
      awardApiUrl: asString(metadata.awardApiUrl),
      sourceUrl: asString(metadata.sourceUrl)
    }),
    sourceTitle: asString(metadata.sourceTitle) || 'USASpending award record',
    autoTier: normalizeAuditTier(row.auto_tier) || 'excluded',
    finalTier: normalizeAuditTier(row.final_tier),
    effectiveTier: normalizeAuditTier(row.scope_tier) || 'excluded',
    reviewStatus: normalizeReviewStatus(row.review_status) || 'unreviewed',
    reasonCodes: asStringArray(row.reason_codes),
    signals: asStringArray(signalSnapshot?.signals),
    score,
    canonicalRecipientMatch:
      typeof signalSnapshot?.canonicalRecipientMatch === 'boolean'
        ? signalSnapshot.canonicalRecipientMatch
        : null,
    storyLinked:
      typeof signalSnapshot?.storyLinked === 'boolean' ? signalSnapshot.storyLinked : null,
    declaredScopes,
    liveRecipientName: asString(liveSourceSnapshot?.recipientName),
    liveParentRecipientName: asString(liveSourceSnapshot?.parentRecipientName),
    auditVersion: asString(row.audit_version),
    reviewNotes: asString(row.review_notes),
    updatedAt: asString(row.updated_at),
    metadata,
    signalSnapshot,
    liveSourceSnapshot
  };
}

function readAuditedAwardRows(value: unknown) {
  return Array.isArray(value) ? (value as unknown as AuditedAwardReviewRow[]) : [];
}

function resolveAwardFamily(metadata: Record<string, unknown>): AdminUsaspendingAwardFamily {
  const direct = normalizeAwardFamily(asString(metadata.awardFamily) || asString(metadata.award_family));
  if (direct) return direct;

  const familyValues = [
    asString(metadata.awardFamilies),
    asString(metadata.award_families),
    asString(metadata.primeAwardType),
    asString(metadata.prime_award_type),
    asString(metadata.awardType),
    asString(metadata.award_type)
  ].filter((value): value is string => Boolean(value));

  for (const value of familyValues) {
    const normalized = normalizeAwardFamily(value);
    if (normalized) return normalized;
  }

  return 'unknown';
}

function normalizeAwardFamily(value: string | null): AdminUsaspendingAwardFamily | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'contracts' || normalized === 'contract') return 'contracts';
  if (normalized === 'idvs' || normalized === 'idv') return 'idvs';
  if (normalized === 'grants' || normalized === 'grant') return 'grants';
  if (normalized === 'loans' || normalized === 'loan') return 'loans';
  if (
    normalized === 'direct_payments' ||
    normalized === 'direct payments' ||
    normalized === 'direct payment'
  ) {
    return 'direct_payments';
  }
  if (
    normalized === 'other_financial_assistance' ||
    normalized === 'other financial assistance'
  ) {
    return 'other_financial_assistance';
  }

  return null;
}

function normalizeAuditTier(value: string | null): ProgramUsaspendingAuditTier | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'exact' || normalized === 'candidate' || normalized === 'excluded') {
    return normalized;
  }
  return null;
}

function normalizeReviewStatus(value: string | null): ProgramUsaspendingReviewStatus | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'unreviewed' || normalized === 'confirmed' || normalized === 'suppressed') {
    return normalized;
  }
  return null;
}

function readDeclaredScopes(snapshot: Record<string, unknown> | null): ProgramScope[] {
  const values = Array.isArray(snapshot?.declaredScopes) ? snapshot.declaredScopes : [];
  const scopes = values
    .map((value) => normalizeProgramScope(value))
    .filter((value): value is ProgramScope => Boolean(value));
  return [...new Set(scopes)];
}

function sanitizeReviewQuery(value: string | null | undefined) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\w \-]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function buildIlikePattern(value: string) {
  return `%${value}%`;
}

function clampInt(value: number | string | null | undefined, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function asString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => asString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function asFiniteNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
