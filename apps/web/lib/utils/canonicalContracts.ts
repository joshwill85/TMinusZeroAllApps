export type CanonicalContractScope = 'spacex' | 'blue-origin' | 'artemis';

export function normalizeCanonicalContractUid(value: string | null | undefined) {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const trimmed = decoded.trim().toLowerCase();
  if (!/^(spacex|blue-origin|artemis)--[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildCanonicalContractUid(scope: CanonicalContractScope, identifier: string) {
  const normalizedIdentifier = normalizeIdentifier(identifier) || 'contract';
  const suffix = shortHash(`${scope}:${identifier}`);
  return `${scope}--${normalizedIdentifier}-${suffix}`;
}

export function buildCanonicalContractHref(uid: string) {
  return `/contracts/${uid}`;
}

export function resolveCanonicalContractIdentifier(input: {
  scope: CanonicalContractScope;
  awardId?: string | null;
  piid?: string | null;
  contractKey?: string | null;
}) {
  const awardId = normalizeText(input.awardId);
  const piid = normalizeText(input.piid);
  const contractKey = normalizeText(input.contractKey);

  if (input.scope === 'artemis') {
    return piid || awardId || contractKey || 'contract';
  }

  return awardId || contractKey || piid || 'contract';
}

export function buildCanonicalContractHrefForStory(input: {
  scope: CanonicalContractScope;
  awardId?: string | null;
  piid?: string | null;
  contractKey?: string | null;
}) {
  if (!normalizeText(input.awardId) && !normalizeText(input.piid) && !normalizeText(input.contractKey)) {
    return null;
  }
  const identifier = resolveCanonicalContractIdentifier(input);
  return buildCanonicalContractHref(buildCanonicalContractUid(input.scope, identifier));
}

function shortHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function normalizeIdentifier(value: string) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeText(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
