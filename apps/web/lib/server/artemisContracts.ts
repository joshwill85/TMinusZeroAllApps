import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

type ContractRow = {
  id: string;
  contract_key: string;
  piid: string;
  referenced_idv_piid: string | null;
  parent_award_id: string | null;
  mission_key: string | null;
  awardee_name: string | null;
  awardee_uei: string | null;
  contract_type: string | null;
  description: string | null;
  base_award_date: string | null;
  agency_code: string | null;
  subtier_code: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ContractActionRow = {
  id: string;
  contract_id: string;
  action_key: string;
  mod_number: string | null;
  action_date: string | null;
  obligation_delta: number | null;
  obligation_cumulative: number | null;
  solicitation_id: string | null;
  sam_notice_id: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type OpportunityNoticeRow = {
  id: string;
  notice_id: string;
  solicitation_id: string | null;
  ptype: string | null;
  title: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  latest_active_version: boolean | null;
  awardee_name: string | null;
  award_amount: number | null;
  notice_url: string | null;
  attachment_count: number | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type SpendingRow = {
  id: string;
  contract_id: string;
  fiscal_year: number;
  fiscal_month: number;
  obligations: number | null;
  outlays: number | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

export type ArtemisContractSummary = {
  id: string;
  contractKey: string;
  piid: string;
  referencedIdvPiid: string | null;
  parentAwardId: string | null;
  missionKey: string | null;
  awardeeName: string | null;
  awardeeUei: string | null;
  contractType: string | null;
  description: string | null;
  baseAwardDate: string | null;
  agencyCode: string | null;
  subtierCode: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ArtemisContractAction = {
  id: string;
  contractId: string;
  actionKey: string;
  modNumber: string | null;
  actionDate: string | null;
  obligationDelta: number | null;
  obligationCumulative: number | null;
  solicitationId: string | null;
  samNoticeId: string | null;
  source: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ArtemisOpportunityNotice = {
  id: string;
  noticeId: string;
  solicitationId: string | null;
  ptype: string | null;
  title: string | null;
  postedDate: string | null;
  responseDeadline: string | null;
  latestActiveVersion: boolean;
  awardeeName: string | null;
  awardAmount: number | null;
  noticeUrl: string | null;
  attachmentCount: number | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ArtemisContractSpendingPoint = {
  id: string;
  contractId: string;
  fiscalYear: number;
  fiscalMonth: number;
  obligations: number | null;
  outlays: number | null;
  source: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ArtemisContractFamilyMember = ArtemisContractSummary;

export type ArtemisContractStory = {
  piid: string;
  members: ArtemisContractFamilyMember[];
  actions: ArtemisContractAction[];
  notices: ArtemisOpportunityNotice[];
  spending: ArtemisContractSpendingPoint[];
  bidders: string[];
};

export type ArtemisContractStoryOptions = {
  contractLimit?: number;
  actionLimit?: number;
  noticeLimit?: number;
  spendingLimit?: number;
};

export function normalizeArtemisContractPiid(value: string | null | undefined) {
  return (value || '').trim();
}

export function parseArtemisContractAwardId(value: string | null | undefined) {
  const normalized = safeDecodeText(value || '').trim();
  if (!normalized.length) return null;

  const match = /^usaspending[-: ]+(.+)$/i.exec(normalized);
  if (!match) return null;
  return match[1].trim().toUpperCase();
}

export function resolveArtemisAwardIdFromContractSeed(input: {
  contractKey: string;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const direct = parseArtemisContractAwardId(input.contractKey);
  if (direct) return direct;

  const candidates: string[] = [];

  if (input.sourceUrl) candidates.push(input.sourceUrl);
  const metadata = normalizeMetadataRecord(input.metadata);

  const pushValue = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) candidates.push(trimmed);
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const token = String(value).trim();
      if (token) candidates.push(token);
    }
  };

  [
    'sourceAwardId',
    'sourceAward',
    'source_award_id',
    'awardId',
    'award_id',
    'generatedAwardId',
    'generated_award_id',
    'usaspendingAwardId',
    'usaspending_award_id',
    'contractAwardId',
    'contract_award_id'
  ].forEach((key) => {
    pushValue(metadata[key]);
  });

  if (input.sourceUrl) {
    const fromUrl = parseArtemisAwardIdFromUrl(input.sourceUrl);
    if (fromUrl) candidates.push(fromUrl);
  }

  for (const candidate of candidates) {
    const awardId =
      parseArtemisContractAwardId(candidate) ||
      parseArtemisContractAwardId(`USASPENDING-${candidate}`) ||
      parseArtemisContractAwardId(`usaspending-${candidate}`);
    if (awardId) return awardId;
  }

  return null;
}

function normalizeMetadataRecord(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function safeDecodeText(value: string | null | undefined) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseArtemisAwardIdFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!/usaspending\.gov$/i.test(parsed.hostname) && !/\\.usaspending\.gov$/i.test(parsed.hostname)) {
      return null;
    }

    const hash = parsed.searchParams.get('hash');
    if (hash) return hash;

    const awardMatch = parsed.pathname.match(/\/award\/([^/?#]+)/i);
    if (awardMatch?.[1]) return awardMatch[1];

    return null;
  } catch {
    return null;
  }
}

function safeDecodePiid(value: string | null | undefined) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseArtemisContractPiid(value: string | null | undefined) {
  const normalized = normalizeArtemisContractPiid(safeDecodePiid(value));
  return normalized.length > 0 ? normalized : null;
}

export function buildArtemisContractHref(piid: string) {
  const normalized = parseArtemisContractPiid(piid);
  return normalized ? `/artemis/contracts/${encodeURIComponent(normalized)}` : '/artemis/contracts';
}

export const fetchArtemisContracts = cache(async (options: { piid?: string | null; limit?: number } = {}) => {
  if (!isSupabaseConfigured()) return [] as ArtemisContractSummary[];

  const supabase = createSupabasePublicClient();
  const normalizedPiid = parseArtemisContractPiid(options.piid);
  let query = supabase
    .from('artemis_contracts')
    .select(
      'id,contract_key,piid,referenced_idv_piid,parent_award_id,mission_key,awardee_name,awardee_uei,contract_type,description,base_award_date,agency_code,subtier_code,metadata,updated_at'
    )
    .order('base_award_date', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(clampLimit(options.limit ?? 200, 1, 1000));

  if (normalizedPiid) {
    query = query.eq('piid', normalizedPiid);
  }

  const { data, error } = await query;
  if (error) {
    console.error('artemis contracts query error', error);
    return [] as ArtemisContractSummary[];
  }

  return ((data || []) as ContractRow[]).map(mapContractRow);
});

export async function fetchArtemisContractActionsByPiid(piid: string, options: { limit?: number } = {}) {
  const contractIds = await fetchContractIdsByPiid(piid, options.limit ?? 300);
  if (contractIds.length === 0 || !isSupabaseConfigured()) return [] as ArtemisContractAction[];

  return fetchArtemisContractActionsByContractIds(contractIds, { limit: options.limit ?? 300 });
}

export async function fetchArtemisContractActionsByContractIds(
  contractIds: string[],
  options: { limit?: number } = {}
): Promise<ArtemisContractAction[]> {
  if (!isSupabaseConfigured() || !contractIds.length) return [] as ArtemisContractAction[];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('artemis_contract_actions')
    .select('id,contract_id,action_key,mod_number,action_date,obligation_delta,obligation_cumulative,solicitation_id,sam_notice_id,source,metadata,updated_at')
    .in('contract_id', contractIds)
    .order('action_date', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('mod_number', { ascending: false, nullsFirst: false })
    .limit(clampLimit(options.limit ?? 400, 1, 2000));

  if (error) {
    console.error('artemis contract actions query error', error);
    return [] as ArtemisContractAction[];
  }

  return sortActionRows((data || []).map(mapContractActionRow));
}

export async function fetchArtemisContractNoticesByPiid(piid: string, options: { limit?: number } = {}) {
  const actions = await fetchArtemisContractActionsByPiid(piid, { limit: 1000 });
  const solicitationIds = [...new Set(actions.map((action) => action.solicitationId).filter((value): value is string => Boolean(value)))];
  if (solicitationIds.length === 0) return [] as ArtemisOpportunityNotice[];

  const notices = await fetchArtemisContractNoticesBySolicitationIds(solicitationIds, {
    limit: options.limit
  });
  return notices;
}

export async function fetchArtemisContractNoticesByContractIds(
  contractIds: string[],
  options: { limit?: number } = {}
): Promise<ArtemisOpportunityNotice[]> {
  if (!isSupabaseConfigured() || !contractIds.length) return [] as ArtemisOpportunityNotice[];

  const actions = await fetchArtemisContractActionsByContractIds(contractIds, { limit: contractIds.length > 1 ? 1200 : 400 });
  const solicitationIds = [...new Set(actions.map((action) => action.solicitationId).filter((value): value is string => Boolean(value)))];
  if (solicitationIds.length === 0) return [] as ArtemisOpportunityNotice[];

  return fetchArtemisContractNoticesBySolicitationIds(solicitationIds, options);
}

export async function fetchArtemisContractSpendingByPiid(piid: string, options: { limit?: number } = {}) {
  const contractIds = await fetchContractIdsByPiid(piid, options.limit ?? 600);
  if (contractIds.length === 0 || !isSupabaseConfigured()) return [] as ArtemisContractSpendingPoint[];

  return fetchArtemisContractSpendingByContractIds(contractIds, { limit: options.limit ?? 600 });
}

export async function fetchArtemisContractSpendingByContractIds(
  contractIds: string[],
  options: { limit?: number } = {}
): Promise<ArtemisContractSpendingPoint[]> {
  if (!isSupabaseConfigured() || !contractIds.length) return [] as ArtemisContractSpendingPoint[];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('artemis_spending_timeseries')
    .select('id,contract_id,fiscal_year,fiscal_month,obligations,outlays,source,metadata,updated_at')
    .in('contract_id', contractIds)
    .order('fiscal_year', { ascending: false })
    .order('fiscal_month', { ascending: false })
    .limit(clampLimit(options.limit ?? 600, 1, 2400));

  if (error) {
    console.error('artemis contract spending query error', error);
    return [] as ArtemisContractSpendingPoint[];
  }

  return sortSpendingRows((data || []).map(mapSpendingRow));
}

export async function fetchArtemisContractFamilyByPiid(
  piid: string,
  options: { limit?: number } = {}
): Promise<ArtemisContractFamilyMember[]> {
  if (!isSupabaseConfigured()) return [] as ArtemisContractFamilyMember[];
  const normalizedPiid = parseArtemisContractPiid(piid);
  if (!normalizedPiid) return [] as ArtemisContractFamilyMember[];

  const { data, error } = await createSupabasePublicClient()
    .from('artemis_contracts')
    .select(
      'id,contract_key,piid,referenced_idv_piid,parent_award_id,mission_key,awardee_name,awardee_uei,contract_type,description,base_award_date,agency_code,subtier_code,metadata,updated_at'
    )
    .eq('piid', normalizedPiid)
    .order('base_award_date', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(clampLimit(options.limit ?? 200, 1, 1200));

  if (error) {
    console.error('artemis contract family query error', error);
    return [] as ArtemisContractFamilyMember[];
  }

  return sortContractMembers((data || []).map(mapContractRow));
}

export async function fetchArtemisContractStoryByPiid(
  piid: string,
  options: ArtemisContractStoryOptions = {}
): Promise<ArtemisContractStory | null> {
  const normalizedPiid = parseArtemisContractPiid(piid);
  if (!normalizedPiid || !isSupabaseConfigured()) return null;

  const members = await fetchArtemisContractFamilyByPiid(normalizedPiid, {
    limit: options.contractLimit
  });
  if (!members.length) return null;

  const contractIds = dedupeStringList(members.map((member) => member.id));

  const [actions, notices, spending] = await Promise.all([
    fetchArtemisContractActionsByContractIds(contractIds, { limit: options.actionLimit ?? 1200 }),
    fetchArtemisContractNoticesByContractIds(contractIds, { limit: options.noticeLimit ?? 1000 }),
    fetchArtemisContractSpendingByContractIds(contractIds, { limit: options.spendingLimit ?? 1200 })
  ]);

  return {
    piid: normalizedPiid,
    members,
    actions,
    notices,
    spending,
    bidders: buildBidderList(notices)
  };
}

export async function fetchArtemisContractStoryByAwardId(
  awardId: string,
  options: ArtemisContractStoryOptions = {}
): Promise<ArtemisContractStory | null> {
  const normalizedAwardId = parseArtemisContractAwardId(awardId);
  if (!normalizedAwardId || !isSupabaseConfigured()) return null;

  const members = await fetchArtemisContractFamilyByAwardId(normalizedAwardId, {
    limit: options.contractLimit
  });
  if (!members.length) return null;

  const contractIds = dedupeStringList(members.map((member) => member.id));

  const [actions, notices, spending] = await Promise.all([
    fetchArtemisContractActionsByContractIds(contractIds, { limit: options.actionLimit ?? 1200 }),
    fetchArtemisContractNoticesByContractIds(contractIds, { limit: options.noticeLimit ?? 1000 }),
    fetchArtemisContractSpendingByContractIds(contractIds, { limit: options.spendingLimit ?? 1200 })
  ]);

  const primaryPiid = members.find((member) => member.piid && member.piid.length > 0)?.piid || normalizedAwardId;

  return {
    piid: primaryPiid,
    members,
    actions,
    notices,
    spending,
    bidders: buildBidderList(notices)
  };
}

async function fetchArtemisContractNoticesBySolicitationIds(
  solicitationIds: string[],
  options: { limit?: number } = {}
): Promise<ArtemisOpportunityNotice[]> {
  if (!isSupabaseConfigured() || solicitationIds.length === 0) return [] as ArtemisOpportunityNotice[];

  const { data, error } = await createSupabasePublicClient()
    .from('artemis_opportunity_notices')
    .select('id,notice_id,solicitation_id,ptype,title,posted_date,response_deadline,latest_active_version,awardee_name,award_amount,notice_url,attachment_count,metadata,updated_at')
    .in('solicitation_id', solicitationIds)
    .order('posted_date', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(clampLimit(options.limit ?? 250, 1, 2000));

  if (error) {
    console.error('artemis contract notices query error', error);
    return [] as ArtemisOpportunityNotice[];
  }

  return sortNoticeRows((data || []).map(mapOpportunityNoticeRow));
}

async function fetchContractIdsByPiid(piid: string, limit: number) {
  if (!isSupabaseConfigured()) return [] as string[];
  const normalizedPiid = parseArtemisContractPiid(piid);
  if (!normalizedPiid) return [] as string[];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('artemis_contracts')
    .select('id')
    .eq('piid', normalizedPiid)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(clampLimit(limit, 1, 1200));

  if (error) {
    console.error('artemis contract id lookup error', error);
    return [] as string[];
  }

  return dedupeStringList(((data || []) as Array<{ id: string }>).map((row) => row.id));
}

async function fetchArtemisContractFamilyByAwardId(
  awardId: string,
  options: { limit?: number } = {}
): Promise<ArtemisContractFamilyMember[]> {
  if (!isSupabaseConfigured()) return [] as ArtemisContractFamilyMember[];
  const normalizedAwardId = awardId.trim().toUpperCase();
  if (!normalizedAwardId) return [] as ArtemisContractFamilyMember[];

  const [directRows, contractKeyRows, metadataRows] = await Promise.all([
    fetchArtemisContractRowsByAwardId((query) => query.eq('piid', normalizedAwardId)),
    fetchArtemisContractRowsByAwardId((query) => query.like('contract_key', `${normalizedAwardId}|%`)),
    fetchArtemisContractRowsByAwardId((query) => query.filter('metadata->>sourceAwardId', 'eq', normalizedAwardId))
  ]);

  const merged = dedupeContractRows(directRows.concat(contractKeyRows).concat(metadataRows));

  if (!merged.length) return [] as ArtemisContractFamilyMember[];

  return merged
    .sort((a, b) => {
      const aTime = Date.parse(a.base_award_date || '');
      const bTime = Date.parse(b.base_award_date || '');
      if (aTime !== bTime) return bTime - aTime;
      return b.updated_at ? b.updated_at.localeCompare(a.updated_at || '') : 0;
    })
    .slice(0, clampLimit(options.limit ?? 200, 1, 1200))
    .map(mapContractRow);
}

async function fetchArtemisContractRowsByAwardId(queryBuilder: (query: any) => any): Promise<Array<ContractRow>> {
  if (!isSupabaseConfigured()) return [] as Array<ContractRow>;

  const { data, error } = await queryBuilder(
    createSupabasePublicClient()
      .from('artemis_contracts')
      .select(
        'id,contract_key,piid,referenced_idv_piid,parent_award_id,mission_key,awardee_name,awardee_uei,contract_type,description,base_award_date,agency_code,subtier_code,metadata,updated_at'
      )
      .order('base_award_date', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1200)
  );

  if (error) {
    console.error('artemis contract story lookup by award id error', error);
    return [] as Array<ContractRow>;
  }

  return (data || []) as Array<ContractRow>;
}

function dedupeContractRows(rows: ContractRow[]) {
  const map = new Map<string, ContractRow>();
  for (const row of rows) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  return [...map.values()];
}

function mapContractRow(row: ContractRow): ArtemisContractSummary {
  return {
    id: row.id,
    contractKey: row.contract_key,
    piid: row.piid,
    referencedIdvPiid: row.referenced_idv_piid,
    parentAwardId: row.parent_award_id,
    missionKey: row.mission_key,
    awardeeName: row.awardee_name,
    awardeeUei: row.awardee_uei,
    contractType: row.contract_type,
    description: row.description,
    baseAwardDate: row.base_award_date,
    agencyCode: row.agency_code,
    subtierCode: row.subtier_code,
    sourceUrl: null,
    updatedAt: row.updated_at,
    metadata: (row.metadata || {}) as Record<string, unknown>
  };
}

function mapContractActionRow(row: ContractActionRow): ArtemisContractAction {
  return {
    id: row.id,
    contractId: row.contract_id,
    actionKey: row.action_key,
    modNumber: row.mod_number,
    actionDate: row.action_date,
    obligationDelta: row.obligation_delta,
    obligationCumulative: row.obligation_cumulative,
    solicitationId: row.solicitation_id,
    samNoticeId: row.sam_notice_id,
    source: row.source,
    updatedAt: row.updated_at,
    metadata: (row.metadata || {}) as Record<string, unknown>
  };
}

function mapOpportunityNoticeRow(row: OpportunityNoticeRow): ArtemisOpportunityNotice {
  return {
    id: row.id,
    noticeId: row.notice_id,
    solicitationId: row.solicitation_id,
    ptype: row.ptype,
    title: row.title,
    postedDate: row.posted_date,
    responseDeadline: row.response_deadline,
    latestActiveVersion: Boolean(row.latest_active_version),
    awardeeName: row.awardee_name,
    awardAmount: row.award_amount,
    noticeUrl: row.notice_url,
    attachmentCount: row.attachment_count,
    updatedAt: row.updated_at,
    metadata: (row.metadata || {}) as Record<string, unknown>
  };
}

function mapSpendingRow(row: SpendingRow): ArtemisContractSpendingPoint {
  return {
    id: row.id,
    contractId: row.contract_id,
    fiscalYear: row.fiscal_year,
    fiscalMonth: row.fiscal_month,
    obligations: row.obligations,
    outlays: row.outlays,
    source: row.source,
    updatedAt: row.updated_at,
    metadata: (row.metadata || {}) as Record<string, unknown>
  };
}

function sortContractMembers(members: ArtemisContractFamilyMember[]) {
  return [...members].sort((a, b) => {
    const aTime = Date.parse(a.baseAwardDate || '');
    const bTime = Date.parse(b.baseAwardDate || '');
    const baseDateCmp = bTime - aTime;
    if (baseDateCmp !== 0) return baseDateCmp;
    return b.updatedAt ? b.updatedAt.localeCompare(a.updatedAt || '') : 0;
  });
}

function sortActionRows(rows: ArtemisContractAction[]) {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.actionDate || '');
    const bTime = Date.parse(b.actionDate || '');
    if (aTime !== bTime) return bTime - aTime;
    return String(b.actionKey).localeCompare(String(a.actionKey));
  });
}

function sortNoticeRows(rows: ArtemisOpportunityNotice[]) {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.postedDate || '');
    const bTime = Date.parse(b.postedDate || '');
    if (aTime !== bTime) return bTime - aTime;
    return b.updatedAt && a.updatedAt ? b.updatedAt.localeCompare(a.updatedAt) : 0;
  });
}

function sortSpendingRows(rows: ArtemisContractSpendingPoint[]) {
  return [...rows].sort((a, b) => {
    if (b.fiscalYear !== a.fiscalYear) return b.fiscalYear - a.fiscalYear;
    if (b.fiscalMonth !== a.fiscalMonth) return b.fiscalMonth - a.fiscalMonth;
    return b.updatedAt && a.updatedAt ? b.updatedAt.localeCompare(a.updatedAt) : 0;
  });
}

function buildBidderList(notices: ArtemisOpportunityNotice[]) {
  const names = new Set<string>();
  for (const notice of notices) {
    const normalizedName = normalizeAwardeeName(notice.awardeeName);
    if (normalizedName) {
      names.add(normalizedName);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function normalizeAwardeeName(value: string | null) {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeStringList(values: string[]) {
  return [...new Set(values.filter((value) => Boolean(value)))];
}

function clampLimit(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
