import { NextResponse } from 'next/server';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { requireAdminRequest } from '../../../_lib/auth';

export const dynamic = 'force-dynamic';

type ContractRow = {
  id: number;
  launch_id: string;
  product_version: string;
  contract_version: string;
  confidence_tier: 'A' | 'B' | 'C' | 'D';
  status: 'pass' | 'fail';
  source_sufficiency: unknown;
  required_fields: unknown;
  missing_fields: string[];
  blocking_reasons: string[];
  freshness_state: 'fresh' | 'stale' | 'unknown';
  lineage_complete: boolean;
  evaluated_at: string;
  ingestion_run_id: number | null;
  created_at: string;
  updated_at: string;
};

type LineageRow = {
  source_ref_id: string;
  source: string;
  source_id: string | null;
  source_kind: string | null;
  source_url: string | null;
  confidence: number | null;
  fetched_at: string | null;
  generated_at: string;
  extracted_field_map: unknown;
};

type FieldDiagnostic = {
  field: string;
  pass: boolean;
  missing: boolean;
  sufficiency: boolean | null;
  reason: 'ok' | 'missing_field' | 'source_sufficiency_fail';
};

const SUFFICIENCY_BOOL_KEYS = ['pass', 'ok', 'available', 'present', 'sufficient', 'met', 'complete'] as const;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeFieldPath(path: string): string {
  return path
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function flattenRequiredFieldPaths(value: unknown): string[] {
  const out = new Set<string>();

  const visit = (node: unknown, prefix: string) => {
    if (typeof node === 'boolean') {
      if (node && prefix) out.add(prefix);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
        visit(item, next);
      });
      return;
    }

    const obj = asObject(node);
    if (!obj) return;

    if (typeof obj.required === 'boolean' && obj.required && prefix) {
      out.add(prefix);
    }

    for (const [key, child] of Object.entries(obj)) {
      if (key === 'required') continue;
      const next = prefix ? `${prefix}.${key}` : key;
      visit(child, next);
    }
  };

  visit(value, '');
  return Array.from(out);
}

function collectSufficiencySignals(value: unknown): Array<{ path: string; pass: boolean }> {
  const out = new Map<string, boolean>();

  const mergeSignal = (path: string, pass: boolean) => {
    const prev = out.get(path);
    if (prev == null) {
      out.set(path, pass);
      return;
    }
    out.set(path, prev && pass);
  };

  const visit = (node: unknown, prefix: string) => {
    if (typeof node === 'boolean') {
      if (prefix) mergeSignal(prefix, node);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
        visit(item, next);
      });
      return;
    }

    const obj = asObject(node);
    if (!obj) return;

    const boolValues = SUFFICIENCY_BOOL_KEYS
      .map((key) => (typeof obj[key] === 'boolean' ? (obj[key] as boolean) : null))
      .filter((value): value is boolean => value != null);

    if (prefix && boolValues.length) {
      mergeSignal(prefix, boolValues.every(Boolean));
    }

    for (const [key, child] of Object.entries(obj)) {
      if (SUFFICIENCY_BOOL_KEYS.includes(key as (typeof SUFFICIENCY_BOOL_KEYS)[number])) continue;
      const next = prefix ? `${prefix}.${key}` : key;
      visit(child, next);
    }
  };

  visit(value, '');
  return Array.from(out.entries()).map(([path, pass]) => ({ path, pass }));
}

function flattenExtractedFieldPaths(value: unknown): string[] {
  const out = new Set<string>();

  const visit = (node: unknown, prefix: string) => {
    if (node == null) return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
        visit(item, next);
      });
      return;
    }

    const obj = asObject(node);
    if (obj) {
      for (const [key, child] of Object.entries(obj)) {
        const next = prefix ? `${prefix}.${key}` : key;
        visit(child, next);
      }
      return;
    }

    if (prefix) out.add(prefix);
  };

  visit(value, '');
  return Array.from(out);
}

function fieldMatchesExtractedPaths(normalizedField: string, extracted: Set<string>): boolean {
  if (!normalizedField) return false;
  if (extracted.has(normalizedField)) return true;

  for (const path of extracted) {
    if (path.endsWith(`.${normalizedField}`)) return true;
    if (normalizedField.endsWith(`.${path}`)) return true;
  }

  const tail = normalizedField.split('.').filter(Boolean).pop();
  if (!tail) return false;
  for (const path of extracted) {
    if (path === tail || path.endsWith(`.${tail}`)) return true;
  }

  return false;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.context;

  const { data: contract, error: contractError } = await supabase
    .from('trajectory_source_contracts')
    .select(
      'id, launch_id, product_version, contract_version, confidence_tier, status, source_sufficiency, required_fields, missing_fields, blocking_reasons, freshness_state, lineage_complete, evaluated_at, ingestion_run_id, created_at, updated_at'
    )
    .eq('launch_id', parsed.launchId)
    .order('evaluated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contractError) {
    console.error('trajectory contract fetch failed', contractError);
    return NextResponse.json({ error: 'contract_fetch_failed' }, { status: 500 });
  }

  if (!contract) {
    return NextResponse.json({ error: 'contract_not_found' }, { status: 404 });
  }

  const { data: lineageRows, error: lineageError } = await supabase
    .from('trajectory_product_lineage')
    .select(
      'source_ref_id, source, source_id, source_kind, source_url, confidence, fetched_at, generated_at, extracted_field_map'
    )
    .eq('launch_id', parsed.launchId)
    .eq('product_version', contract.product_version)
    .lte('generated_at', contract.evaluated_at)
    .order('generated_at', { ascending: false })
    .limit(200);

  if (lineageError) {
    console.error('trajectory lineage fetch failed', lineageError);
    return NextResponse.json({ error: 'lineage_fetch_failed' }, { status: 500 });
  }

  const contractRow = contract as ContractRow;
  const lineage = ((lineageRows ?? []) as LineageRow[]).map((row) => ({
    row,
    extractedFieldPaths: new Set(flattenExtractedFieldPaths(row.extracted_field_map).map((path) => normalizeFieldPath(path)).filter(Boolean))
  }));

  const requiredRaw = flattenRequiredFieldPaths(contractRow.required_fields);
  const missingRaw = Array.isArray(contractRow.missing_fields)
    ? contractRow.missing_fields.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const sufficiencySignalsRaw = collectSufficiencySignals(contractRow.source_sufficiency);

  const displayByNorm = new Map<string, string>();
  const requiredNorm = new Set<string>();
  const missingNorm = new Set<string>();
  const sufficiencyByNorm = new Map<string, boolean>();

  for (const field of requiredRaw) {
    const normalized = normalizeFieldPath(field);
    if (!normalized) continue;
    requiredNorm.add(normalized);
    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, field);
  }

  for (const field of missingRaw) {
    const normalized = normalizeFieldPath(field);
    if (!normalized) continue;
    missingNorm.add(normalized);
    requiredNorm.add(normalized);
    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, field);
  }

  for (const signal of sufficiencySignalsRaw) {
    const normalized = normalizeFieldPath(signal.path);
    if (!normalized) continue;
    const prev = sufficiencyByNorm.get(normalized);
    const next = prev == null ? signal.pass : prev && signal.pass;
    sufficiencyByNorm.set(normalized, next);
    if (!displayByNorm.has(normalized)) displayByNorm.set(normalized, signal.path);
    if (!next) requiredNorm.add(normalized);
  }

  const allFieldNorm = Array.from(requiredNorm).sort((a, b) => {
    const left = displayByNorm.get(a) ?? a;
    const right = displayByNorm.get(b) ?? b;
    return left.localeCompare(right);
  });

  const fieldDiagnostics: FieldDiagnostic[] = allFieldNorm.map((fieldNorm) => {
    const missing = missingNorm.has(fieldNorm);
    const sufficiency = sufficiencyByNorm.get(fieldNorm);
    const pass = !missing && sufficiency !== false;

    return {
      field: displayByNorm.get(fieldNorm) ?? fieldNorm,
      pass,
      missing,
      sufficiency: sufficiency ?? null,
      reason: missing ? 'missing_field' : sufficiency === false ? 'source_sufficiency_fail' : 'ok'
    };
  });

  const failingFieldNorm = allFieldNorm.filter((fieldNorm) => {
    const missing = missingNorm.has(fieldNorm);
    const sufficiency = sufficiencyByNorm.get(fieldNorm);
    return missing || sufficiency === false;
  });

  const missingSourceDetails = failingFieldNorm.map((fieldNorm) => {
    const matchingLineage = lineage.filter((entry) => fieldMatchesExtractedPaths(fieldNorm, entry.extractedFieldPaths));

    const sourceRefIds = Array.from(
      new Set(
        matchingLineage
          .map((entry) => entry.row.source_ref_id)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    ).slice(0, 8);

    const sourceHints = Array.from(
      new Set(
        matchingLineage
          .map((entry) => {
            const source = typeof entry.row.source === 'string' ? entry.row.source.trim() : '';
            const sourceId = typeof entry.row.source_id === 'string' ? entry.row.source_id.trim() : '';
            if (source && sourceId) return `${source}:${sourceId}`;
            return source || sourceId;
          })
          .filter((value) => value.length > 0)
      )
    ).slice(0, 8);

    const sourceUrls = Array.from(
      new Set(
        matchingLineage
          .map((entry) => entry.row.source_url)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    ).slice(0, 4);

    return {
      field: displayByNorm.get(fieldNorm) ?? fieldNorm,
      sourceRefIds,
      sourceHints,
      sourceUrls,
      detail: sourceRefIds.length > 0 ? 'candidate_sources_found' : 'no_candidate_sources_found'
    };
  });

  const passCount = fieldDiagnostics.filter((field) => field.pass).length;
  const failCount = fieldDiagnostics.length - passCount;

  return NextResponse.json(
    {
      launchId: parsed.launchId,
      generatedAt: new Date().toISOString(),
      contract: {
        id: contractRow.id,
        launchId: contractRow.launch_id,
        productVersion: contractRow.product_version,
        contractVersion: contractRow.contract_version,
        confidenceTier: contractRow.confidence_tier,
        status: contractRow.status,
        sourceSufficiency: contractRow.source_sufficiency,
        requiredFields: contractRow.required_fields,
        missingFields: missingRaw,
        blockingReasons: Array.isArray(contractRow.blocking_reasons) ? contractRow.blocking_reasons : [],
        freshnessState: contractRow.freshness_state,
        lineageComplete: Boolean(contractRow.lineage_complete),
        evaluatedAt: contractRow.evaluated_at,
        ingestionRunId: contractRow.ingestion_run_id,
        createdAt: contractRow.created_at,
        updatedAt: contractRow.updated_at
      },
      diagnostics: {
        summary: {
          status: contractRow.status,
          confidenceTier: contractRow.confidence_tier,
          freshnessState: contractRow.freshness_state,
          lineageComplete: Boolean(contractRow.lineage_complete),
          requiredFieldCount: fieldDiagnostics.length,
          passCount,
          failCount,
          missingFieldCount: missingRaw.length,
          blockingReasonCount: Array.isArray(contractRow.blocking_reasons) ? contractRow.blocking_reasons.length : 0
        },
        fields: fieldDiagnostics,
        missingSources: missingSourceDetails
      },
      lineage: {
        sourceCount: lineage.length,
        sourceRefIds: Array.from(
          new Set(
            lineage
              .map((entry) => entry.row.source_ref_id)
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          )
        ).slice(0, 40),
        latestGeneratedAt: lineage.length ? lineage[0].row.generated_at : null
      }
    },
    {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    }
  );
}
