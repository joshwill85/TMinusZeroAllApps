import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  readNumberSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/blueOriginIngest.ts';
import {
  fetchTextWithMeta,
  resolveBlueOriginSourceUrls,
  stripHtml
} from '../_shared/blueOriginSources.ts';
import {
  classifyUsaspendingAwardForScope,
  normalizeProgramScope as normalizeHubAuditProgramScope,
  readProgramScopes as readHubAuditProgramScopes
} from '../../../apps/web/lib/usaspending/hubAudit.ts';
import { requestCanonicalContractsRevalidate } from '../_shared/contractsCacheRefresh.ts';

type ContractSeed = {
  contractKey: string;
  missionKey: 'blue-moon' | 'new-glenn' | 'blue-origin-program';
  title: string;
  agency: string | null;
  customer: string | null;
  amount: number | null;
  awardedOn: string | null;
  description: string;
  sourceUrl: string;
  sourceLabel: string;
  status: string;
  sourceType: 'government-record' | 'curated-fallback';
};

type ProcurementAwardRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | string | null;
  awarded_on: string | null;
  metadata: Record<string, unknown> | null;
  program_scope?: string | null;
  scope_tier?: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(
    supabase,
    'blue_origin_contracts_ingest'
  );

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    contractsUpserted: 0,
    timelineEventsUpserted: 0,
    procurementContractsDiscovered: 0,
    contractActionsUpserted: 0,
    spendingRowsUpserted: 0,
    contractVehicleMapUpserted: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    contractsRevalidateRequested: false,
    contractsRevalidateSucceeded: false,
    contractsRevalidateHttpStatus: null as number | null,
    contractsRevalidateError: null as string | null,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(
      supabase,
      'blue_origin_contracts_job_enabled',
      true
    );
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, {
        skipped: true,
        reason: 'disabled'
      });
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'disabled',
        elapsedMs: Date.now() - startedAt
      });
    }

    const retries = await readNumberSetting(
      supabase,
      'blue_origin_source_fetch_retries',
      4
    );
    const backoffMs = await readNumberSetting(
      supabase,
      'blue_origin_source_fetch_backoff_ms',
      900
    );
    const timeoutMs = await readNumberSetting(
      supabase,
      'blue_origin_source_fetch_timeout_ms',
      20_000
    );
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);
    const contractSeeds = buildContractSeeds(sourceUrls);
    const procurementSeeds = await buildProcurementContractSeeds(supabase);
    stats.procurementContractsDiscovered = procurementSeeds.length;
    const mergedContractSeeds = dedupeContractSeeds([
      ...contractSeeds,
      ...procurementSeeds
    ]);

    await updateCheckpoint(supabase, 'blue_origin_contracts', {
      sourceType: 'government-record',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        contractSeedCount: mergedContractSeeds.length,
        curatedSeedCount: contractSeeds.length,
        procurementSeedCount: procurementSeeds.length
      }
    });

    const sourceDocIdsByUrl = new Map<string, string>();
    const sourceStatusByUrl = new Map<
      string,
      { ok: boolean; status: number; challenge: boolean }
    >();

    for (const contract of mergedContractSeeds) {
      const response = await fetchTextWithMeta(contract.sourceUrl, {
        retries,
        backoffMs,
        timeoutMs
      });
      const sourceDocId = await insertSourceDocument(supabase, {
        sourceKey: 'blue_origin_contracts',
        sourceType: contract.sourceType,
        url: contract.sourceUrl,
        title: contract.title,
        summary:
          stripHtml(response.text).slice(0, 2400) ||
          `HTTP ${response.status} while fetching ${contract.sourceUrl}`,
        announcedTime: contract.awardedOn
          ? `${contract.awardedOn}T00:00:00Z`
          : toIsoOrNull(response.lastModified) || runStartedAtIso,
        httpStatus: response.status,
        contentType: response.contentType,
        etag: response.etag,
        lastModified: response.lastModified,
        raw: {
          ok: response.ok,
          challenge: response.challenge,
          throttled: response.throttled,
          retryAfterMs: response.retryAfterMs,
          attemptCount: response.attemptCount,
          finalUrl: response.finalUrl,
          error: response.error,
          sourceLabel: contract.sourceLabel
        },
        error: response.ok ? null : response.error
      });

      sourceDocIdsByUrl.set(contract.sourceUrl, sourceDocId);
      sourceStatusByUrl.set(contract.sourceUrl, {
        ok: response.ok,
        status: response.status,
        challenge: response.challenge
      });
      stats.sourceDocumentsInserted =
        Number(stats.sourceDocumentsInserted || 0) + 1;
      if (!response.ok)
        stats.sourceFetchFailures = Number(stats.sourceFetchFailures || 0) + 1;
      if (response.challenge)
        stats.challengeResponses = Number(stats.challengeResponses || 0) + 1;
    }

    const contractUpserts = mergedContractSeeds.map((contract) => {
      const sourceStatus = sourceStatusByUrl.get(contract.sourceUrl) || {
        ok: false,
        status: 0,
        challenge: false
      };
      return {
        contract_key: contract.contractKey,
        mission_key: contract.missionKey,
        title: contract.title,
        agency: contract.agency,
        customer: contract.customer,
        amount: contract.amount,
        awarded_on: contract.awardedOn,
        description: contract.description,
        source_url: contract.sourceUrl,
        source_label: contract.sourceLabel,
        status: contract.status,
        source_document_id: sourceDocIdsByUrl.get(contract.sourceUrl) || null,
        metadata: {
          sourceClass: contract.sourceType,
          confidence: sourceStatus.ok ? 'high' : 'medium',
          fetchStatus: sourceStatus.status,
          fetchChallenge: sourceStatus.challenge
        },
        updated_at: new Date().toISOString()
      };
    });

    const { error: upsertError } = await supabase
      .from('blue_origin_contracts')
      .upsert(contractUpserts, { onConflict: 'contract_key' });
    if (upsertError) throw upsertError;
    stats.contractsUpserted = contractUpserts.length;

    await upsertContractDetailTables(supabase, contractUpserts, stats);

    for (const contract of mergedContractSeeds) {
      const sourceStatus = sourceStatusByUrl.get(contract.sourceUrl) || {
        ok: false,
        status: 0,
        challenge: false
      };
      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:contract:${contract.contractKey}`,
        missionKey: contract.missionKey,
        title: contract.title,
        summary: contract.description,
        eventTime: contract.awardedOn
          ? `${contract.awardedOn}T00:00:00Z`
          : null,
        announcedTime: contract.awardedOn
          ? `${contract.awardedOn}T00:00:00Z`
          : runStartedAtIso,
        sourceType: contract.sourceType,
        confidence: sourceStatus.ok ? 'high' : 'medium',
        status: 'completed',
        sourceDocumentId: sourceDocIdsByUrl.get(contract.sourceUrl) || null,
        sourceUrl: contract.sourceUrl,
        metadata: {
          contractKey: contract.contractKey,
          sourceLabel: contract.sourceLabel,
          fetchStatus: sourceStatus.status,
          fetchChallenge: sourceStatus.challenge
        }
      });
      stats.timelineEventsUpserted =
        Number(stats.timelineEventsUpserted || 0) + 1;
    }

    stats.contractsRevalidateRequested = true;
    const revalidateResult = await requestCanonicalContractsRevalidate({
      source: 'blue-origin-contracts-ingest',
      reason: 'blue-origin-contracts-updated'
    });
    stats.contractsRevalidateSucceeded = revalidateResult.ok;
    stats.contractsRevalidateHttpStatus = revalidateResult.status;
    stats.contractsRevalidateError = revalidateResult.error;

    await updateCheckpoint(supabase, 'blue_origin_contracts', {
      sourceType: 'government-record',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.contractsUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        contractSeedCount: mergedContractSeeds.length,
        curatedSeedCount: contractSeeds.length,
        procurementSeedCount: procurementSeeds.length,
        sourceDocumentsInserted: stats.sourceDocumentsInserted,
        timelineEventsUpserted: stats.timelineEventsUpserted,
        contractActionsUpserted: stats.contractActionsUpserted,
        spendingRowsUpserted: stats.spendingRowsUpserted,
        contractVehicleMapUpserted: stats.contractVehicleMapUpserted,
        sourceFetchFailures: stats.sourceFetchFailures,
        challengeResponses: stats.challengeResponses,
        contractsRevalidateRequested: stats.contractsRevalidateRequested,
        contractsRevalidateSucceeded: stats.contractsRevalidateSucceeded,
        contractsRevalidateHttpStatus: stats.contractsRevalidateHttpStatus,
        contractsRevalidateError: stats.contractsRevalidateError
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_contracts', {
      sourceType: 'government-record',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse(
      { ok: false, error: message, elapsedMs: Date.now() - startedAt, stats },
      500
    );
  }
});

function buildContractSeeds(
  sourceUrls: Record<string, string>
): ContractSeed[] {
  return [
    {
      contractKey: 'NASA-HLS-2023-05-19',
      missionKey: 'blue-moon',
      title: 'NASA Artemis Human Landing System Option (Blue Moon)',
      agency: 'NASA',
      customer: 'NASA',
      amount: null,
      awardedOn: '2023-05-19',
      description:
        'NASA selected Blue Origin as second Artemis lunar lander provider for a crewed lunar demonstration.',
      sourceUrl: sourceUrls.nasaBlueMoonHls,
      sourceLabel: 'NASA press release',
      status: 'awarded',
      sourceType: 'government-record'
    },
    {
      contractKey: 'NASA-VIPER-2025-09-19',
      missionKey: 'blue-moon',
      title: 'NASA selects Blue Origin to deliver VIPER rover to the Moon',
      agency: 'NASA',
      customer: 'NASA',
      amount: null,
      awardedOn: '2025-09-19',
      description:
        'NASA selected Blue Origin to deliver the VIPER rover to the Moon as part of Artemis lunar surface logistics.',
      sourceUrl: sourceUrls.nasaBlueMoonViper || sourceUrls.nasaBlueMoonHls,
      sourceLabel: 'NASA press release',
      status: 'awarded',
      sourceType: 'government-record'
    },
    {
      contractKey: 'USSF-NSSL-LANE1-2024-06-13',
      missionKey: 'new-glenn',
      title: 'U.S. Space Force NSSL Lane award includes Blue Origin',
      agency: 'U.S. Space Force',
      customer: 'U.S. Space Force',
      amount: null,
      awardedOn: '2024-06-13',
      description:
        'Space Force awarded National Security Space Launch contracts including Blue Origin participation.',
      sourceUrl: sourceUrls.ussfNssl,
      sourceLabel: 'U.S. Space Force',
      status: 'awarded',
      sourceType: 'government-record'
    },
    {
      contractKey: 'AMZN-KUIPER-2022-04-05',
      missionKey: 'new-glenn',
      title: 'Amazon Project Kuiper launch services agreement',
      agency: null,
      customer: 'Amazon',
      amount: null,
      awardedOn: '2022-04-05',
      description:
        'Amazon announced launch agreements including New Glenn missions for Project Kuiper deployment.',
      sourceUrl: sourceUrls.amazonKuiper,
      sourceLabel: 'Amazon announcement',
      status: 'announced',
      sourceType: 'curated-fallback'
    }
  ];
}

async function buildProcurementContractSeeds(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<ContractSeed[]> {
  const requestedLimit = 1200;
  const scopedRes = await supabase
    .from('program_usaspending_audited_awards')
    .select(
      'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,metadata,program_scope,scope_tier'
    )
    .eq('program_scope', 'blue-origin')
    .eq('scope_tier', 'exact')
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(requestedLimit);

  let rows = [] as ProcurementAwardRow[];
  if (!scopedRes.error && (scopedRes.data || []).length > 0) {
    const seededRows = (scopedRes.data || []) as ProcurementAwardRow[];
    rows = seededRows.slice(0, requestedLimit);
  } else if (
    scopedRes.error &&
    !isMissingAuditedAwardsRelationError(scopedRes.error.message)
  ) {
    throw scopedRes.error;
  } else {
    rows = (await queryExactProcurementRows(supabase, requestedLimit)).slice(
      0,
      requestedLimit
    );
  }

  return rows
    .map((row) => {
      const awardId = String(row.usaspending_award_id || '').trim();
      if (!awardId) return null;
      const title =
        String(row.award_title || '').trim() || `USASpending award ${awardId}`;
      const recipient = String(row.recipient || '').trim() || null;
      const metadata = (row.metadata || {}) as Record<string, unknown>;
      const sourceUrl = normalizeUsaspendingContractSourceUrl(
        pickMetadataUrl(metadata, ['awardPageUrl', 'sourceUrl', 'awardApiUrl']),
        awardId
      );
      const amount = parseNumeric(row.obligated_amount);
      const awardedOn = normalizeDate(row.awarded_on);

      return {
        contractKey: `USASPENDING-${awardId}`,
        missionKey: classifyMissionFromContractText(
          `${title} ${recipient || ''}`
        ),
        title,
        agency: 'NASA',
        customer: recipient,
        amount,
        awardedOn,
        description: title,
        sourceUrl,
        sourceLabel: 'USASpending award record',
        status: 'awarded',
        sourceType: 'government-record'
      } as ContractSeed;
    })
    .filter((row): row is ContractSeed => Boolean(row));
}

async function queryExactProcurementRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  limit: number
) {
  const fallbackRes = await supabase
    .from('artemis_procurement_awards')
    .select(
      'usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,metadata'
    )
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (fallbackRes.error) {
    console.error(
      'blue origin procurement fallback query error',
      fallbackRes.error
    );
    return [] as ProcurementAwardRow[];
  }

  return ((fallbackRes.data || []) as ProcurementAwardRow[]).filter((row) =>
    isBlueOriginExactProcurementRow(row)
  );
}

function isMissingProgramScopeColumnError(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('program_scope') && normalized.includes('column');
}

function isMissingAuditedAwardsRelationError(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('program_usaspending_audited_awards') ||
    normalized.includes('scope_tier')
  );
}

function mergeProcurementRows(rows: ProcurementAwardRow[]) {
  const seen = new Set<string>();
  const merged: ProcurementAwardRow[] = [];

  for (const row of rows) {
    const awardId = String(row.usaspending_award_id || '').trim();
    const missionKey = String(row.awarded_on || '').trim();
    const title = String(row.award_title || '').trim();
    const key = `${awardId}|${missionKey}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged;
}

function isBlueOriginExactProcurementRow(row: ProcurementAwardRow) {
  const metadata = (row.metadata || {}) as Record<string, unknown>;
  const classification = classifyUsaspendingAwardForScope(
    {
      awardId: row.usaspending_award_id,
      title: row.award_title,
      recipient: row.recipient,
      awardedOn: row.awarded_on,
      metadata
    },
    'blue-origin'
  );
  return classification.tier === 'exact';
}

function extractProgramScopes(metadata: Record<string, unknown>) {
  return readHubAuditProgramScopes(metadata, null);
}

function normalizeProgramScope(value: string | null) {
  return normalizeHubAuditProgramScope(value);
}

function asString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function dedupeContractSeeds(seeds: ContractSeed[]) {
  const map = new Map<string, ContractSeed>();
  for (const seed of seeds) {
    const existing = map.get(seed.contractKey);
    if (!existing) {
      map.set(seed.contractKey, seed);
      continue;
    }
    if (
      seed.sourceType === 'government-record' &&
      existing.sourceType !== 'government-record'
    ) {
      map.set(seed.contractKey, seed);
    }
  }
  return [...map.values()];
}

function classifyMissionFromContractText(
  text: string
): ContractSeed['missionKey'] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes('blue moon') ||
    normalized.includes('lunar') ||
    normalized.includes('human landing system')
  )
    return 'blue-moon';
  if (
    normalized.includes('new glenn') ||
    normalized.includes('nssl') ||
    normalized.includes('launch service')
  )
    return 'new-glenn';
  return 'blue-origin-program';
}

function pickMetadataUrl(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized) continue;
    if (normalized.startsWith('https://') || normalized.startsWith('http://'))
      return normalized;
  }
  return null;
}

function normalizeUsaspendingContractSourceUrl(
  value: string | null,
  awardId: string
) {
  const fallback = `https://www.usaspending.gov/search/?hash=${encodeURIComponent(awardId)}`;
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() === 'api.usaspending.gov') return fallback;
    return value;
  } catch {
    return fallback;
  }
}

function parseNumeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

async function upsertContractDetailTables(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  contractUpserts: Array<Record<string, unknown>>,
  stats: Record<string, unknown>
) {
  const contractKeys = contractUpserts
    .map((row) => String(row.contract_key || '').trim())
    .filter(Boolean);
  if (contractKeys.length === 0) return;

  const { data: contractRows, error: contractRowsError } = await supabase
    .from('blue_origin_contracts')
    .select(
      'id,contract_key,mission_key,awarded_on,amount,title,source_document_id'
    )
    .in('contract_key', contractKeys)
    .limit(1_000);
  if (contractRowsError) throw contractRowsError;

  const actions = [] as Array<Record<string, unknown>>;
  const spending = [] as Array<Record<string, unknown>>;
  const vehicleMap = [] as Array<Record<string, unknown>>;

  for (const row of contractRows || []) {
    const contractId = String((row as Record<string, unknown>).id || '');
    const contractKey = String(
      (row as Record<string, unknown>).contract_key || ''
    );
    if (!contractId || !contractKey) continue;

    const awardedOn = String(
      (row as Record<string, unknown>).awarded_on || ''
    ).trim();
    const amount = parseNumeric((row as Record<string, unknown>).amount);
    const missionKey = String(
      (row as Record<string, unknown>).mission_key || ''
    );
    const sourceDocumentId =
      String((row as Record<string, unknown>).source_document_id || '') || null;

    actions.push({
      contract_id: contractId,
      action_key: `${contractKey}:base-award`,
      mod_number: '0',
      action_date: awardedOn || null,
      obligation_delta: amount,
      obligation_cumulative: amount,
      source: 'government-record',
      source_record_hash: `${contractKey}:base-award:v1`,
      source_document_id: sourceDocumentId,
      metadata: {
        derived: true,
        contractKey
      },
      updated_at: new Date().toISOString()
    });

    if (amount !== null && awardedOn) {
      const date = new Date(`${awardedOn}T00:00:00Z`);
      if (Number.isFinite(date.getTime())) {
        spending.push({
          contract_id: contractId,
          fiscal_year: date.getUTCFullYear(),
          fiscal_month: date.getUTCMonth() + 1,
          obligations: amount,
          outlays: null,
          source: 'usaspending',
          metadata: {
            derived: true,
            contractKey
          },
          updated_at: new Date().toISOString()
        });
      }
    }

    if (missionKey === 'blue-moon') {
      vehicleMap.push({
        contract_id: contractId,
        vehicle_slug: 'blue-moon',
        engine_slug: 'be-7',
        match_method: 'rule',
        confidence: 0.9,
        metadata: { derived: true, rule: 'mission-blue-moon' },
        updated_at: new Date().toISOString()
      });
    } else if (missionKey === 'new-glenn') {
      vehicleMap.push({
        contract_id: contractId,
        vehicle_slug: 'new-glenn',
        engine_slug: 'be-4',
        match_method: 'rule',
        confidence: 0.9,
        metadata: { derived: true, rule: 'mission-new-glenn' },
        updated_at: new Date().toISOString()
      });
    }
  }

  if (actions.length > 0) {
    const { error } = await supabase
      .from('blue_origin_contract_actions')
      .upsert(actions, { onConflict: 'action_key' });
    if (error) throw error;
    stats.contractActionsUpserted = actions.length;
  }

  if (spending.length > 0) {
    const { error } = await supabase
      .from('blue_origin_spending_timeseries')
      .upsert(spending, {
        onConflict: 'contract_id,fiscal_year,fiscal_month,source'
      });
    if (error) throw error;
    stats.spendingRowsUpserted = spending.length;
  }

  if (vehicleMap.length > 0) {
    const { error } = await supabase
      .from('blue_origin_contract_vehicle_map')
      .upsert(vehicleMap, {
        onConflict: 'contract_id,vehicle_slug,engine_slug,match_method'
      });
    if (error) throw error;
    stats.contractVehicleMapUpserted = vehicleMap.length;
  }
}
