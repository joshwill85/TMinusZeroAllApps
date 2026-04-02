export function normalizeEnvText(value: string | null | undefined) {
  let trimmed = String(value ?? '').trim();
  while (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed || null;
}

export function normalizeEnvUrl(value: string | null | undefined) {
  const normalized = normalizeEnvText(value);
  return normalized ? normalized.replace(/\/+$/, '') : null;
}
