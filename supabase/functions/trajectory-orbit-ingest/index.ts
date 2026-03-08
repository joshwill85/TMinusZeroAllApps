import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE, triggerEdgeJob } from '../_shared/edgeJobTrigger.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import {
  buildSupgpSearchPlan,
  parsePublicOrbitData as parseOrbitData,
  scoreSupgpOrbitRowMatch,
  type ParsedOrbitData,
  type SupgpRowMatch
} from '../../../lib/trajectory/publicOrbitSignals.ts';

type PdfJsModule = {
  getDocument?: (args: Record<string, unknown>) => { promise: Promise<any> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

let pdfJsModulePromise: Promise<PdfJsModule | null> | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule | null> {
  if (pdfJsModulePromise) return pdfJsModulePromise;

  pdfJsModulePromise = (async () => {
    const candidates = [
      'npm:pdfjs-dist@4.0.379/build/pdf.mjs',
      'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs'
    ];

    for (const specifier of candidates) {
      try {
        const mod = (await import(specifier)) as unknown as PdfJsModule;
        if (mod && typeof mod === 'object') return mod;
      } catch {
        // Try next candidate.
      }
    }

    return null;
  })();

  return pdfJsModulePromise;
}

function ensurePdfWorkerSrc(pdfjs: PdfJsModule) {
  const workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs';
  const opts = (pdfjs as any)?.GlobalWorkerOptions;
  if (!opts || typeof opts !== 'object') return;
  if (!opts.workerSrc) opts.workerSrc = workerSrc;
}

const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const PARSE_VERSION = 'v2';
const DOC_FETCH_TIMEOUT_MS = 15_000;
const DOC_FETCH_MAX_BYTES = 12_000_000;
const DOC_FETCH_RETRIES = 3;

const DEFAULTS = {
  enabled: true,
  horizonDays: 30,
  lookbackHours: 24,
  launchLimit: 100,
  docsPerLaunch: 3,
  truthDomains:
    'ulalaunch.com,nasa.gov,jpl.nasa.gov,spacex.com,content.spacex.com,starlink.com,rocketlabusa.com,rocketlabcorp.com,blueorigin.com,arianespace.com,ariane.group,esa.int,isro.gov.in,roscosmos.ru,jaxa.jp',
  fallbackDomains: '.gov,.mil'
};

type CandidateLaunch = {
  launch_id: string;
  net: string | null;
  provider: string | null;
  vehicle: string | null;
  name: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  pad_name: string | null;
  location_name: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  launch_info_urls: unknown | null;
  mission_info_urls: unknown | null;
};

type UrlCandidate = {
  url: string;
  title: string | null;
  from: 'launch_info_urls' | 'mission_info_urls' | 'derived';
  score: number;
  tier: 'truth' | 'fallback';
  reasons: string[];
};

type DocRow = {
  id: string;
  url: string;
  sha256: string;
  content_type: string | null;
  extracted_text: string | null;
  fetched_at: string;
};

type DocCacheEntry =
  | { status: 'ok'; doc: DocRow }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  let authorized = false;
  try {
    authorized = await requireJobAuth(req, supabase);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'trajectory_orbit_ingest');

  const stats: Record<string, unknown> = {
    launchesFound: 0,
    launchesConsidered: 0,
    launchCoverage: [] as Array<{
      launchId: string;
      urlCandidates: number;
      selectedCandidates: number;
      docsWithParsedOrbit: number;
      constraintsPrepared: number;
      usedSupgp: boolean;
      usedHazard: boolean;
      usedHeuristic: boolean;
    }>,
    urlsConsidered: 0,
    docsFetched: 0,
    docsNotModified: 0,
    docsNotFound: 0,
    docsInserted: 0,
    docsAlreadyStored: 0,
    constraintsDerived: 0,
    constraintsSupgpDerived: 0,
    constraintsHazardDerived: 0,
    constraintsUpserted: 0,
    constraintsMergedInput: 0,
    constraintsInserted: 0,
    constraintsUpdated: 0,
    constraintsSkipped: 0,
    mergeFallback: false,
    constraintsSkippedNoData: 0,
    trajectoryProductsTrigger: null as Record<string, unknown> | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'trajectory_orbit_job_enabled',
      'trajectory_orbit_horizon_days',
      'trajectory_orbit_lookback_hours',
      'trajectory_orbit_launch_limit',
      'trajectory_orbit_docs_per_launch',
      'trajectory_orbit_truth_domains',
      'trajectory_orbit_fallback_domains'
    ]);

    const enabled = readBooleanSetting(settings.trajectory_orbit_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const horizonDays = clampInt(readNumberSetting(settings.trajectory_orbit_horizon_days, DEFAULTS.horizonDays), 1, 3650);
    const lookbackHours = clampInt(readNumberSetting(settings.trajectory_orbit_lookback_hours, DEFAULTS.lookbackHours), 0, 168);
    const launchLimit = clampInt(readNumberSetting(settings.trajectory_orbit_launch_limit, DEFAULTS.launchLimit), 1, 500);
    const docsPerLaunch = clampInt(readNumberSetting(settings.trajectory_orbit_docs_per_launch, DEFAULTS.docsPerLaunch), 1, 4);
    const truthDomains = parseDomainList(readStringSetting(settings.trajectory_orbit_truth_domains, DEFAULTS.truthDomains));
    const fallbackDomains = parseDomainList(readStringSetting(settings.trajectory_orbit_fallback_domains, DEFAULTS.fallbackDomains));

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launches, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id,net,provider,vehicle,name,mission_name,mission_orbit,pad_name,location_name,pad_latitude,pad_longitude,launch_info_urls,mission_info_urls'
      )
      .gte('net', fromIso)
      .lte('net', toIso)
      .order('net', { ascending: true })
      .limit(launchLimit);

    if (launchesError) throw launchesError;
    const candidates = (Array.isArray(launches) ? launches : []) as CandidateLaunch[];
    stats.launchesFound = candidates.length;
    if (!candidates.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_candidates', fromIso, toIso });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_candidates', elapsedMs: Date.now() - startedAt, fromIso, toIso });
    }

    const constraintRows: Array<Record<string, any>> = [];
    const hazardsByLaunchId = await loadHazardsByLaunchId(supabase, candidates.map((row) => row.launch_id).filter(Boolean));
    const docCache = new Map<string, DocCacheEntry>();

    for (const launch of candidates) {
      stats.launchesConsidered = (stats.launchesConsidered as number) + 1;
      const launchId = launch.launch_id;
      if (!launchId) continue;

      const urlCandidates = buildUrlCandidates({ launch, truthDomains, fallbackDomains });
      stats.urlsConsidered = (stats.urlsConsidered as number) + urlCandidates.length;
      const shouldTryDeriveWithoutDocs = shouldAttemptDerivedOrbit(launch);
      if (!urlCandidates.length && !shouldTryDeriveWithoutDocs) continue;

      const selected = selectCandidates(urlCandidates, docsPerLaunch);
      const coverage = {
        launchId,
        urlCandidates: urlCandidates.length,
        selectedCandidates: selected.length,
        docsWithParsedOrbit: 0,
        constraintsPrepared: 0,
        usedSupgp: false,
        usedHazard: false,
        usedHeuristic: false
      };
      const selectedTierOrder = selected.map((c) => c.tier);
      const tierNotes = selectedTierOrder.length ? `tiers=${selectedTierOrder.join(',')}` : null;

      let hasDocDirection = false;
      let hasDocAzimuth = false;

      for (const candidate of selected) {
        const cached = docCache.get(candidate.url);
        if (cached?.status === 'not_found') continue;
        if (cached?.status === 'error') continue;

        try {
          let doc: DocRow | null = null;
          if (cached?.status === 'ok') {
            doc = cached.doc;
          } else {
            const latest = await loadLatestDocMeta(supabase, candidate.url);
            const fetched = await fetchDocument(candidate.url, latest);

            if (fetched.notModified && latest?.id) {
              stats.docsNotModified = (stats.docsNotModified as number) + 1;
              doc = await loadDocById(supabase, latest.id);
            } else {
              stats.docsFetched = (stats.docsFetched as number) + 1;
              const sha256 = await sha256Hex(fetched.bytes);
              const existing = await loadDocByUrlAndHash(supabase, candidate.url, sha256);
              if (existing) {
                stats.docsAlreadyStored = (stats.docsAlreadyStored as number) + 1;
                doc = existing;
              } else {
                const extracted = await extractText({
                  url: candidate.url,
                  contentType: fetched.contentType,
                  bytes: fetched.bytes
                });
                const insert = await insertDocVersion(supabase, {
                  url: candidate.url,
                  fetched,
                  sha256,
                  extractedText: extracted.text,
                  title: extracted.title,
                  raw: {
                    parseVersion: PARSE_VERSION,
                    contentType: fetched.contentType,
                    extraction: extracted.meta,
                    candidate: {
                      ...candidate,
                      tierNotes
                    }
                  }
                });
                if (insert) {
                  stats.docsInserted = (stats.docsInserted as number) + 1;
                  doc = insert;
                }
              }
            }

            if (doc) docCache.set(candidate.url, { status: 'ok', doc });
          }

          if (!doc?.extracted_text) {
            stats.constraintsSkippedNoData = (stats.constraintsSkippedNoData as number) + 1;
            continue;
          }

          const orbit = parseOrbitData(doc.extracted_text);
          const hasNumbers =
            orbit.inclination_deg != null ||
            orbit.flight_azimuth_deg != null ||
            orbit.altitude_km != null ||
            orbit.apogee_km != null ||
            orbit.perigee_km != null;
          if (!hasNumbers) {
            stats.constraintsSkippedNoData = (stats.constraintsSkippedNoData as number) + 1;
            continue;
          }

          const hasDirection = orbit.inclination_deg != null || orbit.flight_azimuth_deg != null;
          if (hasDirection) hasDocDirection = true;
          if (orbit.flight_azimuth_deg != null) hasDocAzimuth = true;

          const fieldConfidence = estimateFieldConfidence(orbit);
          const confidence = estimateConfidence({
            candidateTier: candidate.tier,
            orbit,
            derived: false,
            fieldConfidence
          });

          constraintRows.push({
            launch_id: launchId,
            source: 'presskit_auto',
            source_id: doc.id,
            constraint_type: 'target_orbit',
            confidence,
            ingestion_run_id: runId,
            source_hash: doc.sha256,
            extracted_field_map: buildExtractedFieldMap(orbit),
            parse_rule_id: 'orbit_numeric_extract_v1',
            parser_version: PARSE_VERSION,
            license_class: candidate.tier === 'truth' ? 'public_official' : 'public_fallback',
            data: {
              ...orbit,
              fieldConfidence,
              sourceUrl: doc.url,
              documentId: doc.id,
              documentHash: doc.sha256,
              fetchedAt: doc.fetched_at,
              contentType: doc.content_type,
              sourceTier: candidate.tier,
              sourceCandidateScore: candidate.score,
              sourceCandidateReasons: candidate.reasons,
              discoveredFrom: candidate.from,
              parserVersion: PARSE_VERSION
            },
            fetched_at: new Date().toISOString()
          });
          coverage.docsWithParsedOrbit += 1;
          coverage.constraintsPrepared += 1;
        } catch (err) {
          const message = stringifyError(err);
          if (message === 'doc_fetch_404') {
            stats.docsNotFound = (stats.docsNotFound as number) + 1;
            docCache.set(candidate.url, { status: 'not_found' });
            continue;
          }
          docCache.set(candidate.url, { status: 'error', error: message });
          (stats.errors as any[]).push({
            step: 'candidate',
            error: message,
            context: { launchId, url: candidate.url }
          });
        }
      }

      if (!hasDocDirection) {
        const supgpDerived = await deriveOrbitFromSupgp({ supabase, launch });
        if (supgpDerived) {
          (stats.constraintsSupgpDerived as number) = (stats.constraintsSupgpDerived as number) + 1;
          constraintRows.push({
            launch_id: launchId,
            source: supgpDerived.source,
            source_id: supgpDerived.sourceId,
            constraint_type: 'target_orbit',
            confidence: supgpDerived.confidence,
            ingestion_run_id: runId,
            source_hash: supgpDerived.sourceHash,
            extracted_field_map: buildExtractedFieldMap(supgpDerived.orbit),
            parse_rule_id: 'supgp_prelaunch_match_v1',
            parser_version: PARSE_VERSION,
            license_class: 'public_celestrak',
            data: {
              ...supgpDerived.orbit,
              orbitType: supgpDerived.orbitType,
              derived: true,
              derivedNotes: supgpDerived.notes,
              parserVersion: PARSE_VERSION
            },
            fetched_at: new Date().toISOString()
          });
          hasDocDirection = true;
          coverage.usedSupgp = true;
          coverage.constraintsPrepared += 1;
        }
      }

      if (!hasDocAzimuth) {
        const hazardDerived = deriveOrbitFromHazards(launch, hazardsByLaunchId.get(launchId) ?? []);
        if (hazardDerived) {
          (stats.constraintsHazardDerived as number) = (stats.constraintsHazardDerived as number) + 1;
          constraintRows.push({
            launch_id: launchId,
            source: hazardDerived.source,
            source_id: hazardDerived.sourceId,
            constraint_type: 'target_orbit',
            confidence: hazardDerived.confidence,
            ingestion_run_id: runId,
            source_hash: hazardDerived.sourceHash,
            extracted_field_map: buildExtractedFieldMap(hazardDerived.orbit),
            parse_rule_id: 'hazard_azimuth_derive_v1',
            parser_version: PARSE_VERSION,
            license_class: 'public_derived',
            data: {
              ...hazardDerived.orbit,
              orbitType: hazardDerived.orbitType,
              derived: true,
              derivedNotes: hazardDerived.notes,
              parserVersion: PARSE_VERSION
            },
            fetched_at: new Date().toISOString()
          });
          hasDocAzimuth = true;
          coverage.usedHazard = true;
          coverage.constraintsPrepared += 1;
        }
      }

      if (!hasDocDirection) {
        const derived = deriveOrbitFromLaunch(launch);
        if (derived) {
          (stats.constraintsDerived as number) = (stats.constraintsDerived as number) + 1;
          constraintRows.push({
            launch_id: launchId,
            source: derived.source,
            source_id: derived.sourceId,
            constraint_type: 'target_orbit',
            confidence: derived.confidence,
            ingestion_run_id: runId,
            source_hash: derived.sourceHash,
            extracted_field_map: buildExtractedFieldMap(derived.orbit),
            parse_rule_id: 'launch_family_heuristic_v1',
            parser_version: PARSE_VERSION,
            license_class: 'derived_internal',
            data: {
              ...derived.orbit,
              orbitType: derived.orbitType,
              derived: true,
              derivedNotes: derived.notes,
              padLatitude: launch.pad_latitude ?? null,
              padLongitude: launch.pad_longitude ?? null,
              padName: launch.pad_name ?? null,
              locationName: launch.location_name ?? null,
              missionName: launch.mission_name ?? null,
              vehicle: launch.vehicle ?? null,
              provider: launch.provider ?? null,
              parserVersion: PARSE_VERSION
            },
            fetched_at: new Date().toISOString()
          });
          coverage.usedHeuristic = true;
          coverage.constraintsPrepared += 1;
        }
      }

      (stats.launchCoverage as Array<typeof coverage>).push(coverage);
    }

    if (!constraintRows.length) {
      stats.trajectoryProductsTrigger = await triggerEdgeJob({
        supabase,
        jobSlug: 'trajectory-products-generate',
        coalesce: TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE
      });
      await finishIngestionRun(supabase, runId, true, { ...stats, constraintsUpserted: 0 });
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const merged = await upsertTrajectoryConstraintsIfChanged(supabase, constraintRows);
    stats.constraintsMergedInput = merged.input;
    stats.constraintsInserted = merged.inserted;
    stats.constraintsUpdated = merged.updated;
    stats.constraintsSkipped = merged.skipped;
    stats.constraintsUpserted = merged.inserted + merged.updated;
    stats.mergeFallback = merged.usedFallback;
    stats.trajectoryProductsTrigger = await triggerEdgeJob({
      supabase,
      jobSlug: 'trajectory-products-generate',
      coalesce: TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE
    });
    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as any[]).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function buildUrlCandidates({
  launch,
  truthDomains,
  fallbackDomains
}: {
  launch: CandidateLaunch;
  truthDomains: string[];
  fallbackDomains: string[];
}): UrlCandidate[] {
  const seen = new Set<string>();
  const raw: Array<{ url: string; title: string | null; from: UrlCandidate['from'] }> = [];

  for (const entry of extractUrlsFromInfoList(launch.mission_info_urls, 'mission_info_urls')) raw.push(entry);
  for (const entry of extractUrlsFromInfoList(launch.launch_info_urls, 'launch_info_urls')) raw.push(entry);
  for (const entry of buildDerivedUrlsForLaunch(launch)) raw.push(entry);

  const scored: UrlCandidate[] = [];
  for (const row of raw) {
    const normalized = normalizeUrl(row.url);
    if (!normalized) continue;
    const rewritten = rewriteUrl(normalized);
    const url = rewritten?.url ?? normalized;
    const from = rewritten?.from ?? row.from;

    if (seen.has(url)) continue;
    seen.add(url);

    const score = scoreUrlCandidate({ url, title: row.title, truthDomains, fallbackDomains });
    if (!score) continue;
    scored.push({ url, title: row.title, from, ...score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

function buildDerivedUrlsForLaunch(launch: CandidateLaunch): Array<{ url: string; title: string | null; from: 'derived' }> {
  const provider = (launch.provider || '').toLowerCase();
  const mission = (launch.mission_name || launch.name || '').toLowerCase();
  const out: Array<{ url: string; title: string | null; from: 'derived' }> = [];

  if (provider.includes('spacex')) {
    if (mission.includes('starlink')) {
      out.push({
        url: 'https://starlink.com/public-files/space_station_conjunction_avoidance.pdf',
        title: 'Starlink conjunction avoidance (public file)',
        from: 'derived'
      });
      out.push({
        url: 'https://starlink.com/public-files/Gen2StarlinkSatellites.pdf',
        title: 'Gen2 Starlink Satellites (public file)',
        from: 'derived'
      });
    }
    return out;
  }

  if (provider.includes('united launch alliance') || provider.includes('ula')) {
    const missionSlug = buildUlaMissionSlug(launch);
    if (missionSlug) {
      out.push({
        url: `https://www.ulalaunch.com/missions/next-launch/${missionSlug}`,
        title: `ULA mission page (${missionSlug})`,
        from: 'derived'
      });
      out.push({
        url: `https://www.ulalaunch.com/missions/${missionSlug}`,
        title: `ULA mission page fallback (${missionSlug})`,
        from: 'derived'
      });
    }
    out.push({
      url: 'https://www.ulalaunch.com/missions',
      title: 'ULA mission index',
      from: 'derived'
    });
  }

  if (provider.includes('arianespace')) {
    out.push({
      url: 'https://newsroom.arianespace.com/',
      title: 'Arianespace newsroom',
      from: 'derived'
    });
  }

  if (provider.includes('arianegroup') || provider.includes('ariane group')) {
    out.push({
      url: 'https://ariane.group/en/',
      title: 'ArianeGroup mission index',
      from: 'derived'
    });
  }

  if (provider.includes('isro')) {
    out.push({
      url: 'https://www.isro.gov.in/missions',
      title: 'ISRO missions',
      from: 'derived'
    });
  }

  if (provider.includes('rocket lab')) {
    out.push({
      url: 'https://rocketlabcorp.com/missions/',
      title: 'Rocket Lab missions',
      from: 'derived'
    });
    out.push({
      url: 'https://rocketlabcorp.com/updates/',
      title: 'Rocket Lab updates',
      from: 'derived'
    });
  }

  if (provider.includes('blue origin')) {
    out.push({
      url: 'https://www.blueorigin.com/news',
      title: 'Blue Origin news',
      from: 'derived'
    });
    out.push({
      url: 'https://www.blueorigin.com/new-glenn',
      title: 'Blue Origin New Glenn',
      from: 'derived'
    });
  }

  if (provider.includes('nasa')) {
    out.push({
      url: 'https://www.nasa.gov/missions/',
      title: 'NASA missions',
      from: 'derived'
    });
  }

  if (provider.includes('jaxa')) {
    out.push({
      url: 'https://global.jaxa.jp/projects/rockets/h3/',
      title: 'JAXA H3 program',
      from: 'derived'
    });
  }

  return out;
}

function selectCandidates(candidates: UrlCandidate[], limit: number) {
  if (!candidates.length || limit <= 0) return [];

  const selected: UrlCandidate[] = [];
  const selectedUrls = new Set<string>();
  const truth = candidates.filter((c) => c.tier === 'truth');
  const fallback = candidates.filter((c) => c.tier === 'fallback');

  const take = (pool: UrlCandidate[], count: number) => {
    if (count <= 0) return;
    let added = 0;
    for (const candidate of pool) {
      if (selectedUrls.has(candidate.url)) continue;
      selected.push(candidate);
      selectedUrls.add(candidate.url);
      added += 1;
      if (selected.length >= limit || added >= count) break;
    }
  };

  if (limit === 1) {
    take(candidates, 1);
    return selected.slice(0, 1);
  }

  const truthTarget = limit >= 3 ? 2 : 1;
  take(truth, truthTarget);
  if (selected.length < limit) take(fallback, 1);
  if (selected.length < limit) take(candidates, limit);

  return selected.slice(0, limit);
}

function extractUrlsFromInfoList(
  value: unknown,
  from: Exclude<UrlCandidate['from'], 'derived'>
): Array<{ url: string; title: string | null; from: Exclude<UrlCandidate['from'], 'derived'> }> {
  const out: Array<{ url: string; title: string | null; from: Exclude<UrlCandidate['from'], 'derived'> }> = [];
  const list = Array.isArray(value) ? value : [];
  for (const item of list as any[]) {
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!url) continue;
    const title =
      typeof item?.title === 'string'
        ? item.title.trim()
        : typeof item?.description === 'string'
          ? item.description.trim()
          : null;
    out.push({ url, title: title || null, from });
  }
  return out;
}

function rewriteUrl(url: string): { url: string; from: 'derived' } | null {
  const rewritten = rewriteSpaceXLaunchUrlToApi(url);
  if (rewritten) return { url: rewritten, from: 'derived' };
  return null;
}

function rewriteSpaceXLaunchUrlToApi(url: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'spacex.com') return null;
  const m = parsed.pathname.match(/^\/launches\/([^\/?#]+)\/?$/i);
  if (!m) return null;
  const slug = String(m[1] || '').trim();
  if (!slug) return null;
  return `https://content.spacex.com/api/spacex-website/missions/${encodeURIComponent(slug)}`;
}

function normalizeUrl(url: string) {
  const raw = (url || '').trim();
  if (!raw) return null;
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') return null;
  parsed.hash = '';
  return parsed.toString();
}

function parseDomainList(value: string) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (value || '').split(',')) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function scoreUrlCandidate({
  url,
  title,
  truthDomains,
  fallbackDomains
}: {
  url: string;
  title: string | null;
  truthDomains: string[];
  fallbackDomains: string[];
}): { score: number; tier: 'truth' | 'fallback'; reasons: string[] } | null {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

  const isPdf = parsed.pathname.toLowerCase().endsWith('.pdf');
  const urlLower = url.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  let domainTier: 'truth' | 'fallback' | null = null;
  let domainScore = 0;

  if (truthDomains.some((d) => d && host === d || host.endsWith(`.${d}`))) {
    domainTier = 'truth';
    domainScore = 100;
  } else if (
    fallbackDomains.some((d) => {
      if (!d) return false;
      if (d.startsWith('.')) return host.endsWith(d);
      return host === d || host.endsWith(`.${d}`);
    })
  ) {
    domainTier = 'fallback';
    domainScore = 70;
  } else {
    return null;
  }

  let score = domainScore;
  const reasons: string[] = [`domain=${domainScore}`];

  if (isPdf) {
    score += 20;
    reasons.push('pdf=20');
  } else {
    score += 5;
    reasons.push('doc=5');
  }

  if (urlLower.includes('api/spacex-website/missions/')) {
    score += 12;
    reasons.push('spacex_api=12');
  }

  const urlKeywordBoosts: Array<{ needle: string; score: number; reason: string }> = [
    { needle: 'press', score: 6, reason: 'kw_url_press=6' },
    { needle: 'press-kit', score: 6, reason: 'kw_url_press_kit=6' },
    { needle: 'presskit', score: 6, reason: 'kw_url_presskit=6' },
    { needle: 'mission', score: 4, reason: 'kw_url_mission=4' },
    { needle: 'flight-profile', score: 8, reason: 'kw_url_flight_profile=8' },
    { needle: 'payload-user', score: 8, reason: 'kw_url_payload_user=8' },
    { needle: 'fact-sheet', score: 7, reason: 'kw_url_fact_sheet=7' },
    { needle: 'mission-brief', score: 8, reason: 'kw_url_mission_brief=8' },
    { needle: 'flight', score: 3, reason: 'kw_url_flight=3' },
    { needle: 'mob', score: 4, reason: 'kw_url_mob=4' }
  ];
  for (const boost of urlKeywordBoosts) {
    if (!urlLower.includes(boost.needle)) continue;
    score += boost.score;
    reasons.push(boost.reason);
  }

  const titleKeywordBoosts: Array<{ needle: string; score: number; reason: string }> = [
    { needle: 'press', score: 4, reason: 'kw_title_press=4' },
    { needle: 'press kit', score: 6, reason: 'kw_title_press_kit=6' },
    { needle: 'mission overview', score: 6, reason: 'kw_title_mission_overview=6' },
    { needle: 'mission brief', score: 7, reason: 'kw_title_mission_brief=7' },
    { needle: 'flight profile', score: 8, reason: 'kw_title_flight_profile=8' },
    { needle: 'payload user', score: 8, reason: 'kw_title_payload_user=8' },
    { needle: 'fact sheet', score: 7, reason: 'kw_title_fact_sheet=7' }
  ];
  for (const boost of titleKeywordBoosts) {
    if (!titleLower.includes(boost.needle)) continue;
    score += boost.score;
    reasons.push(boost.reason);
  }

  return { score, tier: domainTier, reasons };
}

type LatestDocMeta = { id: string; etag: string | null; lastModified: string | null } | null;

async function loadLatestDocMeta(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  url: string
): Promise<LatestDocMeta> {
  const { data, error } = await supabase
    .from('trajectory_source_documents')
    .select('id,etag,last_modified')
    .eq('url', url)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: String((data as any).id), etag: (data as any).etag ?? null, lastModified: (data as any).last_modified ?? null };
}

async function loadDocById(supabase: ReturnType<typeof createSupabaseAdminClient>, id: string): Promise<DocRow | null> {
  const { data, error } = await supabase
    .from('trajectory_source_documents')
    .select('id,url,sha256,content_type,extracted_text,fetched_at')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String((data as any).id),
    url: String((data as any).url),
    sha256: String((data as any).sha256),
    content_type: ((data as any).content_type as string | null) ?? null,
    extracted_text: ((data as any).extracted_text as string | null) ?? null,
    fetched_at: String((data as any).fetched_at)
  };
}

async function loadDocByUrlAndHash(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  url: string,
  sha256: string
): Promise<DocRow | null> {
  const { data, error } = await supabase
    .from('trajectory_source_documents')
    .select('id,url,sha256,content_type,extracted_text,fetched_at')
    .eq('url', url)
    .eq('sha256', sha256)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String((data as any).id),
    url: String((data as any).url),
    sha256: String((data as any).sha256),
    content_type: ((data as any).content_type as string | null) ?? null,
    extracted_text: ((data as any).extracted_text as string | null) ?? null,
    fetched_at: String((data as any).fetched_at)
  };
}

type FetchResult = {
  notModified: boolean;
  bytes: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  httpStatus: number;
};

async function fetchDocument(url: string, latest: LatestDocMeta): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    accept: 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };
  if (latest?.etag) headers['If-None-Match'] = latest.etag;
  if (latest?.lastModified) {
    const parsed = new Date(latest.lastModified);
    if (!Number.isNaN(parsed.getTime())) {
      headers['If-Modified-Since'] = parsed.toUTCString();
    }
  }

  let lastError: string | null = null;

  for (let attempt = 0; attempt < DOC_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), DOC_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status === 304) {
        return {
          notModified: true,
          bytes: new Uint8Array(),
          etag: latest?.etag ?? null,
          lastModified: latest?.lastModified ?? null,
          contentType: null,
          httpStatus: 304
        };
      }
      if (!res.ok) {
        throw new Error(`doc_fetch_${res.status}`);
      }

      const contentLength = Number(res.headers.get('content-length') || NaN);
      if (Number.isFinite(contentLength) && contentLength > DOC_FETCH_MAX_BYTES) {
        throw new Error('doc_fetch_too_large');
      }

      const arr = new Uint8Array(await res.arrayBuffer());
      if (arr.length > DOC_FETCH_MAX_BYTES) {
        throw new Error('doc_fetch_too_large');
      }

      const etag = res.headers.get('etag');
      const lastModifiedHeader = res.headers.get('last-modified');
      const parsedLastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
      const lastModified =
        parsedLastModified && !Number.isNaN(parsedLastModified.getTime()) ? parsedLastModified.toISOString() : null;
      const contentType = res.headers.get('content-type');
      return {
        notModified: false,
        bytes: arr,
        etag: etag ? etag.trim() : null,
        lastModified: lastModified ? lastModified.trim() : null,
        contentType: contentType ? contentType.trim() : null,
        httpStatus: res.status
      };
    } catch (err) {
      const msg = stringifyError(err);
      const timeoutAbort = msg.includes('abort') || msg.includes('timed') || msg.includes('timeout');
      lastError = timeoutAbort ? 'doc_fetch_timeout' : msg;
      if (attempt + 1 < DOC_FETCH_RETRIES) {
        await sleep(200 * Math.pow(2, attempt));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError || 'doc_fetch_failed');
}

async function insertDocVersion(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  args: { url: string; fetched: FetchResult; sha256: string; extractedText: string; title: string | null; raw: unknown }
): Promise<DocRow | null> {
  const row = {
    url: sanitizeDbText(args.url),
    kind: 'orbit_doc',
    fetched_at: new Date().toISOString(),
    http_status: args.fetched.httpStatus,
    etag: sanitizeOptionalDbText(args.fetched.etag),
    last_modified: sanitizeOptionalDbText(args.fetched.lastModified),
    sha256: sanitizeDbText(args.sha256),
    bytes: args.fetched.bytes.length,
    content_type: sanitizeOptionalDbText(args.fetched.contentType),
    title: sanitizeOptionalDbText(args.title),
    extracted_text: cleanText(args.extractedText),
    raw: sanitizeJsonForDb(args.raw),
    parse_version: PARSE_VERSION
  };

  const { data, error } = await supabase
    .from('trajectory_source_documents')
    .insert(row)
    .select('id,url,sha256,content_type,extracted_text,fetched_at')
    .single();
  if (error || !data) {
    const existing = await loadDocByUrlAndHash(supabase, args.url, args.sha256);
    return existing ?? null;
  }
  return {
    id: String((data as any).id),
    url: String((data as any).url),
    sha256: String((data as any).sha256),
    content_type: ((data as any).content_type as string | null) ?? null,
    extracted_text: ((data as any).extracted_text as string | null) ?? null,
    fetched_at: String((data as any).fetched_at)
  };
}

async function extractText({ url, contentType, bytes }: { url: string; contentType: string | null; bytes: Uint8Array }) {
  const urlLower = url.toLowerCase();
  const isJson =
    urlLower.includes('/api/spacex-website/missions/') ||
    (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json'));
  const isPdf =
    urlLower.endsWith('.pdf') || (typeof contentType === 'string' && contentType.toLowerCase().includes('application/pdf'));

  if (isPdf) {
    const pdfjs = await loadPdfJsModule();
    if (!pdfjs || typeof (pdfjs as any).getDocument !== 'function') {
      return { text: '', title: null, meta: { kind: 'pdf', error: 'pdfjs_unavailable' } };
    }

    try {
      ensurePdfWorkerSrc(pdfjs);
      const task = (pdfjs as any).getDocument({ data: bytes, disableWorker: true });
      const doc = await task.promise;
      let content = '';
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const chunks = (textContent.items as any[])
          .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean);
        content += chunks.join(' ') + '\n';
      }
      return { text: cleanText(content), title: null, meta: { kind: 'pdf', pages: doc.numPages } };
    } catch (err) {
      return { text: '', title: null, meta: { kind: 'pdf', error: stringifyError(err) } };
    }
  }

  const decoded = new TextDecoder().decode(bytes);
  if (isJson) {
    try {
      const obj = JSON.parse(decoded) as any;
      const title = typeof obj?.title === 'string' ? obj.title.trim() : null;
      const parts: string[] = [];
      if (title) parts.push(title);
      const missionId = typeof obj?.missionId === 'string' ? obj.missionId.trim() : null;
      if (missionId) parts.push(`missionId: ${missionId}`);

      const paragraphs = Array.isArray(obj?.paragraphs) ? obj.paragraphs : [];
      for (const p of paragraphs) {
        const content = typeof p?.content === 'string' ? p.content : '';
        const stripped = content ? stripHtml(content) : '';
        if (stripped) parts.push(stripped);
      }

      const timelineEntries = Array.isArray(obj?.postLaunchTimeline?.timelineEntries)
        ? obj.postLaunchTimeline.timelineEntries
        : [];
      for (const entry of timelineEntries) {
        const time = typeof entry?.time === 'string' ? entry.time.trim() : '';
        const desc = typeof entry?.description === 'string' ? stripHtml(entry.description).trim() : '';
        if (!time && !desc) continue;
        parts.push([time, desc].filter(Boolean).join(' '));
      }

      return {
        text: cleanText(parts.join('\n')),
        title,
        meta: { kind: 'json', title, missionId, paragraphs: paragraphs.length, timelineEntries: timelineEntries.length }
      };
    } catch {
      // Fall through to plaintext cleanup.
    }
  }

  const stripped = stripHtml(decoded);
  const title = extractTitle(decoded);
  return { text: cleanText(stripped), title, meta: { kind: 'html', title } };
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  if (!m) return null;
  const t = decodeHtml(m[1] || '').trim();
  return t || null;
}

function stripHtml(html: string) {
  return decodeHtml(html.replace(/<[^>]+>/g, ' '));
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function sanitizeDbText(value: string) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .trim();
}

function sanitizeOptionalDbText(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeDbText(value);
  return cleaned || null;
}

function sanitizeJsonForDb(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonForDb(entry));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeJsonForDb(entry);
    }
    return out;
  }
  return value;
}

function cleanText(text: string) {
  const sanitized = sanitizeDbText(text);
  const trimmed = sanitized.replace(/\s+/g, ' ').trim();
  const max = 300_000;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function estimateConfidence({
  candidateTier,
  orbit,
  derived,
  fieldConfidence
}: {
  candidateTier: 'truth' | 'fallback';
  orbit: { inclination_deg: number | null; flight_azimuth_deg: number | null; orbit_class: string | null };
  derived: boolean;
  fieldConfidence?: ReturnType<typeof estimateFieldConfidence>;
}) {
  let c = derived ? 0.62 : candidateTier === 'truth' ? 0.9 : 0.75;
  if (orbit.flight_azimuth_deg != null) c += 0.07;
  if (orbit.inclination_deg != null) c += 0.03;
  if (orbit.inclination_deg == null && orbit.flight_azimuth_deg == null && orbit.orbit_class != null) c = Math.min(c, 0.6);
  if (fieldConfidence) {
    c = c * 0.7 + fieldConfidence.overall * 0.3;
  }
  return clamp(c, 0, 0.99);
}

function estimateFieldConfidence(orbit: {
  inclination_deg: number | null;
  flight_azimuth_deg: number | null;
  altitude_km?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  orbit_class?: string | null;
}) {
  const direction =
    orbit.flight_azimuth_deg != null ? 0.96 : orbit.inclination_deg != null ? 0.82 : orbit.orbit_class ? 0.58 : 0.2;
  const orbitShape =
    orbit.altitude_km != null || orbit.apogee_km != null || orbit.perigee_km != null
      ? 0.86
      : orbit.orbit_class
        ? 0.55
        : 0.2;
  const overall = clamp((direction * 0.65 + orbitShape * 0.35), 0, 0.99);
  return {
    direction,
    orbitShape,
    overall
  };
}

function buildExtractedFieldMap(orbit: {
  inclination_deg: number | null;
  flight_azimuth_deg: number | null;
  altitude_km?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  orbit_class?: string | null;
}) {
  const hasDirection = orbit.flight_azimuth_deg != null || orbit.inclination_deg != null;
  return {
    inclination_deg: orbit.inclination_deg != null,
    flight_azimuth_deg: orbit.flight_azimuth_deg != null,
    altitude_km: orbit.altitude_km != null,
    apogee_km: orbit.apogee_km != null,
    perigee_km: orbit.perigee_km != null,
    orbit_class: orbit.orbit_class != null,
    has_direction: hasDirection
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
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

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

type HazardConstraintRow = {
  launch_id: string;
  source: string | null;
  source_id: string | null;
  data: any;
  geometry: any;
  confidence: number | null;
};

async function loadHazardsByLaunchId(supabase: ReturnType<typeof createSupabaseAdminClient>, launchIds: string[]) {
  const out = new Map<string, HazardConstraintRow[]>();
  const ids = Array.from(new Set(launchIds.filter(Boolean)));
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from('launch_trajectory_constraints')
    .select('launch_id,source,source_id,data,geometry,confidence')
    .in('launch_id', ids)
    .eq('constraint_type', 'hazard_area');

  if (error) return out;
  for (const row of (Array.isArray(data) ? data : []) as any[]) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    if (!launchId) continue;
    const list = out.get(launchId) || [];
    list.push({
      launch_id: launchId,
      source: typeof row?.source === 'string' ? row.source : null,
      source_id: typeof row?.source_id === 'string' ? row.source_id : null,
      data: row?.data ?? null,
      geometry: row?.geometry ?? null,
      confidence: typeof row?.confidence === 'number' ? row.confidence : null
    });
    out.set(launchId, list);
  }
  return out;
}

function shouldAttemptDerivedOrbit(launch: CandidateLaunch) {
  return deriveOrbitFromLaunch(launch) != null;
}

type SupgpOrbitRow = {
  group_or_source: string | null;
  epoch: string | null;
  inclination_deg: number | null;
  mean_motion_rev_per_day: number | null;
  eccentricity: number | null;
  fetched_at: string | null;
  raw_omm: Record<string, unknown> | null;
  match: SupgpRowMatch;
};

async function deriveOrbitFromSupgp({
  supabase,
  launch
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launch: CandidateLaunch;
}) {
  const searchPlan = buildSupgpSearchPlan({
    provider: launch.provider,
    vehicle: launch.vehicle,
    name: launch.name,
    missionName: launch.mission_name,
    missionOrbit: launch.mission_orbit
  });
  if (!searchPlan.queryTerms.length) return null;

  const netMs = launch.net ? Date.parse(launch.net) : NaN;
  const minEpochIso = Number.isFinite(netMs) ? new Date(netMs - 45 * 24 * 60 * 60 * 1000).toISOString() : null;
  const maxEpochIso = Number.isFinite(netMs) ? new Date(netMs + 15 * 24 * 60 * 60 * 1000).toISOString() : null;

  const dedupe = new Set<string>();
  const rows: SupgpOrbitRow[] = [];

  for (const key of searchPlan.queryTerms) {
    let query = supabase
      .from('orbit_elements')
      .select('group_or_source,epoch,inclination_deg,mean_motion_rev_per_day,eccentricity,fetched_at,raw_omm')
      .eq('source', 'supgp')
      .ilike('group_or_source', `%${key}%`)
      .order('epoch', { ascending: false })
      .limit(180);

    if (minEpochIso) query = query.gte('epoch', minEpochIso);
    if (maxEpochIso) query = query.lte('epoch', maxEpochIso);

    const { data, error } = await query;
    if (error || !Array.isArray(data)) continue;

    for (const raw of data as any[]) {
      const match = scoreSupgpOrbitRowMatch(searchPlan, {
        group_or_source: typeof raw?.group_or_source === 'string' ? raw.group_or_source : null,
        raw_omm: raw?.raw_omm && typeof raw.raw_omm === 'object' && !Array.isArray(raw.raw_omm) ? raw.raw_omm : null
      });
      if (!match) continue;

      const group = typeof raw?.group_or_source === 'string' ? raw.group_or_source.trim() : '';
      const epoch = typeof raw?.epoch === 'string' ? raw.epoch : '';
      if (!group || !epoch) continue;
      const rowKey = `${group}|${epoch}|${match.groupKey}`;
      if (dedupe.has(rowKey)) continue;
      dedupe.add(rowKey);
      rows.push({
        group_or_source: group,
        epoch,
        inclination_deg: typeof raw?.inclination_deg === 'number' ? raw.inclination_deg : null,
        mean_motion_rev_per_day: typeof raw?.mean_motion_rev_per_day === 'number' ? raw.mean_motion_rev_per_day : null,
        eccentricity: typeof raw?.eccentricity === 'number' ? raw.eccentricity : null,
        fetched_at: typeof raw?.fetched_at === 'string' ? raw.fetched_at : null,
        raw_omm: raw?.raw_omm && typeof raw.raw_omm === 'object' && !Array.isArray(raw.raw_omm) ? raw.raw_omm : null,
        match
      });
    }
  }

  if (!rows.length) return null;

  const byGroup = new Map<string, SupgpOrbitRow[]>();
  for (const row of rows) {
    const group = String(row.match.groupKey || '').trim().toLowerCase();
    if (!group) continue;
    const list = byGroup.get(group) || [];
    list.push(row);
    byGroup.set(group, list);
  }

  const candidates: Array<{
    group: string;
    rows: SupgpOrbitRow[];
    inclinationDeg: number;
    inclinationSpreadDeg: number;
    altitudeKm: number | null;
    latestEpochIso: string | null;
    nearestDeltaHours: number | null;
    matchLabel: string;
    matchQuality: SupgpRowMatch['quality'];
    matchScore: number;
    confidence: number;
    score: number;
  }> = [];

  for (const [group, groupRows] of byGroup.entries()) {
    const inclinations = groupRows
      .map((r) => (typeof r.inclination_deg === 'number' && Number.isFinite(r.inclination_deg) ? r.inclination_deg : null))
      .filter((v): v is number => v != null && v > 0 && v < 180);
    if (!inclinations.length) continue;

    const inclinationDeg = median(inclinations);
    const inclinationSpreadDeg = inclinations.length >= 2 ? stddev(inclinations) : 0;

    const meanMotionValues = groupRows
      .map((r) => (typeof r.mean_motion_rev_per_day === 'number' && Number.isFinite(r.mean_motion_rev_per_day) ? r.mean_motion_rev_per_day : null))
      .filter((v): v is number => v != null && v > 0);
    const altitudeKm = meanMotionValues.length ? estimateAltitudeKmFromMeanMotion(median(meanMotionValues)) : null;
    const medianMatchScore = median(
      groupRows
        .map((row) => (typeof row.match?.score === 'number' && Number.isFinite(row.match.score) ? row.match.score : null))
        .filter((value): value is number => value != null && value > 0)
    );
    const exactMatches = groupRows.filter((row) => row.match?.quality === 'exact').length;
    const matchQuality: SupgpRowMatch['quality'] = exactMatches > 0 && exactMatches >= Math.ceil(groupRows.length / 2) ? 'exact' : 'family';
    const bestMatch = [...groupRows].sort((a, b) => b.match.score - a.match.score)[0];
    const matchLabel = bestMatch?.match?.label || group;

    let latestEpochMs = Number.NaN;
    for (const row of groupRows) {
      const epochMs = row.epoch ? Date.parse(row.epoch) : NaN;
      if (!Number.isFinite(epochMs)) continue;
      if (!Number.isFinite(latestEpochMs) || epochMs > latestEpochMs) latestEpochMs = epochMs;
    }
    const latestEpochIso = Number.isFinite(latestEpochMs) ? new Date(latestEpochMs).toISOString() : null;

    let nearestDeltaHours: number | null = null;
    if (Number.isFinite(netMs)) {
      let minDeltaMs = Number.POSITIVE_INFINITY;
      for (const row of groupRows) {
        const epochMs = row.epoch ? Date.parse(row.epoch) : NaN;
        if (!Number.isFinite(epochMs)) continue;
        const delta = Math.abs(epochMs - netMs);
        if (delta < minDeltaMs) minDeltaMs = delta;
      }
      if (Number.isFinite(minDeltaMs) && minDeltaMs < Number.POSITIVE_INFINITY) {
        nearestDeltaHours = minDeltaMs / (60 * 60 * 1000);
      }
    }

    let confidence = matchQuality === 'exact' ? 0.72 : 0.65;
    if (medianMatchScore >= 1.25) confidence += 0.07;
    else if (medianMatchScore >= 1.0) confidence += 0.04;
    if (inclinations.length >= 3) confidence += 0.06;
    if (inclinations.length >= 8) confidence += 0.04;
    if (inclinationSpreadDeg <= 1.0) confidence += 0.05;
    else if (inclinationSpreadDeg > 3.0) confidence -= 0.06;
    if (altitudeKm != null) confidence += 0.05;
    if (nearestDeltaHours != null) {
      if (nearestDeltaHours <= 24) confidence += 0.08;
      else if (nearestDeltaHours <= 72) confidence += 0.05;
      else if (nearestDeltaHours > 240) confidence -= 0.05;
    } else {
      confidence -= 0.03;
    }
    confidence = clamp(confidence, 0.58, 0.93);

    const score = confidence * 100 + medianMatchScore * 8 + groupRows.length * 0.25 - (nearestDeltaHours ?? 240) * 0.08;
    candidates.push({
      group,
      rows: groupRows,
      inclinationDeg,
      inclinationSpreadDeg,
      altitudeKm,
      latestEpochIso,
      nearestDeltaHours,
      matchLabel,
      matchQuality,
      matchScore: medianMatchScore,
      confidence,
      score
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  if (best.confidence < 0.62) return null;

  const notes = [
    `SupGP match: ${best.matchLabel}`,
    `SupGP match quality: ${best.matchQuality}`,
    `SupGP samples: ${best.rows.length}`,
    `Inclination: ${best.inclinationDeg.toFixed(2)} deg`,
    `Inclination spread: ${best.inclinationSpreadDeg.toFixed(2)} deg`,
    `SupGP match score: ${best.matchScore.toFixed(2)}`,
    best.altitudeKm != null ? `Altitude estimate: ${best.altitudeKm.toFixed(0)} km` : null,
    best.nearestDeltaHours != null ? `Nearest SupGP epoch delta: ${best.nearestDeltaHours.toFixed(1)} h` : null,
    best.latestEpochIso ? `Latest SupGP epoch: ${best.latestEpochIso}` : null,
    'Derived from prelaunch SupGP state vectors (CelesTrak supplemental).'
  ].filter(Boolean) as string[];

  const sourceId = best.latestEpochIso ? `supgp:${best.group}:${best.latestEpochIso}` : `supgp:${best.group}`;
  return {
    source: 'celestrak_supgp',
    sourceId,
    sourceHash: sourceId,
    confidence: best.confidence,
    orbitType: 'supgp_prelaunch_match',
    orbit: {
      inclination_deg: best.inclinationDeg,
      flight_azimuth_deg: null,
      altitude_km: best.altitudeKm,
      apogee_km: null,
      perigee_km: null,
      orbit_class: 'LEO'
    },
    notes
  };
}

function estimateAltitudeKmFromMeanMotion(meanMotionRevPerDay: number) {
  if (!Number.isFinite(meanMotionRevPerDay) || meanMotionRevPerDay <= 0) return null;
  const mu = 398600.4418; // km^3/s^2
  const earthRadiusKm = 6378.137;
  const nRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  if (!Number.isFinite(nRadPerSec) || nRadPerSec <= 0) return null;
  const aKm = Math.pow(mu / (nRadPerSec * nRadPerSec), 1 / 3);
  if (!Number.isFinite(aKm)) return null;
  const altitudeKm = aKm - earthRadiusKm;
  if (!Number.isFinite(altitudeKm)) return null;
  return clamp(altitudeKm, 120, 2500);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]) {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function deriveOrbitFromHazards(launch: CandidateLaunch, hazards: HazardConstraintRow[]) {
  const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : null;
  const padLon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : null;
  if (padLat == null || padLon == null) return null;

  const grouped = new Map<string, { source: string; sourceId: string; confidence: number; best: { azDeg: number; distKm: number; meta: any } }>();

  for (const hazard of hazards) {
    const source = normalizeSourceCode(hazard.source);
    const navcenGuid = hazard?.data?.navcenGuid ? String(hazard.data.navcenGuid) : null;
    const faaRecordId =
      hazard?.data?.faaTfrRecordId ? String(hazard.data.faaTfrRecordId) : hazard?.data?.recordId ? String(hazard.data.recordId) : null;
    const rawSourceId = typeof hazard?.source_id === 'string' ? hazard.source_id : null;
    const sourceIdentity = navcenGuid || faaRecordId || rawSourceId;
    if (!sourceIdentity) continue;

    const groupKey = `${source}:${sourceIdentity}`;
    const centroid = centroidFromGeoJson(hazard.geometry);
    if (!centroid) continue;

    const distKm = haversineKm(padLat, padLon, centroid.lat, centroid.lon);
    if (!Number.isFinite(distKm) || distKm < 10) continue;

    const azDeg = bearingDeg(padLat, padLon, centroid.lat, centroid.lon);
    const conf =
      typeof hazard.confidence === 'number' && Number.isFinite(hazard.confidence)
        ? hazard.confidence
        : source === 'faa_tfr'
          ? 0.8
          : 0.7;
    const areaName = hazard?.data?.areaName ? String(hazard.data.areaName) : null;
    const sourceUrl = hazard?.data?.sourceUrl ? String(hazard.data.sourceUrl) : null;
    const title = hazard?.data?.title ? String(hazard.data.title) : null;
    const notamId = hazard?.data?.notamId ? String(hazard.data.notamId) : null;

    const existing = grouped.get(groupKey) ?? null;
    const nextConf = Math.max(existing?.confidence ?? 0, conf);
    const best =
      !existing || distKm > existing.best.distKm
        ? { azDeg, distKm, meta: { areaName, sourceUrl, title, notamId, navcenGuid, faaRecordId } }
        : existing.best;
    grouped.set(groupKey, {
      source,
      sourceId: sourceIdentity,
      confidence: nextConf,
      best
    });
  }

  if (!grouped.size) return null;

  const candidates = [...grouped.entries()].map(([groupKey, row]) => ({ groupKey, ...row }));
  candidates.sort((a, b) => b.confidence - a.confidence || b.best.distKm - a.best.distKm);
  const top = candidates[0];
  if (!top) return null;

  const confidence = clamp((top.confidence || 0.7) - 0.03, 0.52, 0.92);
  const notes = [
    `Hazard source: ${top.source}`,
    top.best.meta?.navcenGuid ? `NAVCEN guid: ${String(top.best.meta.navcenGuid)}` : null,
    top.best.meta?.notamId ? `FAA NOTAM: ${String(top.best.meta.notamId)}` : null,
    top.best.meta?.faaRecordId ? `FAA record: ${String(top.best.meta.faaRecordId)}` : null,
    top.best.meta?.title ? `Hazard title: ${String(top.best.meta.title)}` : null,
    top.best.meta?.areaName ? `Hazard area: ${String(top.best.meta.areaName)}` : null,
    top.best.meta?.sourceUrl ? `Hazard source: ${String(top.best.meta.sourceUrl)}` : null,
    `Hazard centroid distance: ${Math.round(top.best.distKm)} km`,
    `Azimuth: ${top.best.azDeg.toFixed(1)}° (hazard-derived)`
  ].filter(Boolean) as string[];

  return {
    source: top.source,
    sourceId: `hazard:${top.source}:${top.sourceId}`,
    sourceHash: `hazard:${top.groupKey}`,
    confidence,
    orbitType: 'hazard_azimuth_estimate',
    orbit: {
      inclination_deg: null,
      flight_azimuth_deg: top.best.azDeg,
      altitude_km: null,
      apogee_km: null,
      perigee_km: null,
      orbit_class: null
    },
    notes
  };
}

function normalizeSourceCode(source: string | null) {
  const raw = String(source || '').trim().toLowerCase();
  if (!raw) return 'hazard_area';
  return raw.replace(/[^a-z0-9_:-]+/g, '_').replace(/_+/g, '_');
}

async function upsertTrajectoryConstraintsIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_trajectory_constraints_if_changed', {
    rows_in: rows
  });
  if (!error) {
    const stats = asPlainObject(data);
    return {
      input: readInt(stats.input),
      inserted: readInt(stats.inserted),
      updated: readInt(stats.updated),
      skipped: readInt(stats.skipped),
      usedFallback: false
    };
  }

  console.warn('upsert_launch_trajectory_constraints_if_changed failed; falling back to upsert', error);
  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_trajectory_constraints')
    .upsert(rows, { onConflict: 'launch_id,source,constraint_type,source_id' })
    .select('id');
  if (fallbackError) throw fallbackError;
  const touched = Array.isArray(fallbackRows) ? fallbackRows.length : rows.length;
  return {
    input: rows.length,
    inserted: 0,
    updated: touched,
    skipped: Math.max(0, rows.length - touched),
    usedFallback: true
  };
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

function centroidFromGeoJson(geometry: unknown): { lat: number; lon: number } | null {
  const geom = geometry as any;
  const type = typeof geom?.type === 'string' ? geom.type : null;
  const coords = geom?.coordinates;
  if (!type || !coords) return null;

  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  const push = (p: any) => {
    if (!Array.isArray(p) || p.length < 2) return;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    sumLat += lat;
    sumLon += lon;
    count += 1;
  };

  if (type === 'Polygon') {
    for (const ring of Array.isArray(coords) ? coords : []) {
      for (const p of Array.isArray(ring) ? ring : []) push(p);
    }
  } else if (type === 'MultiPolygon') {
    for (const poly of Array.isArray(coords) ? coords : []) {
      for (const ring of Array.isArray(poly) ? poly : []) {
        for (const p of Array.isArray(ring) ? ring : []) push(p);
      }
    }
  } else {
    return null;
  }

  if (!count) return null;
  return { lat: sumLat / count, lon: wrapLonDeg(sumLon / count) };
}

function bearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1Deg * toRad;
  const phi2 = lat2Deg * toRad;
  const dLambda = (lon2Deg - lon1Deg) * toRad;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (theta * toDeg + 360) % 360;
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const R = 6371;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function wrapLonDeg(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function deriveOrbitFromLaunch(launch: CandidateLaunch): {
  source: string;
  sourceId: string;
  sourceHash: string;
  confidence: number;
  orbitType: string;
  orbit: ParsedOrbitData;
  notes: string[];
} | null {
  const provider = (launch.provider || '').toLowerCase();
  const mission = (launch.mission_name || launch.name || '').toLowerCase();
  const orbitName = (launch.mission_orbit || '').toLowerCase();
  const padLat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : null;
  const location = (launch.location_name || '').toLowerCase();

  const notes: string[] = [];

  if (provider.includes('spacex')) {
    // Default values based on well-known mission families. These are not mission-unique targets.
    if (mission.includes('starlink')) {
      const fromVandenberg = location.includes('vandenberg') || (padLat != null && padLat >= 33);
      if (fromVandenberg) {
        notes.push('SpaceX Starlink heuristic: Vandenberg high-inclination shell default');
        return {
          source: 'spacex_derived',
          sourceId: 'starlink_vandenberg_shell_v1',
          sourceHash: 'spacex_derived:starlink_vandenberg_shell_v1',
          confidence: 0.6,
          orbitType: 'operational_shell_estimate',
          orbit: {
            inclination_deg: 70,
            flight_azimuth_deg: null,
            altitude_km: 570,
            apogee_km: null,
            perigee_km: null,
            orbit_class: 'LEO'
          },
          notes
        };
      }

      notes.push('SpaceX Starlink heuristic: Cape mid-inclination shell default');
      return {
        source: 'spacex_derived',
        sourceId: 'starlink_cape_shell_v1',
        sourceHash: 'spacex_derived:starlink_cape_shell_v1',
        confidence: 0.6,
        orbitType: 'operational_shell_estimate',
        orbit: {
          inclination_deg: 43,
          flight_azimuth_deg: null,
          altitude_km: 530,
          apogee_km: null,
          perigee_km: null,
          orbit_class: 'LEO'
        },
        notes
      };
    }

    if (mission.startsWith('crew-') || mission.includes('crew dragon') || mission.includes('crs') || orbitName.includes('iss')) {
      notes.push('SpaceX ISS family heuristic: ISS inclination/altitude defaults');
      return {
        source: 'spacex_derived',
        sourceId: 'iss_family_v1',
        sourceHash: 'spacex_derived:iss_family_v1',
        confidence: 0.75,
        orbitType: 'operational_orbit_estimate',
        orbit: {
          inclination_deg: 51.6,
          flight_azimuth_deg: null,
          altitude_km: 400,
          apogee_km: null,
          perigee_km: null,
          orbit_class: 'ISS'
        },
        notes
      };
    }

    if (mission.includes('gps') || orbitName.includes('medium earth')) {
      notes.push('SpaceX GPS family heuristic: typical GPS MEO inclination/altitude');
      return {
        source: 'spacex_derived',
        sourceId: 'gps_meo_v1',
        sourceHash: 'spacex_derived:gps_meo_v1',
        confidence: 0.75,
        orbitType: 'operational_orbit_estimate',
        orbit: {
          inclination_deg: 55,
          flight_azimuth_deg: null,
          altitude_km: 20200,
          apogee_km: null,
          perigee_km: null,
          orbit_class: 'MEO'
        },
        notes
      };
    }

    return null;
  }

  const orbitClass = inferOrbitClassFromLaunch(launch);
  const prior = deriveDirectionalPriorFromOrbitClass({
    orbitClass,
    padLat
  });
  if (!prior) return null;

  notes.push(`Orbit class from launch metadata: ${prior.orbitClass}`);
  notes.push(...prior.notes);
  return {
    source: 'launch_orbit_prior',
    sourceId: prior.sourceId,
    sourceHash: `launch_orbit_prior:${prior.sourceId}`,
    confidence: prior.confidence,
    orbitType: 'doc_orbit_class_prior_v1',
    orbit: {
      inclination_deg: prior.inclinationDeg,
      flight_azimuth_deg: null,
      altitude_km: null,
      apogee_km: null,
      perigee_km: null,
      orbit_class: prior.orbitClass
    },
    notes
  };
}

function buildUlaMissionSlug(launch: CandidateLaunch) {
  const provider = (launch.provider || '').toLowerCase();
  if (!provider.includes('united launch alliance') && !provider.includes('ula')) return null;

  const vehicleText = `${launch.vehicle || ''} ${launch.name || ''}`.toLowerCase();
  const missionText = `${launch.mission_name || ''} ${launch.name || ''}`.toLowerCase();

  let rocketPrefix: string | null = null;
  if (/\bvulcan\b/.test(vehicleText) || /\bvulcan\b/.test(missionText)) rocketPrefix = 'vulcan';
  else if (/\batlas\b/.test(vehicleText)) rocketPrefix = 'atlas-v';
  else if (/\bdelta\b/.test(vehicleText)) rocketPrefix = 'delta-iv-heavy';
  if (!rocketPrefix) return null;

  const programMatchers: Array<{ label: string; re: RegExp }> = [
    { label: 'ussf', re: /\bussf[\s-]?([0-9]{1,4})\b/i },
    { label: 'nrol', re: /\bnrol[\s-]?([0-9]{1,4})\b/i },
    { label: 'gps', re: /\bgps[\s-]*(?:iii[\s-]*)?([0-9]{1,3})\b/i }
  ];
  for (const matcher of programMatchers) {
    const match = missionText.match(matcher.re);
    if (!match) continue;
    const missionNumber = Number(match[1]);
    if (!Number.isFinite(missionNumber) || missionNumber <= 0) continue;
    return `${rocketPrefix}-${matcher.label}-${missionNumber}`;
  }

  return null;
}

function inferOrbitClassFromLaunch(launch: CandidateLaunch) {
  const raw = [launch.mission_orbit, launch.mission_name, launch.name].filter((v): v is string => typeof v === 'string').join(' ');
  if (!raw.trim()) return null;
  const text = raw.toLowerCase();

  if (/\binternational\s+space\s+station\b|\biss\b/.test(text)) return 'ISS';
  if (/\b(?:geostationary|geosynchronous)\s+transfer(?:\s+orbit)?\b|\bgto\b/.test(text)) return 'GTO';
  if (/\bgeostationary\b|\bgeosynchronous\b|\bgeo\b/.test(text)) return 'GEO';
  if (/\bmedium[- ]earth\s+orbit\b|\bmeo\b|\bgps\b/.test(text)) return 'MEO';
  if (/\bsun[- ]?synchronous\b|\bsso\b/.test(text)) return 'SSO';
  if (/\bpolar(?:\s+orbit)?\b/.test(text)) return 'Polar';
  if (/\blow[- ]earth\s+orbit\b|\bleo\b/.test(text)) return 'LEO';
  return null;
}

function deriveDirectionalPriorFromOrbitClass({
  orbitClass,
  padLat
}: {
  orbitClass: string | null;
  padLat: number | null;
}): {
  orbitClass: string;
  sourceId: string;
  inclinationDeg: number;
  confidence: number;
  notes: string[];
} | null {
  const normalized = String(orbitClass || '').trim();
  if (!normalized) return null;
  const upper = normalized.toUpperCase();

  if (upper === 'ISS') {
    return {
      orbitClass: 'ISS',
      sourceId: 'iss_family_prior_v1',
      inclinationDeg: 51.6,
      confidence: 0.68,
      notes: ['ISS prior: fixed inclination 51.6 deg']
    };
  }
  if (upper === 'SSO') {
    return {
      orbitClass: 'SSO',
      sourceId: 'sso_family_prior_v1',
      inclinationDeg: 97.4,
      confidence: 0.65,
      notes: ['SSO prior: fixed inclination 97.4 deg']
    };
  }
  if (upper === 'POLAR') {
    return {
      orbitClass: 'Polar',
      sourceId: 'polar_family_prior_v1',
      inclinationDeg: 90,
      confidence: 0.64,
      notes: ['Polar prior: fixed inclination 90.0 deg']
    };
  }
  if (upper === 'MEO') {
    return {
      orbitClass: 'MEO',
      sourceId: 'meo_family_prior_v1',
      inclinationDeg: 55,
      confidence: 0.62,
      notes: ['MEO prior: fixed inclination 55.0 deg']
    };
  }
  if (upper === 'GEO' || upper === 'GTO') {
    const fromPad = typeof padLat === 'number' && Number.isFinite(padLat);
    const baseInclination = fromPad ? Math.abs(padLat) : 28.5;
    const inclinationDeg = clamp(baseInclination, 5, 70);
    const padLatLabel = fromPad && padLat != null ? padLat.toFixed(3) : 'unknown';
    return {
      orbitClass: upper,
      sourceId: upper === 'GTO' ? 'gto_pad_lat_prior_v1' : 'geo_pad_lat_prior_v1',
      inclinationDeg,
      confidence: fromPad ? 0.58 : 0.54,
      notes: [
        `${upper} prior: inclination seeded from |pad latitude|`,
        `Pad latitude: ${padLatLabel} deg`,
        `Derived inclination: ${inclinationDeg.toFixed(1)} deg`
      ]
    };
  }

  return null;
}
