import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  buildLandingHintConstraintRow,
  buildMissionInfographicConstraintRow,
  buildSpaceXLaunchPageUrl,
  normalizeCmsAsset,
  normalizeOptionalString,
  normalizeUrl,
  sha256Hex,
  type NormalizedCmsAsset
} from '../_shared/spacexInfographicConstraints.ts';

const SPACEX_CONTENT_BASE_URL = 'https://content.spacex.com/api/spacex-website';
const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';

const DEFAULTS = {
  enabled: true,
  limit: 30,
  horizonDays: 90,
  lookbackDays: 30,
  minScore: 0.55
};

type LaunchCandidate = {
  launch_id: string;
  net?: string | null;
  provider?: string | null;
  vehicle?: string | null;
  name?: string | null;
  mission_name?: string | null;
  pad_short_code?: string | null;
  launch_info_urls?: unknown;
  mission_info_urls?: unknown;
};

type SpaceXLaunchTile = {
  missionId: string;
  title?: string | null;
  callToAction?: string | null;
  missionStatus?: string | null;
  vehicle?: string | null;
  returnSite?: string | null;
  returnDateTime?: string | null;
  launchSite?: string | null;
  launchDate?: string | null;
  launchTime?: string | null;
  missionType?: string | null;
  pageUrl?: string | null;
  imageDesktop?: NormalizedCmsAsset | null;
  imageMobile?: NormalizedCmsAsset | null;
};

type TimelineEvent = {
  id: string;
  label: string;
  time?: string | null;
  description?: string | null;
  kind?: string | null;
};

type WebcastEntry = {
  id: string;
  url?: string | null;
  videoId?: string | null;
  platform?: string | null;
  title?: string | null;
  date?: string | null;
  imageUrl?: string | null;
  previewUrl?: string | null;
};

type AstronautEntry = {
  id: string;
  name: string;
  role?: string | null;
  bioLink?: string | null;
  portraitUrl?: string | null;
  previewUrl?: string | null;
};

type ParagraphEntry = {
  id: string;
  title?: string | null;
  text: string;
};

type CarouselEntry = {
  id: string;
  title?: string | null;
  image?: NormalizedCmsAsset | null;
  video?: NormalizedCmsAsset | null;
};

type SpaceXMission = {
  missionId: string;
  title?: string | null;
  callToAction?: string | null;
  followDragonEnabled?: boolean | null;
  returnFromIssEnabled?: boolean | null;
  toTheIssEnabled?: boolean | null;
  toTheIssTense?: string | null;
  imageDesktop?: NormalizedCmsAsset | null;
  imageMobile?: NormalizedCmsAsset | null;
  videoDesktop?: NormalizedCmsAsset | null;
  videoMobile?: NormalizedCmsAsset | null;
  infographicDesktop?: NormalizedCmsAsset | null;
  infographicMobile?: NormalizedCmsAsset | null;
  preLaunchTimeline?: TimelineEvent[];
  postLaunchTimeline?: TimelineEvent[];
  webcasts?: WebcastEntry[];
  astronauts?: AstronautEntry[];
  paragraphs?: ParagraphEntry[];
  carousel?: CarouselEntry[];
};

type TileMatch = {
  tile: SpaceXLaunchTile;
  score: number;
  reasons: string[];
  tilePad: string | null;
  launchPad: string | null;
  dayDiff: number | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'spacex_infographics_ingest');

  try {
    const settings = await getSettings(supabase, [
      'spacex_infographics_job_enabled',
      'spacex_infographics_limit',
      'spacex_infographics_horizon_days'
    ]);

    const enabled = readBooleanSetting(settings.spacex_infographics_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const limit = clampInt(readNumberSetting(settings.spacex_infographics_limit, DEFAULTS.limit), 1, 200);
    const horizonDays = clampInt(readNumberSetting(settings.spacex_infographics_horizon_days, DEFAULTS.horizonDays), 1, 3650);

    const tiles = await fetchLaunchTiles().catch((err) => {
      console.warn('spacex tiles fetch failed', stringifyError(err));
      return [] as SpaceXLaunchTile[];
    });
    const tileByMissionId = new Map<string, SpaceXLaunchTile>();
    for (const tile of tiles) {
      if (tile.missionId) tileByMissionId.set(tile.missionId, tile);
    }

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - DEFAULTS.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launches, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select('launch_id, net, provider, vehicle, name, mission_name, pad_short_code, launch_info_urls, mission_info_urls')
      .ilike('provider', '%SpaceX%')
      .gte('net', fromIso)
      .lte('net', toIso)
      .order('net', { ascending: true })
      .limit(Math.min(limit * 5, 250));

    if (launchesError) throw launchesError;

    const candidates = Array.isArray(launches) ? (launches as LaunchCandidate[]) : [];
    if (!candidates.length) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'no_candidates', fromIso, toIso });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_candidates', fromIso, toIso, elapsedMs: Date.now() - startedAt });
    }

    const stats = {
      candidates: candidates.length,
      considered: 0,
      matched: 0,
      missionsFetched: 0,
      bundleRowsInput: 0,
      bundleRowsInserted: 0,
      bundleRowsUpdated: 0,
      bundleRowsSkipped: 0,
      bundleUpsertFallback: false,
      constraintRowsInput: 0,
      constraintRowsInserted: 0,
      constraintRowsUpdated: 0,
      constraintRowsSkipped: 0,
      constraintUpsertFallback: false,
      skippedNoMatch: 0,
      skippedNoBundle: 0,
      errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
    };

    const bundleRows: Array<Record<string, unknown>> = [];
    const constraintRows: Array<Record<string, unknown>> = [];

    for (const launch of candidates) {
      if (bundleRows.length >= limit) break;
      if (!launch?.launch_id) continue;
      stats.considered += 1;

      const direct =
        pickMissionIdFromInfoUrls(launch.launch_info_urls, 'launch_info_url') ??
        pickMissionIdFromInfoUrls(launch.mission_info_urls, 'mission_info_url');

      let missionId = direct?.missionId ?? null;
      let confidence = direct ? 0.99 : 0;
      let tile: SpaceXLaunchTile | null = direct?.missionId ? tileByMissionId.get(direct.missionId) ?? null : null;
      let match: Record<string, unknown> | null = direct
        ? {
            strategy: direct.strategy,
            confidence,
            url: direct.url,
            launchName: normalizeOptionalString(launch.name),
            launchMission: normalizeOptionalString(launch.mission_name),
            launchVehicle: normalizeOptionalString(launch.vehicle),
            launchPad: normalizeOptionalString(launch.pad_short_code)
          }
        : null;

      if (!missionId) {
        const best = pickBestTile(tiles, launch);
        if (!best || best.score < DEFAULTS.minScore) {
          stats.skippedNoMatch += 1;
          continue;
        }

        missionId = best.tile.missionId;
        confidence = best.score;
        tile = best.tile;
        match = {
          strategy: 'tile_match',
          confidence,
          score: best.score,
          reasons: best.reasons,
          dayDiff: best.dayDiff,
          tilePad: best.tilePad,
          launchPad: best.launchPad,
          launchName: normalizeOptionalString(launch.name),
          launchMission: normalizeOptionalString(launch.mission_name),
          launchVehicle: normalizeOptionalString(launch.vehicle)
        };
      }

      if (!missionId) {
        stats.skippedNoMatch += 1;
        continue;
      }

      const mission = await fetchMission(missionId).catch((err) => {
        pushStatError(stats.errors, 'fetch_mission', err, { missionId, launchId: launch.launch_id });
        return null;
      });
      stats.missionsFetched += 1;
      stats.matched += 1;

      const launchPageUrl = buildSpaceXLaunchPageUrl(missionId);
      const missionTitle = normalizeOptionalString(mission?.title) || normalizeOptionalString(tile?.title) || null;
      const returnSite = normalizeOptionalString(tile?.returnSite) || null;
      const returnDateTime = normalizeOptionalString(tile?.returnDateTime) || null;

      const resources = dedupeResources([
        ...(launchPageUrl
          ? [
              {
                id: `page:${missionId}`,
                kind: 'page',
                label: 'Launch page',
                url: launchPageUrl,
                previewUrl: null,
                mime: null,
                width: null,
                height: null,
                source: 'spacex_content',
                sourceId: missionId
              }
            ]
          : []),
        ...buildAssetResources(missionId, tile, mission),
        ...buildWebcastResources(missionId, mission?.webcasts || []),
        ...buildCarouselResources(missionId, mission?.carousel || [])
      ]);

      const preLaunchTimeline = Array.isArray(mission?.preLaunchTimeline) ? mission.preLaunchTimeline : [];
      const postLaunchTimeline = Array.isArray(mission?.postLaunchTimeline) ? mission.postLaunchTimeline : [];
      const webcasts = Array.isArray(mission?.webcasts) ? mission.webcasts : [];
      const astronauts = Array.isArray(mission?.astronauts) ? mission.astronauts : [];
      const paragraphs = Array.isArray(mission?.paragraphs) ? mission.paragraphs : [];
      const carousel = Array.isArray(mission?.carousel) ? mission.carousel : [];

      const hasBundleData =
        Boolean(missionTitle) ||
        Boolean(returnSite) ||
        Boolean(returnDateTime) ||
        resources.length > 1 ||
        preLaunchTimeline.length > 0 ||
        postLaunchTimeline.length > 0 ||
        webcasts.length > 0 ||
        astronauts.length > 0 ||
        paragraphs.length > 0 ||
        carousel.length > 0;

      if (!hasBundleData) {
        stats.skippedNoBundle += 1;
        continue;
      }

      const bundle = {
        missionId,
        missionTitle,
        launchPageUrl,
        match,
        tile: tile
          ? {
              title: normalizeOptionalString(tile.title),
              callToAction: normalizeOptionalString(tile.callToAction),
              missionStatus: normalizeOptionalString(tile.missionStatus),
              vehicle: normalizeOptionalString(tile.vehicle),
              returnSite,
              returnDateTime,
              launchSite: normalizeOptionalString(tile.launchSite),
              launchDate: normalizeOptionalString(tile.launchDate),
              launchTime: normalizeOptionalString(tile.launchTime),
              missionType: normalizeOptionalString(tile.missionType),
              pageUrl: normalizeOptionalString(tile.pageUrl)
            }
          : null,
        recovery: returnSite || returnDateTime ? { returnSite, returnDateTime } : null,
        returnSite,
        returnDateTime,
        resources,
        preLaunchTimeline,
        postLaunchTimeline,
        timelineCounts: {
          preLaunch: preLaunchTimeline.length,
          postLaunch: postLaunchTimeline.length
        },
        webcasts,
        astronauts,
        paragraphs,
        carousel,
        mission: mission
          ? {
              callToAction: normalizeOptionalString(mission.callToAction),
              followDragonEnabled: mission.followDragonEnabled ?? null,
              returnFromIssEnabled: mission.returnFromIssEnabled ?? null,
              toTheIssEnabled: mission.toTheIssEnabled ?? null,
              toTheIssTense: normalizeOptionalString(mission.toTheIssTense),
              infographicDesktop: mission.infographicDesktop ?? null,
              infographicMobile: mission.infographicMobile ?? null,
              imageDesktop: mission.imageDesktop ?? null,
              imageMobile: mission.imageMobile ?? null,
              videoDesktop: mission.videoDesktop ?? null,
              videoMobile: mission.videoMobile ?? null
            }
          : null
      };

      bundleRows.push({
        launch_id: launch.launch_id,
        source: 'spacex_content',
        content_type: 'mission_bundle',
        source_id: missionId,
        confidence,
        source_hash: await sha256Hex(JSON.stringify(bundle)),
        data: bundle,
        fetched_at: nowIso,
        updated_at: nowIso
      });

      const infographicRow = await buildMissionInfographicConstraintRow({
        launchId: launch.launch_id,
        missionId,
        missionTitle,
        confidence,
        launchPageUrl,
        match,
        infographicDesktop: mission?.infographicDesktop ?? null,
        infographicMobile: mission?.infographicMobile ?? null,
        fetchedAt: nowIso
      });
      if (infographicRow) constraintRows.push(infographicRow);

      const landingHintRow = await buildLandingHintConstraintRow({
        launchId: launch.launch_id,
        missionId,
        missionTitle,
        confidence,
        launchPageUrl,
        match,
        returnSite,
        returnDateTime,
        fetchedAt: nowIso
      });
      if (landingHintRow) constraintRows.push(landingHintRow);
    }

    if (!bundleRows.length && !constraintRows.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_rows' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_rows', elapsedMs: Date.now() - startedAt, stats });
    }

    if (bundleRows.length) {
      const merged = await upsertLaunchExternalResourcesIfChanged(supabase, bundleRows);
      stats.bundleRowsInput = merged.input;
      stats.bundleRowsInserted = merged.inserted;
      stats.bundleRowsUpdated = merged.updated;
      stats.bundleRowsSkipped = merged.skipped;
      stats.bundleUpsertFallback = merged.usedFallback;
    }

    if (constraintRows.length) {
      const merged = await upsertTrajectoryConstraintsIfChanged(supabase, constraintRows);
      stats.constraintRowsInput = merged.input;
      stats.constraintRowsInserted = merged.inserted;
      stats.constraintRowsUpdated = merged.updated;
      stats.constraintRowsSkipped = merged.skipped;
      stats.constraintUpsertFallback = merged.usedFallback;
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt }, 500);
  }
});

async function fetchLaunchTiles(): Promise<SpaceXLaunchTile[]> {
  const responses = await Promise.allSettled([
    fetchLaunchTilesEndpoint('/launches-page-tiles'),
    fetchLaunchTilesEndpoint('/launches-page-tiles/upcoming')
  ]);

  const merged = new Map<string, SpaceXLaunchTile>();
  for (const response of responses) {
    if (response.status !== 'fulfilled') continue;
    for (const tile of response.value) {
      if (!tile.missionId) continue;
      const existing = merged.get(tile.missionId);
      merged.set(tile.missionId, existing ? mergeLaunchTiles(existing, tile) : tile);
    }
  }

  return [...merged.values()];
}

async function fetchLaunchTilesEndpoint(path: string): Promise<SpaceXLaunchTile[]> {
  const res = await fetch(`${SPACEX_CONTENT_BASE_URL}${path}`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT }
  });
  if (!res.ok) throw new Error(`spacex_tiles_${res.status}`);
  const json = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(json)) return [];
  return json
    .map((row) => normalizeLaunchTile(row))
    .filter((tile): tile is SpaceXLaunchTile => Boolean(tile));
}

async function fetchMission(missionId: string): Promise<SpaceXMission | null> {
  const safe = normalizeOptionalString(missionId);
  if (!safe) return null;

  const res = await fetch(`${SPACEX_CONTENT_BASE_URL}/missions/${encodeURIComponent(safe)}`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`spacex_mission_${res.status}`);

  const json = (await res.json().catch(() => null)) as unknown;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;
  const resolvedMissionId = normalizeOptionalString(row.missionId) || safe;

  return {
    missionId: resolvedMissionId,
    title: normalizeOptionalString(row.title),
    callToAction: normalizeOptionalString(row.callToAction),
    followDragonEnabled: normalizeOptionalBoolean(row.followDragonEnabled),
    returnFromIssEnabled: normalizeOptionalBoolean(row.returnFromIssEnabled),
    toTheIssEnabled: normalizeOptionalBoolean(row.toTheIssEnabled),
    toTheIssTense: normalizeOptionalString(row.toTheIssTense),
    imageDesktop: normalizeCmsAsset(row.imageDesktop),
    imageMobile: normalizeCmsAsset(row.imageMobile),
    videoDesktop: normalizeCmsAsset(row.videoDesktop),
    videoMobile: normalizeCmsAsset(row.videoMobile),
    infographicDesktop: normalizeCmsAsset(row.infographicDesktop),
    infographicMobile: normalizeCmsAsset(row.infographicMobile),
    preLaunchTimeline: normalizeTimelineEntries(asObject(row.preLaunchTimeline).timelineEntries, 'prelaunch'),
    postLaunchTimeline: normalizeTimelineEntries(asObject(row.postLaunchTimeline).timelineEntries, 'postlaunch'),
    webcasts: normalizeWebcasts(row.webcasts),
    astronauts: normalizeAstronauts(row.astronauts),
    paragraphs: normalizeParagraphs(row.paragraphs),
    carousel: normalizeCarousel(row.carousel)
  };
}

function normalizeLaunchTile(value: unknown): SpaceXLaunchTile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const missionId = normalizeOptionalString(row.link);
  if (!missionId) return null;

  return {
    missionId,
    title: normalizeOptionalString(row.title),
    callToAction: normalizeOptionalString(row.callToAction),
    missionStatus: normalizeOptionalString(row.missionStatus),
    vehicle: normalizeOptionalString(row.vehicle),
    returnSite: normalizeOptionalString(row.returnSite),
    returnDateTime: normalizeOptionalString(row.returnDateTime),
    launchSite: normalizeOptionalString(row.launchSite),
    launchDate: normalizeOptionalString(row.launchDate),
    launchTime: normalizeOptionalString(row.launchTime),
    missionType: normalizeOptionalString(row.missionType),
    pageUrl: buildSpaceXLaunchPageUrl(missionId),
    imageDesktop: normalizeCmsAsset(row.imageDesktop),
    imageMobile: normalizeCmsAsset(row.imageMobile)
  };
}

function mergeLaunchTiles(left: SpaceXLaunchTile, right: SpaceXLaunchTile): SpaceXLaunchTile {
  return {
    missionId: left.missionId || right.missionId,
    title: pickLongerText(left.title, right.title),
    callToAction: pickLongerText(left.callToAction, right.callToAction),
    missionStatus: pickLongerText(left.missionStatus, right.missionStatus),
    vehicle: pickLongerText(left.vehicle, right.vehicle),
    returnSite: pickLongerText(left.returnSite, right.returnSite),
    returnDateTime: pickLongerText(left.returnDateTime, right.returnDateTime),
    launchSite: pickLongerText(left.launchSite, right.launchSite),
    launchDate: normalizeOptionalString(left.launchDate) || normalizeOptionalString(right.launchDate) || null,
    launchTime: normalizeOptionalString(left.launchTime) || normalizeOptionalString(right.launchTime) || null,
    missionType: pickLongerText(left.missionType, right.missionType),
    pageUrl: normalizeOptionalString(left.pageUrl) || normalizeOptionalString(right.pageUrl) || null,
    imageDesktop: left.imageDesktop ?? right.imageDesktop ?? null,
    imageMobile: left.imageMobile ?? right.imageMobile ?? null
  };
}

function pickMissionIdFromInfoUrls(
  infoUrls: unknown,
  strategy: 'launch_info_url' | 'mission_info_url'
): { missionId: string; url: string; strategy: string } | null {
  for (const url of extractUrls(infoUrls)) {
    const missionId = extractSpaceXMissionIdFromLaunchUrl(url);
    if (missionId) return { missionId, url, strategy };
  }
  return null;
}

function extractUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const normalized = normalizeOptionalString(entry);
      if (normalized) urls.push(normalized);
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const url = normalizeOptionalString((entry as Record<string, unknown>).url);
      if (url) urls.push(url);
    }
  }
  return urls;
}

function extractSpaceXMissionIdFromLaunchUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }

  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'spacex.com') return null;

  const parts = parsed.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const launchesIndex = parts.findIndex((part) => part.toLowerCase() === 'launches');
  if (launchesIndex === -1 || launchesIndex >= parts.length - 1) return null;

  const missionId = decodeURIComponent(parts[launchesIndex + 1] || '').trim();
  return missionId || null;
}

function pickBestTile(tiles: SpaceXLaunchTile[], launch: LaunchCandidate): TileMatch | null {
  let best: TileMatch | null = null;
  for (const tile of tiles) {
    const scored = scoreTileMatch(tile, launch);
    if (!best || scored.score > best.score) best = { tile, ...scored };
  }
  return best;
}

function scoreTileMatch(tile: SpaceXLaunchTile, launch: LaunchCandidate) {
  const netMs = launch?.net ? Date.parse(launch.net) : NaN;
  if (!Number.isFinite(netMs)) {
    return { score: 0, reasons: ['invalid_net'], tilePad: null, launchPad: null, dayDiff: null };
  }

  const netDay = dateOnlyIso(netMs);
  const tileDay = normalizeOptionalString(tile.launchDate) || '';
  const dayDiff =
    tileDay && /^\d{4}-\d{2}-\d{2}$/.test(tileDay)
      ? Math.abs(Date.parse(`${tileDay}T00:00:00Z`) - Date.parse(`${netDay}T00:00:00Z`)) / (24 * 60 * 60 * 1000)
      : null;

  let dateScore = 0;
  if (dayDiff === 0) dateScore = 0.55;
  else if (dayDiff === 1) dateScore = 0.3;
  else if (dayDiff === 2) dateScore = 0.15;

  const launchPad = normalizeOptionalString(launch.pad_short_code)?.toUpperCase() || '';
  const tilePad = padCodeFromLaunchSite(tile.launchSite);
  let padScore = 0;
  if (launchPad && tilePad) {
    if (launchPad === tilePad) padScore = 0.25;
    else if (launchPad.includes(tilePad) || tilePad.includes(launchPad)) padScore = 0.15;
  }

  const tileVehicle = normalizeOptionalString(tile.vehicle)?.toLowerCase() || '';
  const launchVehicle = normalizeOptionalString(launch.vehicle)?.toLowerCase() || '';
  const vehicleScore = tileVehicle && launchVehicle && launchVehicle.includes(tileVehicle) ? 0.1 : 0;

  const missionOrName =
    normalizeOptionalString(launch.mission_name) || normalizeOptionalString(launch.name) || null;
  const titleScore = tokenOverlapScore(tile.title || null, missionOrName) * 0.15;
  const linkScore = tokenOverlapScore(tile.missionId || null, missionOrName) * 0.35;

  const score = dateScore + padScore + vehicleScore + titleScore + linkScore;
  const reasons = [
    `date=${dateScore.toFixed(2)}`,
    `pad=${padScore.toFixed(2)}`,
    `vehicle=${vehicleScore.toFixed(2)}`,
    `title=${titleScore.toFixed(2)}`,
    `link=${linkScore.toFixed(2)}`
  ];

  return {
    score,
    reasons,
    tilePad,
    launchPad: launchPad || null,
    dayDiff
  };
}

function buildAssetResources(missionId: string, tile: SpaceXLaunchTile | null, mission: SpaceXMission | null) {
  const resources: Array<Record<string, unknown>> = [];

  addAssetResource(resources, missionId, tile?.imageDesktop ?? null, 'tile:imageDesktop', 'Mission image', 'image');
  addAssetResource(resources, missionId, tile?.imageMobile ?? null, 'tile:imageMobile', 'Mission image (mobile)', 'image');

  addAssetResource(resources, missionId, mission?.imageDesktop ?? null, 'mission:imageDesktop', 'Mission image', 'image');
  addAssetResource(resources, missionId, mission?.imageMobile ?? null, 'mission:imageMobile', 'Mission image (mobile)', 'image');
  addAssetResource(resources, missionId, mission?.videoDesktop ?? null, 'mission:videoDesktop', 'Mission video', 'video');
  addAssetResource(resources, missionId, mission?.videoMobile ?? null, 'mission:videoMobile', 'Mission video (mobile)', 'video');
  addAssetResource(
    resources,
    missionId,
    mission?.infographicDesktop ?? null,
    'mission:infographicDesktop',
    'Mission profile',
    'infographic'
  );
  addAssetResource(
    resources,
    missionId,
    mission?.infographicMobile ?? null,
    'mission:infographicMobile',
    'Mission profile (mobile)',
    'infographic'
  );

  return resources;
}

function addAssetResource(
  resources: Array<Record<string, unknown>>,
  missionId: string,
  asset: NormalizedCmsAsset | null,
  id: string,
  label: string,
  kind: 'image' | 'video' | 'infographic'
) {
  if (!asset?.url) return;
  resources.push({
    id: `${id}:${missionId}`,
    kind,
    label,
    url: asset.url,
    previewUrl: normalizeOptionalString(asset.previewUrl) || null,
    mime: normalizeOptionalString(asset.mime) || null,
    width: toFiniteNumber(asset.width),
    height: toFiniteNumber(asset.height),
    source: 'spacex_content',
    sourceId: missionId
  });
}

function buildWebcastResources(missionId: string, webcasts: WebcastEntry[]) {
  return webcasts
    .filter((entry) => Boolean(entry.url))
    .map((entry) => ({
      id: `webcast:${missionId}:${entry.id}`,
      kind: 'webcast',
      label: normalizeOptionalString(entry.title) || 'Webcast',
      url: normalizeOptionalString(entry.url),
      previewUrl: normalizeOptionalString(entry.previewUrl) || normalizeOptionalString(entry.imageUrl) || null,
      mime: null,
      width: null,
      height: null,
      source: 'spacex_content',
      sourceId: missionId
    }))
    .filter((entry) => Boolean(entry.url));
}

function buildCarouselResources(missionId: string, carousel: CarouselEntry[]) {
  const resources: Array<Record<string, unknown>> = [];
  for (const entry of carousel) {
    addAssetResource(resources, missionId, entry.image ?? null, `carousel:image:${entry.id}`, normalizeOptionalString(entry.title) || 'Carousel image', 'image');
    addAssetResource(resources, missionId, entry.video ?? null, `carousel:video:${entry.id}`, normalizeOptionalString(entry.title) || 'Carousel video', 'video');
  }
  return resources;
}


function normalizeTimelineEntries(value: unknown, phase: 'prelaunch' | 'postlaunch'): TimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const description = normalizeOptionalString(row.description) || normalizeOptionalString(row.title) || null;
      if (!description) return null;
      return {
        id: `${phase}:${index}:${description}`,
        label: description,
        time: normalizeOptionalString(row.time),
        description: null,
        kind: phase
      };
    })
    .filter(isPresent);
}

function normalizeWebcasts(value: unknown): WebcastEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const videoId = normalizeOptionalString(row.videoId);
      const platform = normalizeOptionalString(row.streamingVideoType);
      const url = buildWebcastUrl(platform, videoId);
      const desktop = normalizeCmsAsset(row.imageDesktop);
      const mobile = normalizeCmsAsset(row.imageMobile);

      return {
        id: String(row.id ?? `${platform || 'webcast'}:${index}`),
        url,
        videoId,
        platform,
        title: normalizeOptionalString(row.title) || null,
        date: normalizeOptionalString(row.date) || null,
        imageUrl: desktop?.url || mobile?.url || null,
        previewUrl: desktop?.previewUrl || mobile?.previewUrl || null
      };
    })
    .filter(isPresent);
}

function buildWebcastUrl(platform: string | null | undefined, videoId: string | null | undefined) {
  const normalizedPlatform = normalizeOptionalString(platform)?.toLowerCase() || '';
  const normalizedVideoId = normalizeOptionalString(videoId);
  if (!normalizedVideoId) return null;
  if (normalizedPlatform === 'youtube') return `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedVideoId)}`;
  return null;
}

function normalizeAstronauts(value: unknown): AstronautEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const name = normalizeOptionalString(row.name);
      if (!name) return null;
      const portrait = normalizeCmsAsset(row.portrait);
      return {
        id: String(row.id ?? `astronaut:${index}:${name}`),
        name,
        role: normalizeOptionalString(row.description),
        bioLink: normalizeUrl(row.bioLink),
        portraitUrl: portrait?.url || null,
        previewUrl: portrait?.previewUrl || null
      };
    })
    .filter(isPresent);
}

function normalizeParagraphs(value: unknown): ParagraphEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const text = truncateText(stripHtml(normalizeOptionalString(row.content) || ''), 500);
      if (!text) return null;
      return {
        id: String(row.id ?? `paragraph:${index}`),
        title: normalizeOptionalString(row.title),
        text
      };
    })
    .filter(isPresent);
}

function normalizeCarousel(value: unknown): CarouselEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const title =
        normalizeOptionalString(row.title) || normalizeOptionalString(row.label) || normalizeOptionalString(row.name) || null;
      const image =
        normalizeCmsAsset(row.image) ||
        normalizeCmsAsset(row.imageDesktop) ||
        normalizeCmsAsset(row.imageMobile) ||
        normalizeCmsAsset(row.media);
      const video =
        normalizeCmsAsset(row.video) ||
        normalizeCmsAsset(row.videoDesktop) ||
        normalizeCmsAsset(row.videoMobile);
      if (!title && !image?.url && !video?.url) return null;
      return {
        id: String(row.id ?? `carousel:${index}`),
        title,
        image,
        video
      };
    })
    .filter(isPresent);
}

function normalizeOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  return null;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function pickLongerText(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeOptionalString(left);
  const b = normalizeOptionalString(right);
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function padCodeFromLaunchSite(launchSite: string | null | undefined) {
  const normalized = normalizeOptionalString(launchSite);
  if (!normalized) return null;

  const firstMatch = normalized.match(/\b(SLC|LC|LZ)\s*-?\s*(\d{1,3}[A-Z]?)\b/i);
  if (firstMatch) return `${firstMatch[1].toUpperCase()}-${firstMatch[2].toUpperCase()}`;

  const first = normalized.split(',')[0]?.trim() || '';
  const secondMatch = first.match(/\b([A-Z]{1,4}-\d{1,3}[A-Z]?)\b/);
  return secondMatch ? secondMatch[1].toUpperCase() : null;
}

function normalizeTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenOverlapScore(left: string | null, right: string | null) {
  if (!left || !right) return 0;
  const a = new Set(normalizeTokens(left));
  const b = new Set(normalizeTokens(right));
  if (!a.size || !b.size) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  const denominator = Math.max(a.size, b.size);
  return denominator ? overlap / denominator : 0;
}

function dateOnlyIso(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dedupeResources(resources: Array<Record<string, unknown>>) {
  const deduped = new Map<string, Record<string, unknown>>();
  for (const resource of resources) {
    const kind = normalizeOptionalString(resource.kind) || 'resource';
    const url = normalizeOptionalString(resource.url);
    if (!url) continue;
    const key = `${kind}:${url}`;
    if (!deduped.has(key)) deduped.set(key, resource);
  }
  return [...deduped.values()];
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}


function pushStatError(
  errors: Array<{ step: string; error: string; context?: Record<string, unknown> }>,
  step: string,
  err: unknown,
  context?: Record<string, unknown>
) {
  if (errors.length >= 20) return;
  errors.push({ step, error: stringifyError(err), context });
}

async function upsertLaunchExternalResourcesIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_external_resources_if_changed', {
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

  console.warn('upsert_launch_external_resources_if_changed failed; falling back to upsert', error);
  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_external_resources')
    .upsert(rows, { onConflict: 'launch_id,source,content_type,source_id' })
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function stringifyError(err: unknown) {
  if (!err) return 'unknown_error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || 'error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
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
