import type { Launch } from '@/lib/types/launch';

type LaunchStatus = Launch['status'];

const STATUS_VALUES: LaunchStatus[] = ['go', 'hold', 'scrubbed', 'tbd', 'unknown'];

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function toPostgrestValue(value: string) {
  const simpleToken = /^[A-Za-z0-9_.:-]+$/.test(value);
  if (simpleToken) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function detectStatusFromCombinedText(value: string): LaunchStatus | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized.includes('partial failure') ||
    normalized.includes('failure') ||
    normalized.includes('scrub')
  ) {
    return 'scrubbed';
  }
  if (normalized.includes('hold')) return 'hold';
  if (
    normalized.includes('tbd') ||
    normalized.includes('tbc') ||
    normalized.includes('to be determined') ||
    normalized.includes('to be confirmed')
  ) {
    return 'tbd';
  }
  if (
    normalized.includes('go') ||
    normalized.includes('success') ||
    normalized.includes('in flight') ||
    normalized.includes('in-flight')
  ) {
    return 'go';
  }
  if (normalized.includes('unknown')) return 'unknown';
  return null;
}

export function parseLaunchStatusFilter(value: unknown): LaunchStatus | null {
  const normalized = normalizeText(value);
  if (!normalized || normalized === 'all') return null;
  if (STATUS_VALUES.includes(normalized as LaunchStatus)) {
    return normalized as LaunchStatus;
  }
  return detectStatusFromCombinedText(normalized);
}

export function resolveLaunchStatus(statusName: unknown, statusAbbrev: unknown): LaunchStatus {
  const combined = [statusAbbrev, statusName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return detectStatusFromCombinedText(combined) || 'unknown';
}

export function buildStatusFilterOrClause(status: unknown, prefix = '') {
  const normalized = parseLaunchStatusFilter(status);
  if (!normalized) return '';
  const column = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const clauses = new Set<string>();
  const addEq = (name: string, value: string) => clauses.add(`${column(name)}.eq.${toPostgrestValue(value)}`);
  const addILike = (name: string, value: string) => clauses.add(`${column(name)}.ilike.${toPostgrestValue(value)}`);
  const addIs = (name: string, value: 'null' | 'not.null') => clauses.add(`${column(name)}.is.${value}`);

  if (normalized === 'go') {
    addEq('status_name', 'go');
    addILike('status_name', '%go%');
    addILike('status_name', '%success%');
    addILike('status_abbrev', '%go%');
    addILike('status_abbrev', '%success%');
    addILike('status_abbrev', '%in flight%');
    addILike('status_abbrev', '%in-flight%');
  } else if (normalized === 'hold') {
    addEq('status_name', 'hold');
    addILike('status_name', '%hold%');
    addILike('status_abbrev', '%hold%');
  } else if (normalized === 'scrubbed') {
    addEq('status_name', 'scrubbed');
    addILike('status_name', '%scrub%');
    addILike('status_name', '%failure%');
    addILike('status_abbrev', '%scrub%');
    addILike('status_abbrev', '%failure%');
  } else if (normalized === 'tbd') {
    addEq('status_name', 'tbd');
    addILike('status_name', '%tbd%');
    addILike('status_name', '%tbc%');
    addILike('status_abbrev', '%tbd%');
    addILike('status_abbrev', '%tbc%');
    addILike('status_abbrev', '%to be determined%');
    addILike('status_abbrev', '%to be confirmed%');
  } else {
    addEq('status_name', 'unknown');
    addILike('status_name', '%unknown%');
    addILike('status_abbrev', '%unknown%');
    addIs('status_name', 'null');
  }

  return Array.from(clauses).join(',');
}
