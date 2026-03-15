export const SEARCH_RESULT_TYPES = [
  'launch',
  'hub',
  'guide',
  'news',
  'contract',
  'person',
  'recovery',
  'catalog',
  'page'
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export type SiteSearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  badge: string | null;
};

export type SiteSearchResponse = {
  query: string;
  results: SiteSearchResult[];
  tookMs: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ParsedSiteSearchInput = {
  query: string | null;
  types: SearchResultType[];
  hasPositiveTerms: boolean;
};

const TYPE_ALIAS_MAP: Record<string, SearchResultType> = {
  launch: 'launch',
  launches: 'launch',
  hub: 'hub',
  hubs: 'hub',
  guide: 'guide',
  guides: 'guide',
  news: 'news',
  article: 'news',
  articles: 'news',
  contract: 'contract',
  contracts: 'contract',
  person: 'person',
  people: 'person',
  crew: 'person',
  traveler: 'person',
  travelers: 'person',
  recovery: 'recovery',
  catalog: 'catalog',
  page: 'page',
  pages: 'page'
};

const QUERY_FIELD_ALIASES = new Set([
  'name',
  'title',
  'provider',
  'agency',
  'vehicle',
  'rocket',
  'mission',
  'payload',
  'pad',
  'site',
  'launchsite',
  'state',
  'region',
  'status',
  'designator',
  'id'
]);

function collapseWhitespace(value: string) {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function scanTokens(raw: string) {
  const tokens: string[] = [];
  let idx = 0;

  while (idx < raw.length) {
    while (idx < raw.length && /\s/.test(raw[idx] || '')) idx += 1;
    if (idx >= raw.length) break;

    if (raw[idx] === '"') {
      let token = '"';
      idx += 1;
      while (idx < raw.length && raw[idx] !== '"') {
        token += raw[idx];
        idx += 1;
      }
      if (idx < raw.length && raw[idx] === '"') {
        token += '"';
        idx += 1;
      }
      tokens.push(token);
      continue;
    }

    let token = '';
    while (idx < raw.length && !/\s/.test(raw[idx] || '')) {
      token += raw[idx];
      idx += 1;
    }
    if (token) tokens.push(token);
  }

  return tokens;
}

export function normalizeSiteSearchInput(raw: string | null | undefined) {
  if (typeof raw !== 'string') return null;
  const collapsed = collapseWhitespace(raw).slice(0, 160);
  return collapsed || null;
}

export function parseSiteSearchTypesParam(raw: string | null | undefined) {
  if (typeof raw !== 'string') return [] as SearchResultType[];
  const seen = new Set<SearchResultType>();
  raw
    .split(',')
    .map((entry) => TYPE_ALIAS_MAP[entry.trim().toLowerCase()])
    .filter(Boolean)
    .forEach((value) => {
      seen.add(value);
    });
  return [...seen];
}

export function parseSiteSearchInput(raw: string | null | undefined): ParsedSiteSearchInput {
  const normalized = normalizeSiteSearchInput(raw);
  if (!normalized) {
    return { query: null, types: [], hasPositiveTerms: false };
  }

  const types = new Set<SearchResultType>();
  const keptTokens: string[] = [];
  let hasPositiveTerms = false;

  for (const token of scanTokens(normalized)) {
    const lowered = token.toLowerCase();
    const negated = lowered.startsWith('-');
    const candidate = negated ? lowered.slice(1) : lowered;
    if (candidate.startsWith('type:')) {
      candidate
        .slice(5)
        .split(',')
        .map((value) => TYPE_ALIAS_MAP[value.trim()])
        .filter(Boolean)
        .forEach((value) => {
          types.add(value);
        });
      continue;
    }

    const fieldSeparator = candidate.indexOf(':');
    if (fieldSeparator > 0) {
      const field = candidate.slice(0, fieldSeparator);
      const value = token.slice(token.indexOf(':') + 1).trim();
      if (QUERY_FIELD_ALIASES.has(field) && value) {
        keptTokens.push(`${negated ? '-' : ''}${value}`);
        if (!negated) hasPositiveTerms = true;
        continue;
      }
    }

    keptTokens.push(token);
    if (!negated) hasPositiveTerms = true;
  }

  const query = collapseWhitespace(keptTokens.join(' ')) || null;
  return {
    query,
    types: [...types],
    hasPositiveTerms: Boolean(query) && hasPositiveTerms
  };
}
