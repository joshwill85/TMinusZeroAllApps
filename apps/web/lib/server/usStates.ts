const US_STATE_CODE_TO_NAME = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia'
} as const;

const US_STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_CODE_TO_NAME).map(([code, name]) => [name.toUpperCase(), code])
);

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function toPostgrestValue(value: string) {
  const simpleToken = /^[A-Za-z0-9_.:-]+$/.test(value);
  if (simpleToken) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function toUsStateCode(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  if (upper in US_STATE_CODE_TO_NAME) return upper;
  return US_STATE_NAME_TO_CODE[upper] || null;
}

export function getUsStateNameFromCode(code: string | null) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return US_STATE_CODE_TO_NAME[normalized as keyof typeof US_STATE_CODE_TO_NAME] || null;
}

export function inferUsStateCodeFromLocation(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();

  for (const [stateName, stateCode] of Object.entries(US_STATE_NAME_TO_CODE)) {
    if (upper.includes(`, ${stateName},`)) {
      return stateCode;
    }
  }

  return null;
}

export function buildPublicStateFilterOrClause(state: string) {
  const normalizedCode = toUsStateCode(state) || state.trim().toUpperCase();
  const stateName = getUsStateNameFromCode(normalizedCode);
  const clauses = new Set<string>();

  clauses.add(`pad_state_code.eq.${toPostgrestValue(normalizedCode)}`);
  clauses.add(`pad_state.eq.${toPostgrestValue(normalizedCode)}`);

  if (stateName) {
    clauses.add(`pad_state.eq.${toPostgrestValue(stateName)}`);
    clauses.add(`pad_location_name.ilike.${toPostgrestValue(`%, ${stateName}, %`)}`);
  }

  return Array.from(clauses).join(',');
}
