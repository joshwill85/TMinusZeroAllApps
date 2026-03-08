export type ProgramScope = 'artemis' | 'blue-origin' | 'spacex';

export type ProgramUsaspendingAuditTier = 'exact' | 'candidate' | 'excluded';

export type ProgramUsaspendingReviewStatus =
  | 'unreviewed'
  | 'confirmed'
  | 'suppressed';

export type UsaSpendingRecipientSnapshot = {
  recipientName?: string | null;
  parentRecipientName?: string | null;
  recipientUei?: string | null;
  parentRecipientUei?: string | null;
};

export type UsaSpendingAwardAuditInput = {
  awardId?: string | null;
  title?: string | null;
  recipient?: string | null;
  awardedOn?: string | null;
  metadata?: Record<string, unknown> | null;
  liveRecipient?: UsaSpendingRecipientSnapshot | null;
  storyLinked?: boolean;
};

export type UsaSpendingScopeClassification = {
  scope: ProgramScope;
  tier: ProgramUsaspendingAuditTier;
  score: number;
  canonicalRecipientMatch: boolean;
  reasonCodes: string[];
  signals: string[];
  matchedProgramScopes: ProgramScope[];
};

type SignalPattern = {
  rx: RegExp;
  label: string;
};

type ProgramUsaspendingAwardFamily =
  | 'contracts'
  | 'idvs'
  | 'grants'
  | 'loans'
  | 'direct_payments'
  | 'other_financial_assistance'
  | 'unknown';

type CompanySupportStrength = 'none' | 'weak' | 'strong';

type CompanySupportEvaluation = {
  strength: CompanySupportStrength;
  score: number;
  reasonCodes: string[];
  signals: string[];
};

const BLUE_ORIGIN_COMPANY_RX = /\bblue\s*origin\b/i;
const BLUE_MOON_RX = /\bblue\s*moon\b/i;
const NEW_GLENN_RX = /\bnew\s*glenn\b/i;
const NEW_SHEPARD_RX = /\bnew\s*shep(?:a|h)rd\b/i;
const BE4_RX = /\bbe-4\b/i;
const BE7_RX = /\bbe-7\b/i;

const SPACEX_COMPANY_RX = /\bspace\s*x\b|\bspacex\b|\bspace exploration technologies\b/i;
const FALCON9_RX = /\bfalcon\s*9\b/i;
const FALCON_HEAVY_RX = /\bfalcon\s*heavy\b/i;
const DRAGON_RX = /\bdragon\b/i;
const STARSHIP_RX = /\bstarship\b/i;
const STARLINK_RX = /\bstarlink\b/i;

const COMPANY_PRIMARY_AWARD_FAMILIES = new Set<ProgramUsaspendingAwardFamily>([
  'contracts',
  'idvs'
]);

const COMPANY_REVIEWABLE_AWARD_FAMILIES = new Set<ProgramUsaspendingAwardFamily>([
  'contracts',
  'idvs',
  'grants',
  'unknown'
]);

const COMPANY_EXCLUDED_AWARD_FAMILIES = new Set<ProgramUsaspendingAwardFamily>([
  'loans',
  'direct_payments',
  'other_financial_assistance'
]);

const COMMON_MERCHANDISE_NEGATIVE_RX = /\bmodel\b|\breplica\b|\btoy\b|\bposter\b/i;
const BLUE_ORIGIN_BLUE_MOON_CONTEXT_RX =
  /\blander\b|\blunar\b|\bhls\b|\bhuman\s+landing\s+system\b|\bartemis\b|\bmk[-\s]?1\b|\bmk[-\s]?2\b/i;
const BLUE_ORIGIN_NEW_SHEPARD_CONTEXT_RX =
  /\bsuborbital\b|\bmicrogravity\b|\bpayload\b|\bflight\b|\bvehicle\b|\bbooster\b|\bcapsule\b/i;
const BLUE_ORIGIN_NEW_GLENN_CONTEXT_RX =
  /\borbital\b|\blaunch\b|\blaunch\s+vehicle\b|\bfairing\b|\bpayload\b|\brocket\b/i;
const BLUE_ORIGIN_ENGINE_CONTEXT_RX =
  /\bengine\b|\bpropulsion\b|\bvulcan\b|\bnew\s*glenn\b|\blunar\b/i;
const BLUE_ORIGIN_GENERAL_SUPPORT_RX =
  /\bsupport\b|\btask order\b|\boperations?\b|\binfrastructure\b|\brepair\b|\bfabrication\b|\binstallation\b|\btesting?\b|\banalys(?:is|es)\b|\bcontract\b|\bservices?\b|\bsafety\b/i;

const SPACEX_FALCON_CONTEXT_RX =
  /\blaunch\b|\bmission\b|\bvehicle\b|\bflight\b|\bstatic\s+fire\b|\bpre-?launch\b|\bscrub\b|\brange\b|\bradar\b|\brd-?160\b|\bcat\s+\d+\s+launch\s+support\b|\blaunch\s+support\b/i;
const SPACEX_DRAGON_CONTEXT_RX =
  /\bcapsule\b|\btrunk\b|\bcargo\b|\bcrew\b|\bcommercial\s+crew\b|\bcommercial\s+resupply\b|\bcrs[-\s]?\d+\b|\bcots\b|\bdock(?:ing|ed)?\b|\biss\b|\bspace\s+station\b|\breentry\b/i;
const SPACEX_STARSHIP_CONTEXT_RX =
  /\bsuper\s+heavy\b|\braptor\b|\bhls\b|\bhuman\s+landing\s+system\b|\bstarbase\b|\bartemis\b/i;
const SPACEX_STARLINK_CONTEXT_RX =
  /\bservice\b|\bservices\b|\bsubscription\b|\bterminal\b|\bhardware\b|\bkit\b|\bdish(?:es)?\b|\bsatellite\s+internet\b|\bpriority\b|\bcommunications?\b|\bcomms?\b|\bconnect(?:ion|ivity)\b|\bbill\b/i;
const SPACEX_GENERAL_SUPPORT_RX =
  /\bsupport\b|\bcoordination\b|\btest(?:ing)?\b|\blaunch\b|\bmission\b|\bservices?\b|\bhardware\b|\bterminal\b|\bkit\b|\brenewal\b|\bsubscription\b|\bspare\b/i;

const ARTEMIS_STRONG_POSITIVE_SIGNALS: SignalPattern[] = [
  { rx: /\bartemis\s*(i|ii|iii|iv|v|vi|vii|1|2|3|4|5|6|7)\b/i, label: 'mission' },
  { rx: /\bspace\s+launch\s+system\b|\bsls\b/i, label: 'sls' },
  { rx: /\borion\b/i, label: 'orion' },
  { rx: /\bexploration\s+ground\s+systems?\b|\begs\b/i, label: 'egs' },
  { rx: /\bhuman\s+landing\s+system\b|\bhls\b/i, label: 'hls' },
  { rx: /\bgateway\b/i, label: 'gateway' },
  { rx: /\bx[-\s]?eva\b|\bxev\w+\b|\bextravehicular\b/i, label: 'xeva' },
  { rx: /\bmoon\s+to\s+mars\b|\bmoon-to-mars\b/i, label: 'moon_to_mars' },
  {
    rx: /\bmobile\s+launcher\b|\bml[-\s]?1\b|\bvehicle\s+assembly\s+building\b|\bvab\b/i,
    label: 'ground_systems'
  },
  { rx: /\besdmd\b|\bexploration\s+systems\s+development\b/i, label: 'esdmd' },
  { rx: /\blunar\s+terrain\s+vehicle\b|\bltv\b/i, label: 'ltv' }
];

const ARTEMIS_WEAK_POSITIVE_SIGNALS: SignalPattern[] = [
  { rx: /\bartemis\b/i, label: 'artemis' },
  { rx: /\blunar\b/i, label: 'lunar' },
  { rx: /\bmoon\b/i, label: 'moon' }
];

const ARTEMIS_NEGATIVE_SIGNALS: SignalPattern[] = [
  { rx: /\bastrophys\w*\b/i, label: 'astrophysics' },
  { rx: /\bastronom\w*\b/i, label: 'astronomy' },
  { rx: /\bgalax\w*\b/i, label: 'galaxy' },
  { rx: /\bjwst\b|\bjames\s+webb\b/i, label: 'jwst' },
  { rx: /\bluvoir\b|\bhabex\b/i, label: 'luvoir_habex' },
  { rx: /\bcosmic\s+origins\b/i, label: 'cosmic_origins' },
  { rx: /\bapra\b/i, label: 'apra' },
  { rx: /\broman\b/i, label: 'roman' },
  { rx: /\bspectro(graph|scop)|\bspectroscop\w*\b/i, label: 'spectroscopy' },
  { rx: /\bintergalactic\b|\bigm\b/i, label: 'igm' },
  { rx: /\bionizing\b/i, label: 'ionizing' },
  { rx: /\bultraviolet\b|\bfuv\b|\bfar-?uv\b/i, label: 'uv' },
  { rx: /\bastrobiolog\w*\b/i, label: 'astrobiology' }
];

export function normalizeProgramScope(value: unknown): ProgramScope | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'artemis') return 'artemis';
  if (
    normalized === 'blue-origin' ||
    normalized === 'blue_origin' ||
    normalized === 'blueorigin' ||
    normalized === 'blue'
  ) {
    return 'blue-origin';
  }
  if (
    normalized === 'spacex' ||
    normalized === 'space-x' ||
    normalized === 'space_x' ||
    normalized === 'space x'
  ) {
    return 'spacex';
  }
  return null;
}

export function readProgramScopes(
  metadata: Record<string, unknown> | null | undefined,
  fallbackScope: ProgramScope | null = null
) {
  const out = new Set<ProgramScope>();
  const direct = normalizeProgramScope(
    readString(metadata?.programScope) || readString(metadata?.program_scope)
  );
  if (direct) out.add(direct);

  const values = readStringArray(metadata?.programScopes).concat(
    readStringArray(metadata?.program_scopes)
  );
  for (const value of values) {
    const normalized = normalizeProgramScope(value);
    if (normalized) out.add(normalized);
  }

  if (out.size < 1 && fallbackScope) out.add(fallbackScope);
  return [...out.values()];
}

export function buildUsaspendingAwardIdentityKey(input: {
  awardId?: string | null;
  title?: string | null;
  recipient?: string | null;
  awardedOn?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const awardId = normalizeIdentityComponent(input.awardId, 256);
  if (awardId) return `award:${awardId}`;

  const sourceUrl = normalizeIdentityComponent(resolveSourceUrl(input.metadata), 240);
  const title = normalizeIdentityComponent(input.title, 160);
  const recipient = normalizeIdentityComponent(input.recipient, 120);
  const awardedOn = normalizeIdentityDate(input.awardedOn);
  const fallback = [title, recipient, awardedOn, sourceUrl]
    .filter((value) => value.length > 0)
    .join('|');

  return `fallback:${fallback || 'unknown'}`;
}

export function extractRecipientSnapshot(
  metadata: Record<string, unknown> | null | undefined
): UsaSpendingRecipientSnapshot {
  const sourceRow = asRecord(metadata?.sourceRow);
  return {
    recipientName:
      readString(sourceRow['Recipient Name']) ||
      readString(sourceRow.recipient_name) ||
      readString(sourceRow.recipientName) ||
      null,
    parentRecipientName:
      readString(sourceRow['Parent Recipient Name']) ||
      readString(sourceRow.parent_recipient_name) ||
      readString(sourceRow.parentRecipientName) ||
      null,
    recipientUei:
      readString(sourceRow['Recipient UEI']) ||
      readString(sourceRow.recipient_uei) ||
      readString(sourceRow.recipientUei) ||
      null,
    parentRecipientUei:
      readString(sourceRow['Parent Recipient UEI']) ||
      readString(sourceRow.parent_recipient_uei) ||
      readString(sourceRow.parentRecipientUei) ||
      null
  };
}

export function classifyUsaspendingAwardForScope(
  input: UsaSpendingAwardAuditInput,
  scope: ProgramScope
): UsaSpendingScopeClassification {
  if (scope === 'artemis') return classifyArtemisSupport(input);
  return classifyCompanyHub(input, scope);
}

function classifyCompanyHub(
  input: UsaSpendingAwardAuditInput,
  scope: 'blue-origin' | 'spacex'
): UsaSpendingScopeClassification {
  const metadata = input.metadata || {};
  const snapshot = mergeRecipientSnapshots(input.metadata, input.liveRecipient);
  const combinedRecipient = [input.recipient, snapshot.recipientName, snapshot.parentRecipientName]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');
  const canonicalRecipientMatch = matchesCanonicalCompanyRecipient(scope, combinedRecipient);
  const matchedProgramScopes = readProgramScopes(metadata, null);
  const awardFamily = resolveAwardFamily(metadata);
  const primaryFamily = isPrimaryCompanyAwardFamily(metadata, awardFamily);
  const reviewableFamily = primaryFamily || COMPANY_REVIEWABLE_AWARD_FAMILIES.has(awardFamily);

  if (canonicalRecipientMatch) {
    if (primaryFamily) {
      return {
        scope,
        tier: 'exact',
        score: 100,
        canonicalRecipientMatch: true,
        reasonCodes: ['canonical_recipient_match'],
        signals: ['canonical_recipient'],
        matchedProgramScopes
      };
    }

    if (reviewableFamily) {
      return {
        scope,
        tier: 'candidate',
        score: 60,
        canonicalRecipientMatch: true,
        reasonCodes: ['canonical_recipient_non_contract_family'],
        signals: ['canonical_recipient'],
        matchedProgramScopes
      };
    }

    return {
      scope,
      tier: 'excluded',
      score: 0,
      canonicalRecipientMatch: true,
      reasonCodes: ['disallowed_award_family'],
      signals: ['canonical_recipient'],
      matchedProgramScopes
    };
  }

  if (COMPANY_EXCLUDED_AWARD_FAMILIES.has(awardFamily)) {
    return {
      scope,
      tier: 'excluded',
      score: 0,
      canonicalRecipientMatch: false,
      reasonCodes: ['disallowed_award_family'],
      signals: [],
      matchedProgramScopes
    };
  }

  const text = buildCompanySupportText(input);
  const support =
    scope === 'blue-origin'
      ? classifyBlueOriginSupport(text)
      : classifySpaceXSupport(text);

  if (support.strength === 'strong') {
    if (primaryFamily) {
      return {
        scope,
        tier: 'exact',
        score: 80 + support.score,
        canonicalRecipientMatch: false,
        reasonCodes: ['strong_company_support_signal', ...support.reasonCodes],
        signals: uniqueStrings(support.signals),
        matchedProgramScopes
      };
    }

    if (reviewableFamily) {
      return {
        scope,
        tier: 'candidate',
        score: 40 + support.score,
        canonicalRecipientMatch: false,
        reasonCodes: ['strong_company_support_signal_non_contract_family', ...support.reasonCodes],
        signals: uniqueStrings(support.signals),
        matchedProgramScopes
      };
    }
  }

  if (support.strength === 'weak' && reviewableFamily) {
    return {
      scope,
      tier: 'candidate',
      score: 20 + support.score,
      canonicalRecipientMatch: false,
      reasonCodes: ['partial_company_support_signal', ...support.reasonCodes],
      signals: uniqueStrings(support.signals),
      matchedProgramScopes
    };
  }

  return {
    scope,
    tier: 'excluded',
    score: 0,
    canonicalRecipientMatch: false,
    reasonCodes:
      support.reasonCodes.length > 0 ? uniqueStrings(support.reasonCodes) : ['no_company_support_signal'],
    signals: uniqueStrings(support.signals),
    matchedProgramScopes
  };
}

function classifyArtemisSupport(
  input: UsaSpendingAwardAuditInput
): UsaSpendingScopeClassification {
  const text = buildSearchText(input);
  const matchedProgramScopes = readProgramScopes(input.metadata, null);
  const signals: string[] = [];
  const strongHits = countRegexHits(text, ARTEMIS_STRONG_POSITIVE_SIGNALS, signals);
  const weakHits = countRegexHits(text, ARTEMIS_WEAK_POSITIVE_SIGNALS, signals);
  const negativeHits = countRegexHits(text, ARTEMIS_NEGATIVE_SIGNALS, signals);
  const score = strongHits * 3 + weakHits - negativeHits * 2;

  if (input.storyLinked) {
    return {
      scope: 'artemis',
      tier: 'exact',
      score: Math.max(score, 100),
      canonicalRecipientMatch: false,
      reasonCodes: ['story_linked'],
      signals: uniqueStrings(['story_link', ...signals]),
      matchedProgramScopes
    };
  }

  if (strongHits > 0) {
    return {
      scope: 'artemis',
      tier: 'exact',
      score,
      canonicalRecipientMatch: false,
      reasonCodes: ['strong_program_support_signal'],
      signals: uniqueStrings(signals),
      matchedProgramScopes
    };
  }

  if (negativeHits > 0 && weakHits > 0) {
    return {
      scope: 'artemis',
      tier: 'excluded',
      score,
      canonicalRecipientMatch: false,
      reasonCodes: ['negative_signal_collision'],
      signals: uniqueStrings(signals),
      matchedProgramScopes
    };
  }

  if (weakHits > 0) {
    return {
      scope: 'artemis',
      tier: 'candidate',
      score,
      canonicalRecipientMatch: false,
      reasonCodes: ['weak_program_support_signal'],
      signals: uniqueStrings(signals),
      matchedProgramScopes
    };
  }

  return {
    scope: 'artemis',
    tier: 'excluded',
    score,
    canonicalRecipientMatch: false,
    reasonCodes: ['no_program_support_signal'],
    signals: [],
    matchedProgramScopes
  };
}

function matchesCanonicalCompanyRecipient(
  scope: 'blue-origin' | 'spacex',
  combinedRecipient: string
) {
  if (!combinedRecipient) return false;
  if (scope === 'blue-origin') {
    return /\bblue\s*origin\b/.test(combinedRecipient);
  }

  if (/\bspace\s+exploration\s+technologies\b/.test(combinedRecipient)) {
    return true;
  }

  const normalizedRecipient = combinedRecipient
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^spacex(?:\s+(?:corp(?:oration)?|inc(?:orporated)?|llc|co(?:mpany)?))?$/.test(normalizedRecipient);
}

function mergeRecipientSnapshots(
  metadata: Record<string, unknown> | null | undefined,
  liveRecipient: UsaSpendingRecipientSnapshot | null | undefined
) {
  const stored = extractRecipientSnapshot(metadata);
  return {
    recipientName: liveRecipient?.recipientName || stored.recipientName || null,
    parentRecipientName:
      liveRecipient?.parentRecipientName || stored.parentRecipientName || null,
    recipientUei: liveRecipient?.recipientUei || stored.recipientUei || null,
    parentRecipientUei:
      liveRecipient?.parentRecipientUei || stored.parentRecipientUei || null
  };
}

function classifyBlueOriginSupport(text: string): CompanySupportEvaluation {
  const signals: string[] = [];
  const hasCompany = collectRegexSignal(text, BLUE_ORIGIN_COMPANY_RX, 'blue_origin', signals);
  const hasBlueMoon = collectRegexSignal(text, BLUE_MOON_RX, 'blue_moon', signals);
  const hasNewGlenn = collectRegexSignal(text, NEW_GLENN_RX, 'new_glenn', signals);
  const hasNewShepard = collectRegexSignal(text, NEW_SHEPARD_RX, 'new_shepard', signals);
  const hasBe4 = collectRegexSignal(text, BE4_RX, 'be4', signals);
  const hasBe7 = collectRegexSignal(text, BE7_RX, 'be7', signals);

  const hasBlueMoonContext = collectRegexSignal(text, BLUE_ORIGIN_BLUE_MOON_CONTEXT_RX, 'lunar_context', signals);
  const hasNewShepardContext = collectRegexSignal(text, BLUE_ORIGIN_NEW_SHEPARD_CONTEXT_RX, 'suborbital_context', signals);
  const hasNewGlennContext = collectRegexSignal(text, BLUE_ORIGIN_NEW_GLENN_CONTEXT_RX, 'launch_context', signals);
  const hasEngineContext = collectRegexSignal(text, BLUE_ORIGIN_ENGINE_CONTEXT_RX, 'engine_context', signals);
  const hasGeneralSupportContext = collectRegexSignal(text, BLUE_ORIGIN_GENERAL_SUPPORT_RX, 'support_context', signals);

  const platformHits = [hasBlueMoon, hasNewGlenn, hasNewShepard, hasBe4, hasBe7].filter(Boolean).length;
  const contextHits = [hasBlueMoonContext, hasNewShepardContext, hasNewGlennContext, hasEngineContext, hasGeneralSupportContext].filter(Boolean).length;

  if (
    (hasCompany && hasGeneralSupportContext) ||
    (hasNewShepard && (hasCompany || hasNewShepardContext)) ||
    (hasNewGlenn && (hasCompany || hasNewGlennContext)) ||
    (hasBlueMoon && (hasCompany || hasBlueMoonContext)) ||
    ((hasBe4 || hasBe7) && (hasCompany || hasEngineContext))
  ) {
    return {
      strength: 'strong',
      score: platformHits * 5 + contextHits * 3 + (hasCompany ? 2 : 0),
      reasonCodes: ['platform_and_support_context'],
      signals
    };
  }

  if (hasCompany && platformHits > 0) {
    return {
      strength: 'weak',
      score: platformHits * 3 + 2,
      reasonCodes: ['explicit_company_and_platform_reference'],
      signals
    };
  }

  if (hasCompany) {
    return {
      strength: 'weak',
      score: 2,
      reasonCodes: ['explicit_company_reference'],
      signals
    };
  }

  if (hasNewShepard || hasNewGlenn) {
    return {
      strength: 'weak',
      score: platformHits * 3 + contextHits,
      reasonCodes: ['distinct_platform_reference_without_company_anchor'],
      signals
    };
  }

  if (hasBlueMoon && hasBlueMoonContext) {
    return {
      strength: 'weak',
      score: 4 + contextHits,
      reasonCodes: ['program_reference_without_company_anchor'],
      signals
    };
  }

  if ((hasBe4 || hasBe7) && hasEngineContext) {
    return {
      strength: 'weak',
      score: 4 + contextHits,
      reasonCodes: ['engine_reference_without_company_anchor'],
      signals
    };
  }

  return {
    strength: 'none',
    score: 0,
    reasonCodes: [],
    signals
  };
}

function classifySpaceXSupport(text: string): CompanySupportEvaluation {
  const signals: string[] = [];
  const hasCompany = collectRegexSignal(text, SPACEX_COMPANY_RX, 'spacex', signals);
  const hasFalcon9 = collectRegexSignal(text, FALCON9_RX, 'falcon9', signals);
  const hasFalconHeavy = collectRegexSignal(text, FALCON_HEAVY_RX, 'falcon_heavy', signals);
  const hasDragon = collectRegexSignal(text, DRAGON_RX, 'dragon', signals);
  const hasStarship = collectRegexSignal(text, STARSHIP_RX, 'starship', signals);
  const hasStarlink = collectRegexSignal(text, STARLINK_RX, 'starlink', signals);

  const hasFalconContext = collectRegexSignal(text, SPACEX_FALCON_CONTEXT_RX, 'launch_context', signals);
  const hasDragonContext = collectRegexSignal(text, SPACEX_DRAGON_CONTEXT_RX, 'dragon_context', signals);
  const hasStarshipContext = collectRegexSignal(text, SPACEX_STARSHIP_CONTEXT_RX, 'starship_context', signals);
  const hasStarlinkContext = collectRegexSignal(text, SPACEX_STARLINK_CONTEXT_RX, 'service_context', signals);
  const hasGeneralSupportContext = collectRegexSignal(text, SPACEX_GENERAL_SUPPORT_RX, 'support_context', signals);
  const hasMerchandiseNegative = collectRegexSignal(text, COMMON_MERCHANDISE_NEGATIVE_RX, 'merchandise_context', signals);

  const platformHits = [hasFalcon9, hasFalconHeavy, hasDragon, hasStarship, hasStarlink].filter(Boolean).length;
  const contextHits = [hasFalconContext, hasDragonContext, hasStarshipContext, hasStarlinkContext, hasGeneralSupportContext].filter(Boolean).length;

  if (hasMerchandiseNegative && (hasCompany || platformHits > 0)) {
    return {
      strength: 'none',
      score: 0,
      reasonCodes: ['support_signal_blocked_by_negative_context'],
      signals
    };
  }

  if (
    (hasCompany && hasGeneralSupportContext) ||
    ((hasFalcon9 || hasFalconHeavy) && (hasCompany || hasFalconContext)) ||
    (hasDragon && (hasDragonContext || hasCompany || hasFalcon9 || hasFalconHeavy)) ||
    (hasStarship && (hasStarshipContext || hasCompany)) ||
    (hasStarlink && (hasStarlinkContext || hasCompany))
  ) {
    return {
      strength: 'strong',
      score: platformHits * 5 + contextHits * 3 + (hasCompany ? 2 : 0),
      reasonCodes: ['platform_and_support_context'],
      signals
    };
  }

  if (hasCompany && platformHits > 0) {
    return {
      strength: 'weak',
      score: platformHits * 3 + 2,
      reasonCodes: ['explicit_company_and_platform_reference'],
      signals
    };
  }

  if (hasCompany) {
    return {
      strength: 'weak',
      score: 2,
      reasonCodes: ['explicit_company_reference'],
      signals
    };
  }

  if (hasFalcon9 || hasFalconHeavy) {
    return {
      strength: 'weak',
      score: platformHits * 3 + contextHits,
      reasonCodes: ['distinct_platform_reference_without_company_anchor'],
      signals
    };
  }

  return {
    strength: 'none',
    score: 0,
    reasonCodes: [],
    signals
  };
}

function buildSearchText(input: UsaSpendingAwardAuditInput) {
  const metadata = input.metadata || {};
  const parts = [
    input.title,
    input.recipient,
    readString(metadata.detail),
    readString(metadata.description),
    readString(metadata.keyword),
    ...readStringArray(metadata.keywords)
  ];
  return parts
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');
}

function buildCompanySupportText(input: UsaSpendingAwardAuditInput) {
  const metadata = input.metadata || {};
  const parts = [
    input.title,
    readString(metadata.detail),
    readString(metadata.description)
  ];

  return parts
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');
}

function resolveSourceUrl(metadata: Record<string, unknown> | null | undefined) {
  return (
    readString(metadata?.awardPageUrl) ||
    readString(metadata?.sourceUrl) ||
    readString(metadata?.awardApiUrl) ||
    null
  );
}

function normalizeIdentityComponent(value: unknown, maxLength: number) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, maxLength));
}

function normalizeIdentityDate(value: unknown) {
  const raw = readString(value);
  if (!raw) return '';
  return raw.trim().slice(0, 10);
}

function normalizeText(value: unknown) {
  const raw = readString(value);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countRegexHits(text: string, patterns: SignalPattern[], signals: string[]) {
  let hits = 0;
  for (const pattern of patterns) {
    if (!pattern.rx.test(text)) continue;
    hits += 1;
    signals.push(pattern.label);
  }
  return hits;
}

function collectRegexSignal(text: string, rx: RegExp, label: string, signals: string[]) {
  if (!rx.test(text)) return false;
  signals.push(label);
  return true;
}

function resolveAwardFamily(
  metadata: Record<string, unknown> | null | undefined
): ProgramUsaspendingAwardFamily {
  const source = metadata || {};
  const directFamily = normalizeAwardFamily(
    readString(source.awardFamily) || readString(source.award_family)
  );
  if (directFamily !== 'unknown') return directFamily;

  const queryGroups = readStringArray(source.queryGroups);
  const queryGroup = readString(source.queryGroup);
  const candidates = queryGroup ? [queryGroup, ...queryGroups] : queryGroups;

  for (const candidate of candidates) {
    const normalized = normalizeAwardFamily(candidate);
    if (normalized !== 'unknown') return normalized;
  }

  const sourceRow = asRecord(source.sourceRow);
  const awardTypeText = [
    readString(sourceRow['Award Type']),
    readString(sourceRow.award_type),
    readString(sourceRow.awardType),
    readString(sourceRow['Contract Award Type']),
    readString(sourceRow.contract_award_type),
    readString(sourceRow.contractAwardType)
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (!awardTypeText) return 'unknown';
  if (
    awardTypeText.includes('direct payment') ||
    awardTypeText.includes('non-reimbursable direct financial aid')
  ) {
    return 'direct_payments';
  }
  if (
    awardTypeText.includes('loan') ||
    awardTypeText.includes('guaranteed/insured')
  ) {
    return 'loans';
  }
  if (
    awardTypeText.includes('grant') ||
    awardTypeText.includes('cooperative agreement')
  ) {
    return 'grants';
  }
  if (
    awardTypeText.includes('insurance') ||
    awardTypeText.includes('indemnity') ||
    awardTypeText.includes('other financial assistance')
  ) {
    return 'other_financial_assistance';
  }
  if (
    awardTypeText.includes('indefinite delivery') ||
    awardTypeText.includes('fss') ||
    awardTypeText.includes('gwac') ||
    awardTypeText.includes('boa') ||
    awardTypeText.includes('bpa')
  ) {
    return 'idvs';
  }
  if (
    awardTypeText.includes('contract') ||
    awardTypeText.includes('delivery order') ||
    awardTypeText.includes('purchase order') ||
    awardTypeText.includes('definitive')
  ) {
    return 'contracts';
  }

  return 'unknown';
}

function normalizeAwardFamily(value: string | null): ProgramUsaspendingAwardFamily {
  if (!value) return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'contracts') return 'contracts';
  if (normalized === 'idvs') return 'idvs';
  if (normalized === 'grants') return 'grants';
  if (normalized === 'loans') return 'loans';
  if (
    normalized === 'direct_payments' ||
    normalized === 'direct-payments' ||
    normalized === 'direct payments'
  ) {
    return 'direct_payments';
  }
  if (
    normalized === 'other_financial_assistance' ||
    normalized === 'other-financial-assistance' ||
    normalized === 'other financial assistance' ||
    normalized === 'other'
  ) {
    return 'other_financial_assistance';
  }
  return 'unknown';
}

function isPrimaryCompanyAwardFamily(
  metadata: Record<string, unknown> | null | undefined,
  awardFamily: ProgramUsaspendingAwardFamily
) {
  return COMPANY_PRIMARY_AWARD_FAMILIES.has(awardFamily) || hasContractAwardType(metadata);
}

function hasContractAwardType(metadata: Record<string, unknown> | null | undefined) {
  const sourceRow = asRecord(metadata?.sourceRow);
  const contractAwardType =
    readString(sourceRow['Contract Award Type']) ||
    readString(sourceRow.contract_award_type) ||
    readString(sourceRow.contractAwardType) ||
    null;
  return Boolean(contractAwardType);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function readString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
