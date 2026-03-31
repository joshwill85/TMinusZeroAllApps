import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  buildUrl,
  CELESTRAK_GP_ENDPOINT,
  CELESTRAK_SATCAT_ENDPOINT,
  CELESTRAK_SUPGP_ENDPOINT,
  DEFAULT_CELESTRAK_USER_AGENT,
  fetchJsonWithRetries,
  normalizeEpochForPg
} from '../_shared/celestrak.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

const DEFAULTS = {
  gpMaxDatasetsPerRun: 7,
  satcatMaxDatasetsPerRun: 6,
  supgpMaxDatasetsPerRun: 3,
  intdesMaxDesignatorsPerRun: 25,
  upsertChunkSize: 500
};

type LaunchInventoryItemRow = {
  object_id: string;
  norad_cat_id: number | null;
  object_name: string | null;
  object_type: 'PAY' | 'RB' | 'DEB' | 'UNK';
  ops_status_code: string | null;
  owner: string | null;
  launch_date: string | null;
  launch_site: string | null;
  decay_date: string | null;
  period_min: number | null;
  inclination_deg: number | null;
  apogee_km: number | null;
  perigee_km: number | null;
  rcs_m2: number | null;
  data_status_code: string | null;
  orbit_center: string | null;
  orbit_type: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_ingest');

  const stats: Record<string, unknown> = {
    gp: { datasetsClaimed: 0, datasetsProcessed: 0, satellitesUpserted: 0, orbitElementsUpserted: 0, membershipsUpserted: 0 },
    satcat: { datasetsClaimed: 0, datasetsProcessed: 0, satellitesUpserted: 0 },
    supgp: { datasetsClaimed: 0, datasetsProcessed: 0, satellitesUpserted: 0, orbitElementsUpserted: 0 },
    intdes: {
      designatorsClaimed: 0,
      designatorsProcessed: 0,
      satellitesUpserted: 0,
      snapshotsCreated: 0,
      snapshotItemsInserted: 0,
      unchangedSnapshots: 0
    },
    errors: [] as Array<{ scope: string; key: string; error: string }>
  };

  try {
    const settings = await getSettings(supabase, [
      'celestrak_gp_job_enabled',
      'celestrak_gp_max_datasets_per_run',
      'celestrak_satcat_job_enabled',
      'celestrak_satcat_max_datasets_per_run',
      'celestrak_intdes_job_enabled',
      'celestrak_intdes_max_designators_per_run'
    ]);

    const gpEnabled = readBooleanSetting(settings.celestrak_gp_job_enabled, true);
    const satcatEnabled = readBooleanSetting(settings.celestrak_satcat_job_enabled, true);
    // SupGP is now owned by the dedicated celestrak-supgp-sync + celestrak-supgp-ingest job pair.
    const supgpEnabled = false;
    const intdesEnabled = readBooleanSetting(settings.celestrak_intdes_job_enabled, true);

    const gpMax = clampInt(
      readNumberSetting(settings.celestrak_gp_max_datasets_per_run, DEFAULTS.gpMaxDatasetsPerRun),
      1,
      25
    );
    const satcatMax = clampInt(
      readNumberSetting(settings.celestrak_satcat_max_datasets_per_run, DEFAULTS.satcatMaxDatasetsPerRun),
      1,
      25
    );
    const intdesMax = clampInt(
      readNumberSetting(settings.celestrak_intdes_max_designators_per_run, DEFAULTS.intdesMaxDesignatorsPerRun),
      1,
      200
    );

    const fetchedAt = new Date().toISOString();

    if (gpEnabled) {
      const { data: claimed, error } = await supabase.rpc('claim_celestrak_datasets', {
        dataset_type_filter: 'gp',
        batch_size: gpMax
      });
      if (error) throw error;
      const datasets = Array.isArray(claimed) ? claimed : [];
      (stats.gp as any).datasetsClaimed = datasets.length;

      for (const dataset of datasets) {
        const datasetKey = String(dataset?.dataset_key || '');
        const code = String(dataset?.code || '');
        try {
          if (!datasetKey || !code) throw new Error('invalid_dataset_row');
          const result = await ingestGpGroup({ supabase, groupCode: code, fetchedAt });
          (stats.gp as any).datasetsProcessed = (stats.gp as any).datasetsProcessed + 1;
          (stats.gp as any).satellitesUpserted = (stats.gp as any).satellitesUpserted + result.satellitesUpserted;
          (stats.gp as any).orbitElementsUpserted = (stats.gp as any).orbitElementsUpserted + result.orbitElementsUpserted;
          (stats.gp as any).membershipsUpserted = (stats.gp as any).membershipsUpserted + result.membershipsUpserted;
          await markDatasetSuccess(supabase, datasetKey, fetchedAt, 200);
        } catch (err) {
          const message = stringifyError(err);
          (stats.errors as Array<any>).push({ scope: 'gp', key: datasetKey || code, error: message });
          await markDatasetFailure(supabase, datasetKey, dataset, message);
        }
      }
    }

    if (satcatEnabled) {
      const { data: claimed, error } = await supabase.rpc('claim_celestrak_datasets', {
        dataset_type_filter: 'satcat',
        batch_size: satcatMax
      });
      if (error) throw error;
      const datasets = Array.isArray(claimed) ? claimed : [];
      (stats.satcat as any).datasetsClaimed = datasets.length;

      for (const dataset of datasets) {
        const datasetKey = String(dataset?.dataset_key || '');
        const code = String(dataset?.code || '');
        try {
          if (!datasetKey || !code) throw new Error('invalid_dataset_row');
          const query = buildSatcatQuery(dataset);
          const result = await ingestSatcatGroup({ supabase, datasetKey, code, query, fetchedAt });
          (stats.satcat as any).datasetsProcessed = (stats.satcat as any).datasetsProcessed + 1;
          (stats.satcat as any).satellitesUpserted = (stats.satcat as any).satellitesUpserted + result.satellitesUpserted;
          await markDatasetSuccess(supabase, datasetKey, fetchedAt, 200);
        } catch (err) {
          const message = stringifyError(err);
          (stats.errors as Array<any>).push({ scope: 'satcat', key: datasetKey || code, error: message });
          await markDatasetFailure(supabase, datasetKey, dataset, message);
        }
      }
    }

    if (supgpEnabled) {
      const { data: claimed, error } = await supabase.rpc('claim_celestrak_datasets', {
        dataset_type_filter: 'supgp',
        batch_size: supgpMax
      });
      if (error) throw error;
      const datasets = Array.isArray(claimed) ? claimed : [];
      (stats.supgp as any).datasetsClaimed = datasets.length;

      for (const dataset of datasets) {
        const datasetKey = String(dataset?.dataset_key || '');
        const code = String(dataset?.code || '');
        try {
          if (!datasetKey || !code) throw new Error('invalid_dataset_row');
          const query = buildSupgpQuery(dataset);
          const result = await ingestSupgpDataset({ supabase, sourceLabel: code, query, fetchedAt });
          (stats.supgp as any).datasetsProcessed = (stats.supgp as any).datasetsProcessed + 1;
          (stats.supgp as any).satellitesUpserted = (stats.supgp as any).satellitesUpserted + result.satellitesUpserted;
          (stats.supgp as any).orbitElementsUpserted = (stats.supgp as any).orbitElementsUpserted + result.orbitElementsUpserted;
          await markDatasetSuccess(supabase, datasetKey, fetchedAt, 200);
        } catch (err) {
          const message = stringifyError(err);
          (stats.errors as Array<any>).push({ scope: 'supgp', key: datasetKey || code, error: message });
          await markDatasetFailure(supabase, datasetKey, dataset, message);
        }
      }
    }

    if (intdesEnabled) {
      const { data: claimed, error } = await supabase.rpc('claim_celestrak_intdes_datasets', {
        batch_size: intdesMax
      });
      if (error) throw error;
      const datasets = Array.isArray(claimed) ? claimed : [];
      (stats.intdes as any).designatorsClaimed = datasets.length;

      for (const dataset of datasets) {
        const launchDesignator = typeof dataset?.launch_designator === 'string' ? dataset.launch_designator.trim() : '';
        try {
          if (!launchDesignator) throw new Error('invalid_launch_designator');
          const result = await ingestSatcatByIntdes({ supabase, launchDesignator, fetchedAt });
          (stats.intdes as any).designatorsProcessed = (stats.intdes as any).designatorsProcessed + 1;
          (stats.intdes as any).satellitesUpserted = (stats.intdes as any).satellitesUpserted + result.satellitesUpserted;
          (stats.intdes as any).snapshotsCreated = (stats.intdes as any).snapshotsCreated + result.snapshotsCreated;
          (stats.intdes as any).snapshotItemsInserted = (stats.intdes as any).snapshotItemsInserted + result.snapshotItemsInserted;
          (stats.intdes as any).unchangedSnapshots = (stats.intdes as any).unchangedSnapshots + (result.snapshotChanged ? 0 : 1);
          await markIntdesSuccess(supabase, launchDesignator, fetchedAt, 200, {
            catalogState: result.catalogState,
            latestSnapshotId: result.latestSnapshotId,
            latestSnapshotHash: result.latestSnapshotHash,
            lastNonEmptyAt: result.lastNonEmptyAt
          });
        } catch (err) {
          const message = stringifyError(err);
          (stats.errors as Array<any>).push({ scope: 'intdes', key: launchDesignator || 'unknown', error: message });
          await markIntdesFailure(supabase, launchDesignator, dataset, message);
        }
      }
    }

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, { ...stats, elapsedMs: Date.now() - startedAt }, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message, stats }, 500);
  }
});

function buildSupgpQuery(dataset: any): Record<string, unknown> {
  const q = dataset?.query;
  if (q && typeof q === 'object' && !Array.isArray(q)) return q as Record<string, unknown>;
  if (dataset?.code) return { SOURCE: dataset.code };
  return {};
}

function buildSatcatQuery(dataset: any): Record<string, unknown> {
  const q = dataset?.query;
  if (q && typeof q === 'object' && !Array.isArray(q)) return q as Record<string, unknown>;
  return { GROUP: dataset?.code, ONORBIT: 1 };
}

async function ingestGpGroup({
  supabase,
  groupCode,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  groupCode: string;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_GP_ENDPOINT, { GROUP: groupCode, FORMAT: 'JSON' });
  const res = await fetchJsonWithRetries<any[]>(
    url,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1000 }
  );
  if (!res.ok) {
    const snippet = res.text ? res.text.slice(0, 220).replace(/\\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_gp_${groupCode}_${res.status}:${snippet || res.error}`);
  }
  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_gp_${groupCode}_invalid_json_shape`);
  }

  const satellites = new Map<string, any>();
  const memberships = new Map<string, any>();
  const orbitElements = new Map<string, any>();

  for (const item of res.data) {
    const norad = parseNoradCatId(item?.NORAD_CAT_ID);
    if (!norad) continue;
    const epoch = normalizeEpochForPg(item?.EPOCH);
    if (!epoch) continue;

    const intlDes = typeof item?.OBJECT_ID === 'string' ? item.OBJECT_ID.trim() : null;
    const objectName = typeof item?.OBJECT_NAME === 'string' ? item.OBJECT_NAME.trim() : null;

    if (!satellites.has(norad)) {
      satellites.set(norad, {
        norad_cat_id: norad,
        intl_des: intlDes || null,
        object_name: objectName || null,
        updated_at: fetchedAt
      });
    }

    memberships.set(norad, {
      group_code: groupCode,
      norad_cat_id: norad,
      last_seen_at: fetchedAt
    });

    const key = `${norad}:${epoch}`;
    if (!orbitElements.has(key)) {
      orbitElements.set(key, {
        norad_cat_id: norad,
        source: 'gp',
        group_or_source: groupCode,
        epoch,
        inclination_deg: parseFiniteNumber(item?.INCLINATION),
        raan_deg: parseFiniteNumber(item?.RA_OF_ASC_NODE),
        eccentricity: parseFiniteNumber(item?.ECCENTRICITY),
        arg_perigee_deg: parseFiniteNumber(item?.ARG_OF_PERICENTER),
        mean_anomaly_deg: parseFiniteNumber(item?.MEAN_ANOMALY),
        mean_motion_rev_per_day: parseFiniteNumber(item?.MEAN_MOTION),
        bstar: parseFiniteNumber(item?.BSTAR),
        raw_omm: item,
        fetched_at: fetchedAt,
        hash: null
      });
    }
  }

  const satelliteRows = [...satellites.values()];
  const membershipRows = [...memberships.values()];
  const orbitRows = [...orbitElements.values()];

  await upsertSatelliteIdentitiesIfChangedInChunks(supabase, satelliteRows, DEFAULTS.upsertChunkSize);
  await upsertSatelliteGroupMembershipsThrottledInChunks(supabase, membershipRows, DEFAULTS.upsertChunkSize);
  await upsertInChunks(supabase, 'orbit_elements', orbitRows, {
    onConflict: 'norad_cat_id,source,epoch',
    ignoreDuplicates: true
  });

  return { satellitesUpserted: satelliteRows.length, membershipsUpserted: membershipRows.length, orbitElementsUpserted: orbitRows.length };
}

async function ingestSupgpDataset({
  supabase,
  sourceLabel,
  query,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  sourceLabel: string;
  query: Record<string, unknown>;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_SUPGP_ENDPOINT, { ...query, FORMAT: 'JSON' });
  const res = await fetchJsonWithRetries<any[]>(
    url,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );
  if (!res.ok) {
    const snippet = res.text ? res.text.slice(0, 220).replace(/\\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_supgp_${sourceLabel}_${res.status}:${snippet || res.error}`);
  }
  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_supgp_${sourceLabel}_invalid_json_shape`);
  }

  const satellites = new Map<string, any>();
  const orbitElements = new Map<string, any>();

  for (const item of res.data) {
    const norad = parseNoradCatId(item?.NORAD_CAT_ID);
    if (!norad) continue;
    const epoch = normalizeEpochForPg(item?.EPOCH);
    if (!epoch) continue;

    const intlDes = typeof item?.OBJECT_ID === 'string' ? item.OBJECT_ID.trim() : null;
    const objectName = typeof item?.OBJECT_NAME === 'string' ? item.OBJECT_NAME.trim() : null;

    if (!satellites.has(norad)) {
      satellites.set(norad, {
        norad_cat_id: norad,
        intl_des: intlDes || null,
        object_name: objectName || null,
        updated_at: fetchedAt
      });
    }

    const key = `${norad}:${epoch}`;
    if (!orbitElements.has(key)) {
      orbitElements.set(key, {
        norad_cat_id: norad,
        source: 'supgp',
        group_or_source: sourceLabel,
        epoch,
        inclination_deg: parseFiniteNumber(item?.INCLINATION),
        raan_deg: parseFiniteNumber(item?.RA_OF_ASC_NODE),
        eccentricity: parseFiniteNumber(item?.ECCENTRICITY),
        arg_perigee_deg: parseFiniteNumber(item?.ARG_OF_PERICENTER),
        mean_anomaly_deg: parseFiniteNumber(item?.MEAN_ANOMALY),
        mean_motion_rev_per_day: parseFiniteNumber(item?.MEAN_MOTION),
        bstar: parseFiniteNumber(item?.BSTAR),
        raw_omm: item,
        fetched_at: fetchedAt,
        hash: null
      });
    }
  }

  const satelliteRows = [...satellites.values()];
  const orbitRows = [...orbitElements.values()];

  await upsertSatelliteIdentitiesIfChangedInChunks(supabase, satelliteRows, DEFAULTS.upsertChunkSize);
  await upsertInChunks(supabase, 'orbit_elements', orbitRows, {
    onConflict: 'norad_cat_id,source,epoch',
    ignoreDuplicates: true
  });

  return { satellitesUpserted: satelliteRows.length, orbitElementsUpserted: orbitRows.length };
}

async function ingestSatcatGroup({
  supabase,
  datasetKey,
  code,
  query,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  datasetKey: string;
  code: string;
  query: Record<string, unknown>;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { ...query, FORMAT: 'JSON' });
  const res = await fetchJsonWithRetries<any[]>(
    url,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );
  if (!res.ok) {
    const trimmed = (res.text || '').trim();
    if (res.status === 200 && /no satcat records found/i.test(trimmed)) {
      return { satellitesUpserted: 0, datasetKey, code };
    }
    const snippet = res.text ? res.text.slice(0, 220).replace(/\\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_satcat_${code}_${res.status}:${snippet || res.error}`);
  }
  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_satcat_${code}_invalid_json_shape`);
  }

  const satellites = new Map<string, any>();
  for (const item of res.data) {
    const normalized = normalizeSatcatRecord(item);
    const norad = normalized.norad_cat_id;
    if (!norad) continue;

    satellites.set(norad, { ...normalized, satcat_updated_at: fetchedAt, updated_at: fetchedAt });
  }

  const rows = [...satellites.values()];
  await upsertSatcatSatellitesIfChangedInChunks(supabase, rows, DEFAULTS.upsertChunkSize);
  return { satellitesUpserted: rows.length, datasetKey, code };
}

async function ingestSatcatByIntdes({
  supabase,
  launchDesignator,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launchDesignator: string;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { INTDES: launchDesignator, FORMAT: 'JSON' });
  const payloadOnlyUrl = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { INTDES: launchDesignator, PAYLOADS: 1, FORMAT: 'JSON' });

  const res = await fetchJsonWithRetries<any[]>(
    url,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );
  if (!res.ok) {
    const trimmed = (res.text || '').trim();
    if (res.status === 200 && /no satcat records found/i.test(trimmed)) {
      return {
        satellitesUpserted: 0,
        snapshotsCreated: 0,
        snapshotItemsInserted: 0,
        snapshotChanged: false,
        catalogState: 'catalog_empty',
        latestSnapshotId: null,
        latestSnapshotHash: null,
        lastNonEmptyAt: null
      };
    }
    const snippet = res.text ? res.text.slice(0, 220).replace(/\\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_intdes_${launchDesignator}_${res.status}:${snippet || res.error}`);
  }
  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_intdes_${launchDesignator}_invalid_json_shape`);
  }

  const payloadOnlyRes = await fetchJsonWithRetries<any[]>(
    payloadOnlyUrl,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );

  let payloadsFilterCount = 0;
  if (payloadOnlyRes.ok && Array.isArray(payloadOnlyRes.data)) {
    payloadsFilterCount = payloadOnlyRes.data.length;
  } else if (!payloadOnlyRes.ok) {
    const trimmed = (payloadOnlyRes.text || '').trim();
    if (!(payloadOnlyRes.status === 200 && /no satcat records found/i.test(trimmed))) {
      const snippet = payloadOnlyRes.text ? payloadOnlyRes.text.slice(0, 220).replace(/\\s+/g, ' ').trim() : '';
      throw new Error(`celestrak_intdes_payloads_${launchDesignator}_${payloadOnlyRes.status}:${snippet || payloadOnlyRes.error}`);
    }
  }

  const satellites = new Map<string, any>();
  const inventoryItems = new Map<string, LaunchInventoryItemRow>();
  const typeCounts = { PAY: 0, RB: 0, DEB: 0, UNK: 0 };

  for (const item of res.data) {
    const normalized = normalizeSatcatRecord(item);
    const norad = normalized.norad_cat_id;
    if (!norad) continue;

    satellites.set(norad, { ...normalized, satcat_updated_at: fetchedAt, updated_at: fetchedAt });

    const objectId = normalized.intl_des;
    if (!objectId) continue;

    inventoryItems.set(objectId, {
      object_id: objectId,
      norad_cat_id: Number(norad),
      object_name: normalized.object_name,
      object_type: normalized.object_type,
      ops_status_code: normalized.ops_status_code,
      owner: normalized.owner,
      launch_date: normalized.launch_date,
      launch_site: normalized.launch_site,
      decay_date: normalized.decay_date,
      period_min: normalized.period_min,
      inclination_deg: normalized.inclination_deg,
      apogee_km: normalized.apogee_km,
      perigee_km: normalized.perigee_km,
      rcs_m2: normalized.rcs_m2,
      data_status_code:
        typeof item?.DATA_STATUS_CODE === 'string' && item.DATA_STATUS_CODE.trim() ? item.DATA_STATUS_CODE.trim() : null,
      orbit_center:
        typeof item?.ORBIT_CENTER === 'string' && item.ORBIT_CENTER.trim() ? item.ORBIT_CENTER.trim() : null,
      orbit_type:
        typeof item?.ORBIT_TYPE === 'string' && item.ORBIT_TYPE.trim() ? item.ORBIT_TYPE.trim() : null
    });

    if (normalized.object_type === 'PAY') typeCounts.PAY += 1;
    else if (normalized.object_type === 'RB') typeCounts.RB += 1;
    else if (normalized.object_type === 'DEB') typeCounts.DEB += 1;
    else typeCounts.UNK += 1;
  }

  const satelliteRows = [...satellites.values()];
  await upsertSatcatSatellitesIfChangedInChunks(supabase, satelliteRows, DEFAULTS.upsertChunkSize);

  const items = [...inventoryItems.values()].sort((a, b) => a.object_id.localeCompare(b.object_id));
  if (!items.length) {
    return {
      satellitesUpserted: satelliteRows.length,
      snapshotsCreated: 0,
      snapshotItemsInserted: 0,
      snapshotChanged: false,
      catalogState: 'catalog_empty',
      latestSnapshotId: null,
      latestSnapshotHash: null,
      lastNonEmptyAt: null
    };
  }

  const snapshotHash = await computeLaunchInventorySnapshotHash(launchDesignator, items, payloadsFilterCount);
  const snapshotResult = await upsertLaunchInventorySnapshot({
    supabase,
    launchDesignator,
    snapshotHash,
    items,
    payloadsFilterCount,
    typeCounts,
    capturedAt: fetchedAt
  });

  return {
    satellitesUpserted: satelliteRows.length,
    snapshotsCreated: snapshotResult.changed ? 1 : 0,
    snapshotItemsInserted: snapshotResult.changed ? items.length : 0,
    snapshotChanged: snapshotResult.changed,
    catalogState: 'catalog_available',
    latestSnapshotId: snapshotResult.snapshotId,
    latestSnapshotHash: snapshotHash,
    lastNonEmptyAt: fetchedAt
  };
}

async function markDatasetSuccess(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  datasetKey: string,
  nowIso: string,
  httpStatus: number
) {
  await supabase
    .from('celestrak_datasets')
    .update({
      last_success_at: nowIso,
      consecutive_failures: 0,
      last_http_status: httpStatus,
      last_error: null,
      updated_at: nowIso
    })
    .eq('dataset_key', datasetKey);
}

async function markDatasetFailure(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  datasetKey: string,
  dataset: any,
  errorMessage: string
) {
  const nowIso = new Date().toISOString();
  const statusMatch = errorMessage.match(/_(\\d{3})(:|$)/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const failures = clampInt(Number(dataset?.consecutive_failures || 0) + 1, 0, 999999);

  await supabase
    .from('celestrak_datasets')
    .update({
      consecutive_failures: failures,
      last_http_status: httpStatus,
      last_error: errorMessage.slice(0, 500),
      updated_at: nowIso
    })
    .eq('dataset_key', datasetKey);
}

async function markIntdesSuccess(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchDesignator: string,
  nowIso: string,
  httpStatus: number,
  details: {
    catalogState: string;
    latestSnapshotId: number | null;
    latestSnapshotHash: string | null;
    lastNonEmptyAt: string | null;
  }
) {
  const patch: Record<string, unknown> = {
    last_success_at: nowIso,
    last_checked_at: nowIso,
    consecutive_failures: 0,
    last_http_status: httpStatus,
    last_error: null,
    catalog_state: details.catalogState,
    latest_snapshot_id: details.latestSnapshotId,
    latest_snapshot_hash: details.latestSnapshotHash,
    updated_at: nowIso
  };

  if (details.lastNonEmptyAt) {
    patch.last_non_empty_at = details.lastNonEmptyAt;
  }

  await supabase
    .from('celestrak_intdes_datasets')
    .update(patch)
    .eq('launch_designator', launchDesignator);
}

async function markIntdesFailure(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchDesignator: string,
  dataset: any,
  errorMessage: string
) {
  const nowIso = new Date().toISOString();
  const statusMatch = errorMessage.match(/_(\\d{3})(:|$)/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const failures = clampInt(Number(dataset?.consecutive_failures || 0) + 1, 0, 999999);

  await supabase
    .from('celestrak_intdes_datasets')
    .update({
      consecutive_failures: failures,
      last_http_status: httpStatus,
      last_error: errorMessage.slice(0, 500),
      catalog_state: 'error',
      last_checked_at: nowIso,
      updated_at: nowIso
    })
    .eq('launch_designator', launchDesignator);
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

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function upsertSatelliteIdentitiesIfChangedInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[],
  chunkSize: number
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('upsert_satellite_identities_if_changed', { rows_in: chunk });
    if (!error) continue;

    // Backward compatible fallback if the RPC isn't deployed yet.
    console.warn('upsert_satellite_identities_if_changed RPC failed; falling back to direct upsert', error);
    await upsertInChunks(supabase, 'satellites', chunk, { onConflict: 'norad_cat_id', ignoreDuplicates: false });
  }
}

async function upsertSatelliteGroupMembershipsThrottledInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[],
  chunkSize: number
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('upsert_satellite_group_memberships_throttled', { rows_in: chunk });
    if (!error) continue;

    // Backward compatible fallback if the RPC isn't deployed yet.
    console.warn('upsert_satellite_group_memberships_throttled RPC failed; falling back to direct upsert', error);
    await upsertInChunks(supabase, 'satellite_group_memberships', chunk, {
      onConflict: 'group_code,norad_cat_id',
      ignoreDuplicates: false
    });
  }
}

async function upsertSatcatSatellitesIfChangedInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[],
  chunkSize: number
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('upsert_satellites_satcat_if_changed', { rows_in: chunk });
    if (!error) continue;

    // Backward-compatible fallback for environments without the conditional SATCAT RPC.
    console.warn('upsert_satellites_satcat_if_changed RPC failed; falling back to direct upsert', error);
    await upsertInChunks(supabase, 'satellites', chunk, { onConflict: 'norad_cat_id', ignoreDuplicates: false });
  }
}

async function computeLaunchInventorySnapshotHash(
  launchDesignator: string,
  items: LaunchInventoryItemRow[],
  payloadsFilterCount: number
) {
  const payload = JSON.stringify({
    launchDesignator,
    payloadsFilterCount,
    items: items.map((item) => ({
      object_id: item.object_id,
      norad_cat_id: item.norad_cat_id,
      object_name: item.object_name,
      object_type: item.object_type,
      ops_status_code: item.ops_status_code,
      owner: item.owner,
      launch_date: item.launch_date,
      launch_site: item.launch_site,
      decay_date: item.decay_date,
      period_min: item.period_min,
      inclination_deg: item.inclination_deg,
      apogee_km: item.apogee_km,
      perigee_km: item.perigee_km,
      rcs_m2: item.rcs_m2,
      data_status_code: item.data_status_code,
      orbit_center: item.orbit_center,
      orbit_type: item.orbit_type
    }))
  });

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function upsertLaunchInventorySnapshot({
  supabase,
  launchDesignator,
  snapshotHash,
  items,
  payloadsFilterCount,
  typeCounts,
  capturedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launchDesignator: string;
  snapshotHash: string;
  items: LaunchInventoryItemRow[];
  payloadsFilterCount: number;
  typeCounts: { PAY: number; RB: number; DEB: number; UNK: number };
  capturedAt: string;
}) {
  const { data: existingSnapshot, error: existingSnapshotError } = await supabase
    .from('launch_object_inventory_snapshots')
    .select('id')
    .eq('launch_designator', launchDesignator)
    .eq('snapshot_hash', snapshotHash)
    .maybeSingle();
  if (existingSnapshotError) throw existingSnapshotError;

  if (existingSnapshot?.id) {
    return { snapshotId: Number(existingSnapshot.id), changed: false };
  }

  const { data: insertedSnapshot, error: insertSnapshotError } = await supabase
    .from('launch_object_inventory_snapshots')
    .insert({
      launch_designator: launchDesignator,
      snapshot_hash: snapshotHash,
      object_count: items.length,
      payload_count: typeCounts.PAY,
      rb_count: typeCounts.RB,
      deb_count: typeCounts.DEB,
      unk_count: typeCounts.UNK,
      payloads_filter_count: payloadsFilterCount,
      captured_at: capturedAt
    })
    .select('id')
    .single();
  if (insertSnapshotError || !insertedSnapshot?.id) throw insertSnapshotError || new Error('intdes_snapshot_insert_failed');

  const snapshotId = Number(insertedSnapshot.id);
  const chunkedItems = chunkArray(items, DEFAULTS.upsertChunkSize);
  for (const chunk of chunkedItems) {
    const rows = chunk.map((item) => ({ snapshot_id: snapshotId, ...item }));
    const { error: insertItemsError } = await supabase.from('launch_object_inventory_snapshot_items').insert(rows);
    if (insertItemsError) throw insertItemsError;
  }

  return { snapshotId, changed: true };
}

function normalizeSatcatRecord(item: any) {
  const norad = parseNoradCatId(item?.NORAD_CAT_ID);
  const objectType = normalizeSatcatObjectType(item?.OBJECT_TYPE);
  return {
    norad_cat_id: norad,
    intl_des: normalizeSatcatText(item?.OBJECT_ID),
    object_name: normalizeSatcatText(item?.OBJECT_NAME),
    object_type: objectType,
    ops_status_code: normalizeSatcatText(item?.OPS_STATUS_CODE),
    owner: normalizeSatcatText(item?.OWNER),
    launch_date: normalizeDateForPg(item?.LAUNCH_DATE),
    launch_site: normalizeSatcatText(item?.LAUNCH_SITE),
    decay_date: normalizeDateForPg(item?.DECAY_DATE),
    period_min: parseFiniteNumber(item?.PERIOD),
    inclination_deg: parseFiniteNumber(item?.INCLINATION),
    apogee_km: parseFiniteNumber(item?.APOGEE),
    perigee_km: parseFiniteNumber(item?.PERIGEE),
    rcs_m2: parseFiniteNumber(item?.RCS),
    raw_satcat: item
  };
}

function normalizeSatcatText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSatcatObjectType(value: unknown): 'PAY' | 'RB' | 'DEB' | 'UNK' {
  if (typeof value !== 'string') return 'UNK';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'R/B') return 'RB';
  if (normalized === 'PAY' || normalized === 'RB' || normalized === 'DEB') return normalized;
  return 'UNK';
}

async function upsertInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: any[],
  {
    onConflict,
    ignoreDuplicates
  }: {
    onConflict: string;
    ignoreDuplicates: boolean;
  }
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, 250);
  for (const chunk of chunks) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
    if (error) throw error;
  }
}

function parseNoradCatId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\\d{1,9}$/.test(trimmed)) return trimmed.replace(/^0+/, '') || '0';
  }
  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeDateForPg(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
