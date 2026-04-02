function normalizeEnvText(value) {
  let trimmed = String(value || '').trim();
  while (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed || null;
}

function normalizeEnvUrl(value) {
  const normalized = normalizeEnvText(value);
  return normalized ? normalized.replace(/\/+$/, '') : null;
}

module.exports = {
  normalizeEnvText,
  normalizeEnvUrl
};
