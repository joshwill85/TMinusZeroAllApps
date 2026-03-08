import { createClient } from '@supabase/supabase-js';

type LaunchCacheRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  provider: string | null;
  net: string | null;
  crew: unknown[] | null;
  video_url: string | null;
  mission_description: string | null;
  launch_info_urls: unknown[] | null;
  mission_info_urls: unknown[] | null;
  launch_vid_urls: unknown[] | null;
  mission_vid_urls: unknown[] | null;
  updates: unknown[] | null;
};

type LaunchLiveRow = {
  id: string;
  crew: unknown[] | null;
  video_url: string | null;
  mission_description: string | null;
  launch_info_urls: unknown[] | null;
  mission_info_urls: unknown[] | null;
  launch_vid_urls: unknown[] | null;
  mission_vid_urls: unknown[] | null;
  updates: unknown[] | null;
};

type MissionKey =
  | 'artemis-i'
  | 'artemis-ii'
  | 'artemis-iii'
  | 'artemis-iv'
  | 'artemis-v'
  | 'artemis-vi'
  | 'artemis-vii'
  | 'other';

type Result = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: Record<string, unknown>;
};

const ARTEMIS_OR_FILTER = 'name.ilike.%Artemis%,mission_name.ilike.%Artemis%';
const MISSION_KEYS: MissionKey[] = ['artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'];

async function main() {
  const result = await runAudit();
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}

async function runAudit(): Promise<Result> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary: Record<string, unknown> = {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    warnings.push('Supabase env vars are missing; Artemis data audit skipped.');
    return { ok: true, errors, warnings, summary: { skipped: true } };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: launches, error: launchError } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,name,mission_name,provider,net,crew,video_url,mission_description,launch_info_urls,mission_info_urls,launch_vid_urls,mission_vid_urls,updates'
    )
    .or(ARTEMIS_OR_FILTER)
    .order('net', { ascending: true })
    .limit(600);

  if (launchError) {
    errors.push(`Unable to load Artemis launches from public cache: ${launchError.message}`);
    return { ok: false, errors, warnings, summary };
  }

  const rows = (launches || []) as LaunchCacheRow[];
  summary.artemisLaunchCount = rows.length;
  if (!rows.length) {
    errors.push('No Artemis launches were found in launches_public_cache.');
    return { ok: false, errors, warnings, summary };
  }

  const missionGroups = Object.fromEntries(
    MISSION_KEYS.map((mission) => [mission, rows.filter((row) => inferMission(row) === mission)])
  ) as Record<Exclude<MissionKey, 'other'>, LaunchCacheRow[]>;

  summary.missionLaunchCounts = Object.fromEntries(Object.entries(missionGroups).map(([mission, group]) => [mission, group.length]));

  for (const [missionKey, group] of Object.entries(missionGroups)) {
    if (group.length === 0) {
      errors.push(`Critical: ${missionKey} has zero launch rows in launches_public_cache.`);
    }
  }

  const launchIds = rows.map((row) => row.launch_id).filter(Boolean);
  const missionByLaunchId = new Map(rows.map((row) => [row.launch_id, inferMission(row)]));

  const { data: joinRows, error: joinError } = await supabase.from('snapi_item_launches').select('launch_id,snapi_uid').in('launch_id', launchIds);
  if (joinError) {
    errors.push(`Unable to query SNAPI launch joins: ${joinError.message}`);
  } else {
    const launchIdsWithNews = new Set<string>();
    const launchesWithNewsByMission = new Map<string, Set<string>>();
    for (const mission of MISSION_KEYS) launchesWithNewsByMission.set(mission, new Set<string>());

    for (const row of joinRows || []) {
      if (!row?.launch_id) continue;
      const launchId = String(row.launch_id);
      launchIdsWithNews.add(launchId);
      const mission = missionByLaunchId.get(launchId);
      if (mission && mission !== 'other') {
        launchesWithNewsByMission.get(mission)?.add(launchId);
      }
    }

    summary.launchesWithNews = launchIdsWithNews.size;
    summary.totalNewsJoins = (joinRows || []).length;
    summary.newsLaunchCoverageByMission = Object.fromEntries(
      MISSION_KEYS.map((mission) => [mission, launchesWithNewsByMission.get(mission)?.size || 0])
    );

    if (launchIdsWithNews.size === 0) {
      errors.push('Critical: No SNAPI launch joins found for Artemis launches.');
    }
  }

  const { data: socialRows, error: socialError } = await supabase.from('social_posts').select('launch_id').in('launch_id', launchIds).limit(1200);
  if (socialError) {
    warnings.push(`Social posts lookup failed (non-fatal): ${socialError.message}`);
  } else {
    const linkedCount = (socialRows || []).length;
    summary.socialPostsLinked = linkedCount;
    const linkedByMission = new Map<string, number>();
    for (const mission of MISSION_KEYS) linkedByMission.set(mission, 0);
    for (const row of socialRows || []) {
      const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
      if (!launchId) continue;
      const mission = missionByLaunchId.get(launchId);
      if (!mission || mission === 'other') continue;
      linkedByMission.set(mission, (linkedByMission.get(mission) || 0) + 1);
    }
    summary.socialPostsByMission = Object.fromEntries(MISSION_KEYS.map((mission) => [mission, linkedByMission.get(mission) || 0]));

    if (linkedCount === 0) {
      warnings.push('No social_posts rows are linked to Artemis launches.');
    }
  }

  const sparseStats = {
    missingMissionDescription: rows.filter((row) => !hasText(row.mission_description)).length,
    missingCrew: rows.filter((row) => !hasItems(row.crew)).length,
    missingVideo: rows.filter((row) => !hasText(row.video_url)).length,
    missingLaunchInfo: rows.filter((row) => !hasItems(row.launch_info_urls)).length,
    missingMissionInfo: rows.filter((row) => !hasItems(row.mission_info_urls)).length,
    missingLaunchVideos: rows.filter((row) => !hasItems(row.launch_vid_urls)).length,
    missingMissionVideos: rows.filter((row) => !hasItems(row.mission_vid_urls)).length,
    missingUpdates: rows.filter((row) => !hasItems(row.updates)).length
  };
  summary.sparseStats = sparseStats;

  maybeWarnSparsity(warnings, 'mission_description', sparseStats.missingMissionDescription, rows.length, 0.7);
  maybeWarnSparsity(warnings, 'crew', sparseStats.missingCrew, rows.length, 0.85);
  maybeWarnSparsity(warnings, 'video_url', sparseStats.missingVideo, rows.length, 0.75);
  maybeWarnSparsity(warnings, 'launch_info_urls', sparseStats.missingLaunchInfo, rows.length, 0.75);
  maybeWarnSparsity(warnings, 'mission_info_urls', sparseStats.missingMissionInfo, rows.length, 0.8);
  maybeWarnSparsity(warnings, 'launch_vid_urls', sparseStats.missingLaunchVideos, rows.length, 0.8);
  maybeWarnSparsity(warnings, 'mission_vid_urls', sparseStats.missingMissionVideos, rows.length, 0.85);
  maybeWarnSparsity(warnings, 'updates', sparseStats.missingUpdates, rows.length, 0.75);

  await evaluateLaunchParity({ supabase, rows, missionGroups, errors, warnings, summary });

  return { ok: errors.length === 0, errors, warnings, summary };
}

async function evaluateLaunchParity({
  supabase,
  rows,
  missionGroups,
  errors,
  warnings,
  summary
}: {
  supabase: ReturnType<typeof createClient>;
  rows: LaunchCacheRow[];
  missionGroups: Record<Exclude<MissionKey, 'other'>, LaunchCacheRow[]>;
  errors: string[];
  warnings: string[];
  summary: Record<string, unknown>;
}) {
  const launchIds = rows.map((row) => row.launch_id).filter(Boolean);
  const { data: liveRows, error: liveError } = await supabase
    .from('launches')
    .select('id,crew,video_url,mission_description,launch_info_urls,mission_info_urls,launch_vid_urls,mission_vid_urls,updates')
    .in('id', launchIds)
    .limit(600);

  if (liveError) {
    warnings.push(`Parity check skipped (unable to read launches table): ${liveError.message}`);
    summary.paritySkipped = true;
    return;
  }

  const liveById = new Map<string, LaunchLiveRow>((liveRows || []).map((row) => [String((row as LaunchLiveRow).id), row as LaunchLiveRow]));

  const parityRequiredFields: Array<keyof LaunchLiveRow> = ['mission_description', 'updates'];
  const parityOptionalFields: Array<keyof LaunchLiveRow> = ['crew', 'video_url', 'launch_info_urls', 'mission_info_urls', 'launch_vid_urls', 'mission_vid_urls'];

  let requiredGaps = 0;
  let optionalGaps = 0;
  const parityByMission: Record<string, { requiredGaps: number; optionalGaps: number; checkedLaunchId: string | null }> = {};

  for (const mission of MISSION_KEYS) {
    const representative = missionGroups[mission][0] || null;
    if (!representative) {
      parityByMission[mission] = { requiredGaps: 0, optionalGaps: 0, checkedLaunchId: null };
      continue;
    }

    const live = liveById.get(representative.launch_id) || null;
    let missionRequiredGaps = 0;
    let missionOptionalGaps = 0;

    if (!live) {
      warnings.push(`Parity warning: no live launch row found for ${mission} launch ${representative.launch_id}.`);
      parityByMission[mission] = { requiredGaps: 0, optionalGaps: 0, checkedLaunchId: representative.launch_id };
      continue;
    }

    for (const field of parityRequiredFields) {
      if (hasFieldData(live[field]) && !hasFieldData((representative as any)[field])) {
        missionRequiredGaps += 1;
        requiredGaps += 1;
        errors.push(`Critical parity gap: ${mission} missing ${field} in launches_public_cache while launches has data (launch ${representative.launch_id}).`);
      }
    }

    for (const field of parityOptionalFields) {
      if (hasFieldData(live[field]) && !hasFieldData((representative as any)[field])) {
        missionOptionalGaps += 1;
        optionalGaps += 1;
      }
    }

    parityByMission[mission] = {
      requiredGaps: missionRequiredGaps,
      optionalGaps: missionOptionalGaps,
      checkedLaunchId: representative.launch_id
    };
  }

  summary.parity = {
    requiredGaps,
    optionalGaps,
    byMission: parityByMission
  };

  if (optionalGaps > 0) {
    warnings.push(`Parity warning: ${optionalGaps} optional field gap(s) detected between launches and launches_public_cache across representative Artemis missions.`);
  }
}

function inferMission(row: Pick<LaunchCacheRow, 'name' | 'mission_name'>): MissionKey {
  const text = `${row.name || ''} ${row.mission_name || ''}`.toLowerCase();
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(vii|7)\b/.test(text)) return 'artemis-vii';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(vi|6)\b/.test(text)) return 'artemis-vi';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(v|5)\b/.test(text)) return 'artemis-v';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(iv|4)\b/.test(text)) return 'artemis-iv';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(iii|3)\b/.test(text)) return 'artemis-iii';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(ii|2)\b/.test(text)) return 'artemis-ii';
  if (/\bartem[iu]s(?:\s*[-:]?\s*)(i|1)\b/.test(text)) return 'artemis-i';
  return 'other';
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasFieldData(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function maybeWarnSparsity(
  warnings: string[],
  label: string,
  missingCount: number,
  totalCount: number,
  threshold: number
) {
  if (totalCount <= 0) return;
  const ratio = missingCount / totalCount;
  if (ratio >= threshold) {
    warnings.push(`Sparse optional field: ${label} missing for ${(ratio * 100).toFixed(1)}% of Artemis launch rows.`);
  }
}

function printResult(result: Result) {
  const status = result.ok ? 'PASS' : 'FAIL';
  // eslint-disable-next-line no-console
  console.log(`artemis-data-audit: ${status}`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Errors:');
    for (const error of result.errors) {
      // eslint-disable-next-line no-console
      console.error(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('Warnings:');
    for (const warning of result.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`- ${warning}`);
    }
  }
}

void main();
