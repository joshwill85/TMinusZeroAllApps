import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchBlueOriginEngines, fetchBlueOriginVehicles } from '@/lib/server/blueOriginEntities';
import {
  buildArtemisContractHref,
  fetchArtemisContractStoryByAwardId,
  resolveArtemisAwardIdFromContractSeed,
  type ArtemisOpportunityNotice as ArtemisOpportunityNoticeRow,
  type ArtemisContractAction as ArtemisContractActionRow,
  type ArtemisContractSpendingPoint as ArtemisContractSpendingPointRow
} from '@/lib/server/artemisContracts';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';
import type {
  BlueOriginContractAction,
  BlueOriginContractDetail,
  BlueOriginContractVehicleBinding,
  BlueOriginContract,
  BlueOriginContractsResponse,
  BlueOriginOpportunityNotice,
  BlueOriginSpendingPoint
} from '@/lib/types/blueOrigin';
import type { BlueOriginEngineSlug, BlueOriginVehicleSlug } from '@/lib/types/blueOrigin';
import type { BlueOriginMissionKey } from '@/lib/utils/blueOrigin';

type ContractRow = {
  id: string;
  contract_key: string;
  mission_key: BlueOriginMissionKey;
  title: string;
  agency: string | null;
  customer: string | null;
  amount: number | null;
  awarded_on: string | null;
  description: string | null;
  source_url: string | null;
  source_label: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ContractActionRow = {
  id: string;
  action_key: string;
  mod_number: string | null;
  action_date: string | null;
  obligation_delta: number | null;
  obligation_cumulative: number | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type OpportunityNoticeRow = {
  id: string;
  notice_id: string;
  solicitation_id: string | null;
  title: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  awardee_name: string | null;
  award_amount: number | null;
  notice_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type SpendingRow = {
  id: string;
  fiscal_year: number;
  fiscal_month: number;
  obligations: number | null;
  outlays: number | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ContractVehicleMapRow = {
  id: string;
  vehicle_slug: string | null;
  engine_slug: string | null;
  match_method: string | null;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
};

const CONTRACT_DETAIL_QUERY_LIMIT = 500;
const NOTICE_HINT_CHUNK_SIZE = 64;
const NOTICE_FALLBACK_SCAN_LIMIT = 500;

const FALLBACK_CONTRACTS: BlueOriginContract[] = [
  {
    id: 'fallback:nasa-hls-2023',
    contractKey: 'NASA-HLS-2023-05-19',
    missionKey: 'blue-moon',
    title: 'NASA Artemis Human Landing System Option (Blue Moon)',
    agency: 'NASA',
    customer: 'NASA',
    amount: null,
    awardedOn: '2023-05-19',
    description: 'NASA selected Blue Origin as second Artemis lunar lander provider for a crewed lunar demonstration.',
    sourceUrl: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-as-second-artemis-lunar-lander-provider/',
    sourceLabel: 'NASA press release',
    status: 'awarded',
    metadata: {
      sourceClass: 'government-record',
      confidence: 'high'
    },
    updatedAt: '2023-05-19T00:00:00Z'
  },
  {
    id: 'fallback:nasa-viper-2025',
    contractKey: 'NASA-VIPER-2025-09-19',
    missionKey: 'blue-moon',
    title: 'NASA selects Blue Origin to deliver VIPER rover to the Moon',
    agency: 'NASA',
    customer: 'NASA',
    amount: null,
    awardedOn: '2025-09-19',
    description: 'NASA selected Blue Origin to deliver the VIPER rover to the Moon as part of Artemis lunar surface logistics.',
    sourceUrl: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-to-deliver-viper-rover-to-moons-south-pole/',
    sourceLabel: 'NASA press release',
    status: 'awarded',
    metadata: {
      sourceClass: 'government-record',
      confidence: 'high'
    },
    updatedAt: '2025-09-19T00:00:00Z'
  },
  {
    id: 'fallback:ussf-nssl-2024',
    contractKey: 'USSF-NSSL-LANE1-2024-06-13',
    missionKey: 'new-glenn',
    title: 'USSF NSSL Lane 1 contract award',
    agency: 'U.S. Space Force',
    customer: 'U.S. Space Force',
    amount: null,
    awardedOn: '2024-06-13',
    description: 'Space Force awarded NSSL Lane 1 contracts including Blue Origin participation for national security launch.',
    sourceUrl:
      'https://www.ssc.spaceforce.mil/Portals/3/Documents/PRESS%20RELEASES/20240613%20SSC%20Awards%20Launch%20Service%20Contracts%20for%20NSSL%20Phase%203%20Lane%201.pdf',
    sourceLabel: 'U.S. Space Force / SSC',
    status: 'awarded',
    metadata: {
      sourceClass: 'government-record',
      confidence: 'high'
    },
    updatedAt: '2024-06-13T00:00:00Z'
  },
  {
    id: 'fallback:amazon-kuiper-2022',
    contractKey: 'AMZN-KUIPER-2022-04-05',
    missionKey: 'new-glenn',
    title: 'Amazon Project Kuiper launch services agreement',
    agency: null,
    customer: 'Amazon',
    amount: null,
    awardedOn: '2022-04-05',
    description: 'Amazon announced launch agreements including New Glenn missions for Project Kuiper deployment.',
    sourceUrl:
      'https://press.aboutamazon.com/2022/4/amazon-secures-up-to-83-launches-from-arianespace-blue-origin-and-united-launch-alliance-for-project-kuiper',
    sourceLabel: 'Amazon announcement',
    status: 'announced',
    metadata: {
      sourceClass: 'official-partner',
      confidence: 'medium'
    },
    updatedAt: '2022-04-05T00:00:00Z'
  }
];

export const fetchBlueOriginContracts = cache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginContractsResponse> => {
  const generatedAt = new Date().toISOString();
  const dbItems = await fetchContractsFromDatabase(mission);

  if (dbItems.length > 0) {
    return {
      generatedAt,
      mission,
      items: dbItems
    };
  }

  const fallback = FALLBACK_CONTRACTS.filter((item) => (mission === 'all' ? true : item.missionKey === mission));
  return {
    generatedAt,
    mission,
    items: fallback
  };
});

export const fetchBlueOriginContractDetailBySlug = cache(async (slug: string): Promise<BlueOriginContractDetail | null> => {
  const normalizedSlug = parseBlueOriginContractSlug(slug);
  if (!normalizedSlug) return null;

  const contracts = await fetchBlueOriginContracts('all');
  const contract = contracts.items.find((item) => buildBlueOriginContractSlug(item.contractKey) === normalizedSlug) || null;
  if (!contract) return null;

  const generatedAt = new Date().toISOString();
  const [vehiclesResponse, enginesResponse] = await Promise.all([fetchBlueOriginVehicles('all'), fetchBlueOriginEngines('all')]);
  const vehicleBySlug = new Map(vehiclesResponse.items.map((entry) => [entry.vehicleSlug, entry]));
  const engineBySlug = new Map(enginesResponse.items.map((entry) => [entry.engineSlug, entry]));

  const fallbackActions = buildFallbackContractActions(contract);
  const fallbackSpending = buildFallbackContractSpending(contract);
  const fallbackVehicles = buildFallbackContractVehicleBindings(contract, vehicleBySlug, engineBySlug);

  const awardId = resolveArtemisAwardIdFromContractSeed({
    contractKey: contract.contractKey,
    sourceUrl: contract.sourceUrl,
    metadata: contract.metadata
  });
  const artemisStory = awardId
    ? await fetchArtemisContractStoryByAwardId(awardId, {
        contractLimit: 1200,
        actionLimit: 500,
        noticeLimit: 500,
        spendingLimit: 500
      })
    : null;
  const contractStory = artemisStory
    ? {
        piid: artemisStory.piid,
        storyHref: buildArtemisContractHref(artemisStory.piid),
        members: artemisStory.members.length,
        actions: artemisStory.actions.map(mapArtemisContractAction),
        notices: artemisStory.notices.map(mapArtemisOpportunityNotice),
        spending: artemisStory.spending.map(mapArtemisSpendingPoint),
        bidders: artemisStory.bidders
      }
    : null;

  if (!isSupabaseConfigured() || !looksLikeUuid(contract.id)) {
    return {
      generatedAt,
      contract,
      actions: fallbackActions,
      notices: [],
      spending: fallbackSpending,
      vehicles: fallbackVehicles,
      story: contractStory
    };
  }

  const supabase = createSupabasePublicClient();
  const shouldQueryActions = !contractStory || contractStory.actions.length < 1;
  const shouldQueryNotices = !contractStory || contractStory.notices.length < 1;
  const shouldQuerySpending = !contractStory || contractStory.spending.length < 1;
  const [actionsRes, spendingRes, vehicleMapRes] = await Promise.all([
    shouldQueryActions
      ? supabase
          .from('blue_origin_contract_actions')
          .select('id,action_key,mod_number,action_date,obligation_delta,obligation_cumulative,source,metadata,updated_at')
          .eq('contract_id', contract.id)
          .order('action_date', { ascending: false, nullsFirst: false })
          .order('mod_number', { ascending: false })
          .limit(CONTRACT_DETAIL_QUERY_LIMIT)
      : Promise.resolve({ data: [] as ContractActionRow[], error: null }),
    shouldQuerySpending
      ? supabase
          .from('blue_origin_spending_timeseries')
          .select('id,fiscal_year,fiscal_month,obligations,outlays,source,metadata,updated_at')
          .eq('contract_id', contract.id)
          .order('fiscal_year', { ascending: false })
          .order('fiscal_month', { ascending: false })
          .limit(CONTRACT_DETAIL_QUERY_LIMIT)
      : Promise.resolve({ data: [] as SpendingRow[], error: null }),
    supabase
      .from('blue_origin_contract_vehicle_map')
      .select('id,vehicle_slug,engine_slug,match_method,confidence,metadata')
      .eq('contract_id', contract.id)
      .order('confidence', { ascending: false })
      .limit(120)
  ]);

  if (shouldQueryActions && actionsRes.error) console.error('blue origin contract actions detail query error', actionsRes.error);
  if (shouldQuerySpending && spendingRes.error) console.error('blue origin contract spending detail query error', spendingRes.error);
  if (vehicleMapRes.error) console.error('blue origin contract vehicle map detail query error', vehicleMapRes.error);

  const actionRows = (actionsRes.data || []) as ContractActionRow[];
  const noticeRows = shouldQueryNotices
    ? await fetchContractNoticeRows(supabase, contract, actionRows)
    : [];
  const actions = actionRows.map(mapContractActionRow);
  const notices = noticeRows
    .map(mapOpportunityNoticeRow);
  const spending = ((spendingRes.data || []) as SpendingRow[]).map(mapSpendingRow);
  const vehicles = ((vehicleMapRes.data || []) as ContractVehicleMapRow[])
    .map((row): BlueOriginContractVehicleBinding => {
      const vehicleSlug = normalizeVehicleSlug(row.vehicle_slug);
      const engineSlug = normalizeEngineSlug(row.engine_slug);
      return {
        id: row.id,
        vehicleSlug,
        engineSlug,
        matchMethod: row.match_method || 'rule',
        confidence: finiteNumberOrZero(row.confidence),
        metadata: toMetadata(row.metadata),
        vehicle: vehicleSlug ? vehicleBySlug.get(vehicleSlug) || null : null,
        engine: engineSlug ? engineBySlug.get(engineSlug) || null : null
      };
    })
    .filter((row, index, array) => array.findIndex((entry) => entry.id === row.id) === index);

  return {
    generatedAt,
    contract,
    actions: contractStory && contractStory.actions.length ? contractStory.actions : actions.length ? actions : fallbackActions,
    notices: contractStory && contractStory.notices.length ? contractStory.notices : notices,
    spending: contractStory && contractStory.spending.length ? contractStory.spending : spending.length ? spending : fallbackSpending,
    vehicles: vehicles.length ? vehicles : fallbackVehicles,
    story: contractStory
  };
});

export function parseBlueOriginContractsMissionFilter(value: string | null): BlueOriginMissionKey | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'program' || normalized === 'blue-origin' || normalized === 'blue-origin-program') return 'blue-origin-program';
  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  return null;
}

export function buildBlueOriginContractSlug(contractKey: string) {
  return normalizeContractSlug(contractKey) || 'contract';
}

export function parseBlueOriginContractSlug(value: string | null | undefined) {
  const normalized = normalizeContractSlug(value || '');
  return normalized || null;
}

async function fetchContractsFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginContract[];

  const supabase = createSupabasePublicClient();
  let query = supabase
    .from('blue_origin_contracts')
    .select('id,contract_key,mission_key,title,agency,customer,amount,awarded_on,description,source_url,source_label,status,metadata,updated_at')
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (mission !== 'all') query = query.eq('mission_key', mission);

  const { data, error } = await query;
  if (error) {
    console.error('blue origin contracts query error', error);
    return [] as BlueOriginContract[];
  }

  return ((data || []) as ContractRow[]).map((row) => {
    const metadata = toMetadata(row.metadata);
    const awardId = resolveArtemisAwardIdFromContractSeed({
      contractKey: row.contract_key,
      sourceUrl: row.source_url,
      metadata
    });
    const sourceUrl =
      resolveUsaspendingAwardSourceUrl({
        awardId,
        sourceUrl: row.source_url,
        awardApiUrl: metadataString(metadata, 'awardApiUrl'),
        awardPageUrl: metadataString(metadata, 'awardPageUrl')
      }) || row.source_url;

    return {
      id: row.id,
      contractKey: row.contract_key,
      missionKey: row.mission_key,
      title: row.title,
      agency: row.agency,
      customer: row.customer,
      amount: row.amount,
      awardedOn: row.awarded_on,
      description: row.description,
      sourceUrl,
      sourceLabel: row.source_label,
      status: row.status,
      metadata,
      updatedAt: row.updated_at
    };
  });
}

function mapContractActionRow(row: ContractActionRow): BlueOriginContractAction {
  return {
    id: row.id,
    actionKey: row.action_key,
    modNumber: row.mod_number,
    actionDate: row.action_date,
    obligationDelta: row.obligation_delta,
    obligationCumulative: row.obligation_cumulative,
    source: row.source || 'unknown',
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

function mapOpportunityNoticeRow(row: OpportunityNoticeRow): BlueOriginOpportunityNotice {
  return {
    id: row.id,
    noticeId: row.notice_id,
    solicitationId: row.solicitation_id,
    title: row.title,
    postedDate: row.posted_date,
    responseDeadline: row.response_deadline,
    awardeeName: row.awardee_name,
    awardAmount: row.award_amount,
    noticeUrl: row.notice_url,
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

function mapArtemisContractAction(row: ArtemisContractActionRow): BlueOriginContractAction {
  return {
    id: row.id,
    actionKey: row.actionKey,
    modNumber: row.modNumber,
    actionDate: row.actionDate,
    obligationDelta: row.obligationDelta,
    obligationCumulative: row.obligationCumulative,
    source: row.source || 'sam',
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function mapArtemisOpportunityNotice(row: ArtemisOpportunityNoticeRow): BlueOriginOpportunityNotice {
  return {
    id: row.id,
    noticeId: row.noticeId,
    solicitationId: row.solicitationId,
    title: row.title,
    postedDate: row.postedDate,
    responseDeadline: row.responseDeadline,
    awardeeName: row.awardeeName,
    awardAmount: row.awardAmount,
    noticeUrl: row.noticeUrl,
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function mapArtemisSpendingPoint(row: ArtemisContractSpendingPointRow): BlueOriginSpendingPoint {
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    fiscalMonth: row.fiscalMonth,
    obligations: row.obligations,
    outlays: row.outlays,
    source: row.source || 'sam',
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function mapSpendingRow(row: SpendingRow): BlueOriginSpendingPoint {
  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    fiscalMonth: row.fiscal_month,
    obligations: row.obligations,
    outlays: row.outlays,
    source: row.source || 'unknown',
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

async function fetchContractNoticeRows(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  contract: BlueOriginContract,
  actionRows: ContractActionRow[]
) {
  const limit = CONTRACT_DETAIL_QUERY_LIMIT;
  const hints = collectNoticeLookupHints(contract, actionRows);
  const rows: OpportunityNoticeRow[] = [];
  const seen = new Set<string>();

  const appendRows = (incoming: OpportunityNoticeRow[]) => {
    for (const row of incoming) {
      const key = normalizeLookupId(row.notice_id) || row.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= limit) break;
    }
  };

  const lookupByColumn = async (
    column: 'notice_id' | 'solicitation_id',
    values: string[]
  ) => {
    for (const chunk of chunkArray(values, NOTICE_HINT_CHUNK_SIZE)) {
      if (rows.length >= limit) break;
      const { data, error } = await supabase
        .from('blue_origin_opportunity_notices')
        .select(
          'id,notice_id,solicitation_id,title,posted_date,response_deadline,awardee_name,award_amount,notice_url,metadata,updated_at'
        )
        .in(column, chunk)
        .order('posted_date', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) {
        console.error(
          `blue origin contract notices detail query error (${column})`,
          error
        );
        break;
      }
      appendRows((data || []) as OpportunityNoticeRow[]);
    }
  };

  if (hints.noticeIds.length > 0) {
    await lookupByColumn('notice_id', hints.noticeIds);
  }
  if (rows.length < limit && hints.solicitationIds.length > 0) {
    await lookupByColumn('solicitation_id', hints.solicitationIds);
  }
  if (rows.length > 0) {
    return sortNoticeRows(rows).slice(0, limit);
  }

  const { data, error } = await supabase
    .from('blue_origin_opportunity_notices')
    .select(
      'id,notice_id,solicitation_id,title,posted_date,response_deadline,awardee_name,award_amount,notice_url,metadata,updated_at'
    )
    .order('posted_date', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(limit, NOTICE_FALLBACK_SCAN_LIMIT));
  if (error) {
    console.error('blue origin contract notices fallback query error', error);
    return [] as OpportunityNoticeRow[];
  }

  return sortNoticeRows((data || []) as OpportunityNoticeRow[])
    .filter((row) => matchesNoticeToContract(row, contract))
    .slice(0, limit);
}

function collectNoticeLookupHints(
  contract: BlueOriginContract,
  actionRows: ContractActionRow[]
) {
  const solicitationIds = new Set<string>();
  const noticeIds = new Set<string>();

  collectLookupHintsFromValue(contract.metadata, solicitationIds, noticeIds, 0);
  for (const row of actionRows) {
    collectLookupHintsFromValue(toMetadata(row.metadata), solicitationIds, noticeIds, 0);
  }

  return {
    solicitationIds: [...solicitationIds.values()],
    noticeIds: [...noticeIds.values()]
  };
}

function collectLookupHintsFromValue(
  value: unknown,
  solicitationIds: Set<string>,
  noticeIds: Set<string>,
  depth: number
) {
  if (depth > 4 || !value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLookupHintsFromValue(entry, solicitationIds, noticeIds, depth + 1);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = normalizeLookupKey(key);
    if (isSolicitationLookupKey(normalizedKey)) {
      appendLookupValues(solicitationIds, entry);
    }
    if (isNoticeLookupKey(normalizedKey)) {
      appendLookupValues(noticeIds, entry);
    }
    if (entry && typeof entry === 'object') {
      collectLookupHintsFromValue(entry, solicitationIds, noticeIds, depth + 1);
    }
  }
}

function appendLookupValues(target: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    for (const entry of value) appendLookupValues(target, entry);
    return;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return;
  }

  const normalized = normalizeLookupId(String(value));
  if (normalized) target.add(normalized);
}

function normalizeLookupKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSolicitationLookupKey(value: string) {
  return (
    value.includes('solicitationid') ||
    value.includes('solicitationnumber') ||
    value.includes('solicitationno') ||
    value === 'solnum' ||
    value === 'solicitation'
  );
}

function isNoticeLookupKey(value: string) {
  return (
    value.includes('noticeid') ||
    value.includes('samnoticeid') ||
    value.includes('noticenumber') ||
    value.includes('noticeno')
  );
}

function normalizeLookupId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sortNoticeRows(rows: OpportunityNoticeRow[]) {
  return [...rows].sort((left, right) => {
    const leftPosted = left.posted_date ? Date.parse(left.posted_date) : Number.NaN;
    const rightPosted = right.posted_date ? Date.parse(right.posted_date) : Number.NaN;
    const leftUpdated = left.updated_at ? Date.parse(left.updated_at) : Number.NaN;
    const rightUpdated = right.updated_at ? Date.parse(right.updated_at) : Number.NaN;
    const leftTime = Number.isFinite(leftPosted)
      ? leftPosted
      : Number.isFinite(leftUpdated)
        ? leftUpdated
        : -1;
    const rightTime = Number.isFinite(rightPosted)
      ? rightPosted
      : Number.isFinite(rightUpdated)
        ? rightUpdated
        : -1;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.id.localeCompare(right.id);
  });
}

function buildFallbackContractActions(contract: BlueOriginContract): BlueOriginContractAction[] {
  const source = isGovernmentContract(contract) ? 'government-record' : 'curated-fallback';
  return [
    {
      id: `fallback:${contract.id}:action:0`,
      actionKey: `${contract.contractKey}:base-award`,
      modNumber: '0',
      actionDate: contract.awardedOn,
      obligationDelta: contract.amount,
      obligationCumulative: contract.amount,
      source,
      metadata: { derived: true },
      updatedAt: contract.updatedAt
    }
  ];
}

function buildFallbackContractSpending(contract: BlueOriginContract): BlueOriginSpendingPoint[] {
  if (contract.amount == null || !contract.awardedOn) return [];
  const parsed = Date.parse(`${contract.awardedOn}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return [];
  const date = new Date(parsed);

  return [
    {
      id: `fallback:${contract.id}:spending:${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`,
      fiscalYear: date.getUTCFullYear(),
      fiscalMonth: date.getUTCMonth() + 1,
      obligations: contract.amount,
      outlays: null,
      source: 'derived-fallback',
      metadata: { derived: true },
      updatedAt: contract.updatedAt
    }
  ];
}

function buildFallbackContractVehicleBindings(
  contract: BlueOriginContract,
  vehicles: Map<BlueOriginVehicleSlug, Awaited<ReturnType<typeof fetchBlueOriginVehicles>>['items'][number]>,
  engines: Map<BlueOriginEngineSlug, Awaited<ReturnType<typeof fetchBlueOriginEngines>>['items'][number]>
) {
  const fallback = [] as Array<{ vehicleSlug: BlueOriginVehicleSlug | null; engineSlug: BlueOriginEngineSlug | null; confidence: number }>;

  if (contract.missionKey === 'blue-moon') {
    fallback.push({ vehicleSlug: 'blue-moon', engineSlug: 'be-7', confidence: 0.9 });
  } else if (contract.missionKey === 'new-glenn') {
    fallback.push({ vehicleSlug: 'new-glenn', engineSlug: 'be-4', confidence: 0.9 });
  } else if (contract.missionKey === 'new-shepard') {
    fallback.push({ vehicleSlug: 'new-shepard', engineSlug: 'be-3pm', confidence: 0.8 });
  } else if (contract.missionKey === 'be-4') {
    fallback.push({ vehicleSlug: null, engineSlug: 'be-4', confidence: 0.85 });
  }

  return fallback.map<BlueOriginContractVehicleBinding>((entry, index) => ({
    id: `fallback:${contract.id}:vehicle:${index + 1}`,
    vehicleSlug: entry.vehicleSlug,
    engineSlug: entry.engineSlug,
    matchMethod: 'rule',
    confidence: entry.confidence,
    metadata: { derived: true, missionKey: contract.missionKey },
    vehicle: entry.vehicleSlug ? vehicles.get(entry.vehicleSlug) || null : null,
    engine: entry.engineSlug ? engines.get(entry.engineSlug) || null : null
  }));
}

function matchesNoticeToContract(row: OpportunityNoticeRow, contract: BlueOriginContract) {
  const contractToken = normalizeContractSearchToken(contract.contractKey);
  const haystack = normalizeContractSearchToken(
    `${row.notice_id || ''} ${row.solicitation_id || ''} ${row.title || ''} ${JSON.stringify(row.metadata || {})}`
  );

  if (!haystack) return false;
  if (contractToken && haystack.includes(contractToken)) return true;
  if (haystack.includes('blue origin') && haystack.includes(contract.missionKey.replace(/-/g, ' '))) return true;
  if (contract.missionKey === 'new-glenn' && haystack.includes('new glenn')) return true;
  if (contract.missionKey === 'blue-moon' && (haystack.includes('blue moon') || haystack.includes('hls') || haystack.includes('lunar'))) {
    return true;
  }
  return false;
}

function normalizeContractSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 128);
}

function normalizeContractSearchToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeVehicleSlug(value: string | null | undefined): BlueOriginVehicleSlug | null {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (normalized === 'new-shepard') return normalized;
  if (normalized === 'new-glenn') return normalized;
  if (normalized === 'blue-moon') return normalized;
  if (normalized === 'blue-ring') return normalized;
  return null;
}

function normalizeEngineSlug(value: string | null | undefined): BlueOriginEngineSlug | null {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (normalized === 'be-3pm') return normalized;
  if (normalized === 'be-3u') return normalized;
  if (normalized === 'be-4') return normalized;
  if (normalized === 'be-7') return normalized;
  return null;
}

function toMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isGovernmentContract(contract: BlueOriginContract) {
  const sourceClass = String(contract.metadata?.sourceClass || '').toLowerCase();
  if (sourceClass.includes('government')) return true;
  const agency = String(contract.agency || '').toLowerCase();
  const customer = String(contract.customer || '').toLowerCase();
  return agency.includes('nasa') || agency.includes('space force') || customer.includes('nasa') || customer.includes('space force');
}

function chunkArray<T>(values: T[], size: number) {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function finiteNumberOrZero(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
